/**
 * Anki .apkg parser — production-grade.
 *
 * Supports:
 *  - Legacy .anki2 (plain SQLite)              ← Anki < 2.1.50, or "Support older Anki versions"
 *  - .anki21 (newer SQLite, still uncompressed)
 *  - .anki21b (Zstandard-compressed SQLite)    ← Anki >= 2.1.50 default, decompressed via fzstd
 *  - Multiple cards per note (front/back templates, reversed cards, etc.)
 *  - Cloze deletions ({{c1::text::hint}})
 *  - Media (images, audio, etc.) extracted into data URLs
 *  - Decks tree (parent::child::grandchild names)
 *  - Tags
 *  - Fallbacks for malformed exports
 */
import JSZip from "jszip";
// @ts-ignore - sql.js has no first-party types
import initSqlJs from "sql.js";
import { decompress as zstdDecompress } from "fzstd";
import type { ParsedDeck, ParsedCard } from "./parser";

type SqlDb = any;

type AnkiTemplate = { name: string; qfmt: string; afmt: string };
type AnkiModel = {
  id: string;
  name: string;
  fields: string[];
  templates: AnkiTemplate[];
  isCloze: boolean;
};
type AnkiNote = { id: string; mid: string; fields: string[]; tags: string[] };
type AnkiCard = { nid: string; did: string; ord: number };
type AnkiDeck = { id: string; name: string };

export interface ApkgProgress {
  phase: string;
  detail?: string;
  percent?: number;
}

export interface ApkgResult {
  decks: ParsedDeck[];
  media: Record<string, string>;
  total: number;
  warnings: string[];
}

const SQLITE_MAGIC = "SQLite format 3\0";
const SQL_JS_CDNS = [
  "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/",
  "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/",
  "https://unpkg.com/sql.js@1.10.3/dist/",
];

let SqlPromise: Promise<any> | null = null;

async function getSql(): Promise<any> {
  if (SqlPromise) return SqlPromise;
  // Try CDNs in order until one succeeds.
  SqlPromise = (async () => {
    let lastErr: any;
    for (const cdn of SQL_JS_CDNS) {
      try {
        return await initSqlJs({ locateFile: (f: string) => cdn + f });
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error("Impossible de charger sql.js depuis le CDN : " + (lastErr?.message || lastErr));
  })();
  return SqlPromise;
}

/**
 * Main entry: parse an .apkg file.
 */
export async function parseApkg(
  file: File,
  onProgress?: (p: ApkgProgress) => void
): Promise<ApkgResult> {
  const warnings: string[] = [];
  const tick = (phase: string, detail?: string, percent?: number) =>
    onProgress?.({ phase, detail, percent });

  tick("Lecture du fichier", file.name);

  // 1. Validate file
  if (!file || file.size === 0) {
    throw new Error("Fichier vide.");
  }
  if (file.size > 500 * 1024 * 1024) {
    warnings.push(`Fichier très volumineux (${formatSize(file.size)}). Cela peut prendre du temps.`);
  }

  // 2. Unzip
  tick("Décompression du .apkg", formatSize(file.size));
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e: any) {
    throw new Error("Le fichier n'est pas un .apkg valide (ZIP corrompu).");
  }

  // 3. Locate the SQLite database (multiple possible names + locations)
  const dbBytes = await locateDatabase(zip);
  if (!dbBytes) {
    throw new Error("Aucune base SQLite trouvée dans le fichier .apkg.");
  }

  // 4. Verify it is actually SQLite (some Anki exports have it Zstd-compressed inside)
  const finalDb = await ensureSqliteFormat(dbBytes, warnings);

  // 5. Initialize sql.js
  tick("Initialisation du moteur SQL");
  const SQL = await getSql();
  let db: SqlDb;
  try {
    db = new SQL.Database(finalDb);
  } catch (e: any) {
    throw new Error("Impossible d'ouvrir la base Anki : " + (e?.message || e));
  }

  try {
    // 6. Parse models + decks from the col table
    tick("Lecture des modèles et decks");
    const { models, decks } = parseCollection(db, warnings);

    // 7. Parse all notes
    tick("Lecture des notes");
    const notes = parseNotes(db, warnings);

    // 8. Parse cards (note → deck mapping + ord for which template)
    tick("Lecture des cartes");
    const cards = parseCards(db, warnings);

    // 9. Extract media files
    tick("Extraction des médias");
    const media = await extractMedia(zip, (i, n, name) =>
      tick("Extraction des médias", `${i}/${n} — ${name}`, n > 0 ? (i / n) * 100 : undefined)
    );

    // 10. Build the parsed decks
    tick("Construction des cartes");
    const built = buildDecks(notes, models, decks, cards, file.name, warnings);

    tick(`Terminé : ${built.total} carte(s)`);
    return { ...built, media, warnings };
  } finally {
    try { db.close(); } catch {}
  }
}

// ─── ZIP / DB location ──────────────────────────────────────────────

async function locateDatabase(zip: JSZip): Promise<Uint8Array | null> {
  const candidates = ["collection.anki21b", "collection.anki21", "collection.anki2"];

  // Check known names at the root first.
  for (const name of candidates) {
    const f = zip.file(name);
    if (f) {
      const buf = await f.async("uint8array");
      if (buf.length > 0) return buf;
    }
  }

  // Fall back: scan all files for any *.anki* and pick the largest.
  let best: { name: string; size: number; bytes: Uint8Array } | null = null;
  const entries: { name: string; entry: JSZip.JSZipObject }[] = [];
  zip.forEach((path, entry) => {
    if (!entry.dir && /\.anki(?:2|21|21b)$/i.test(path)) {
      entries.push({ name: path, entry });
    }
  });
  for (const { name, entry } of entries) {
    const buf = await entry.async("uint8array");
    if (!best || buf.length > best.size) {
      best = { name, size: buf.length, bytes: buf };
    }
  }
  return best?.bytes ?? null;
}

async function ensureSqliteFormat(bytes: Uint8Array, warnings: string[]): Promise<Uint8Array> {
  // SQLite header: "SQLite format 3\0"
  if (startsWithMagic(bytes, SQLITE_MAGIC)) return bytes;

  // Check Zstd magic: 0x28 0xB5 0x2F 0xFD
  if (bytes.length > 4 && bytes[0] === 0x28 && bytes[1] === 0xB5 && bytes[2] === 0x2F && bytes[3] === 0xFD) {
    try {
      const decompressed = zstdDecompress(bytes);
      if (startsWithMagic(decompressed, SQLITE_MAGIC)) {
        warnings.push("Format Anki moderne (compressé Zstandard) détecté et décompressé.");
        return decompressed;
      }
    } catch (e: any) {
      throw new Error("Échec de la décompression Zstandard : " + (e?.message || e));
    }
  }

  // Anki 2.1.50+ exports use a custom container. Try to parse it.
  // Format: anki21b is actually a wrapped container. Try to decompress raw.
  try {
    const decompressed = zstdDecompress(bytes);
    if (startsWithMagic(decompressed, SQLITE_MAGIC)) {
      warnings.push("Conteneur Anki moderne décompressé.");
      return decompressed;
    }
  } catch {
    // ignore
  }

  throw new Error(
    "Format Anki non reconnu. Si tu as exporté depuis Anki ≥ 2.1.50, " +
    "ré-exporte en cochant « Support older Anki versions » dans la fenêtre d'export."
  );
}

function startsWithMagic(bytes: Uint8Array, magic: string): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

// ─── SQLite parsing ──────────────────────────────────────────────────

function parseCollection(db: SqlDb, warnings: string[]): { models: Map<string, AnkiModel>; decks: Map<string, AnkiDeck> } {
  const models = new Map<string, AnkiModel>();
  const decks = new Map<string, AnkiDeck>();

  try {
    const rows = db.exec("SELECT models, decks FROM col LIMIT 1");
    if (!rows.length || !rows[0].values.length) {
      warnings.push("Table `col` vide ou absente.");
      return { models, decks };
    }

    const modelsRaw = rows[0].values[0][0];
    const decksRaw = rows[0].values[0][1];

    // Models
    if (modelsRaw) {
      const obj = typeof modelsRaw === "string" ? JSON.parse(modelsRaw) : modelsRaw;
      for (const [id, m] of Object.entries<any>(obj)) {
        const fields: string[] = (m.flds || []).map((f: any) => f.name || "");
        const templates: AnkiTemplate[] = (m.tmpls || []).map((t: any) => ({
          name: t.name || "Card",
          qfmt: t.qfmt || "{{Front}}",
          afmt: t.afmt || "{{FrontSide}}<hr>{{Back}}",
        }));
        models.set(String(id), {
          id: String(id),
          name: m.name || `Modèle ${id}`,
          fields,
          templates: templates.length > 0 ? templates : [{ name: "Card", qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr>{{Back}}" }],
          isCloze: m.type === 1, // Anki: 0=standard, 1=cloze
        });
      }
    }

    // Decks (nested via "::" in name)
    if (decksRaw) {
      const obj = typeof decksRaw === "string" ? JSON.parse(decksRaw) : decksRaw;
      for (const [id, d] of Object.entries<any>(obj)) {
        const name = d.name || `Deck ${id}`;
        decks.set(String(id), { id: String(id), name });
      }
    }
  } catch (e: any) {
    warnings.push("Erreur de lecture de `col` : " + e?.message);
  }

  return { models, decks };
}

function parseNotes(db: SqlDb, warnings: string[]): Map<string, AnkiNote> {
  const out = new Map<string, AnkiNote>();
  try {
    const rows = db.exec("SELECT id, mid, flds, tags FROM notes");
    if (!rows.length) return out;
    for (const [id, mid, flds, tags] of rows[0].values) {
      const fields = String(flds ?? "").split("\x1f");
      const tagList = String(tags ?? "").trim().split(/\s+/).filter(Boolean);
      out.set(String(id), { id: String(id), mid: String(mid), fields, tags: tagList });
    }
  } catch (e: any) {
    warnings.push("Erreur de lecture de `notes` : " + e?.message);
  }
  return out;
}

function parseCards(db: SqlDb, warnings: string[]): AnkiCard[] {
  const out: AnkiCard[] = [];
  try {
    const rows = db.exec("SELECT nid, did, ord FROM cards");
    if (!rows.length) return out;
    for (const [nid, did, ord] of rows[0].values) {
      out.push({ nid: String(nid), did: String(did), ord: Number(ord) });
    }
  } catch (e: any) {
    warnings.push("Erreur de lecture de `cards` : " + e?.message);
  }
  return out;
}

// ─── Media extraction ────────────────────────────────────────────────

async function extractMedia(
  zip: JSZip,
  onItem: (i: number, total: number, name: string) => void
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  // Find the "media" mapping file (root or nested).
  let mediaFile = zip.file("media");
  if (!mediaFile) {
    zip.forEach((path, entry) => {
      if (!mediaFile && /(?:^|\/)media$/.test(path) && !entry.dir) mediaFile = entry;
    });
  }
  if (!mediaFile) return out;

  let mediaMap: Record<string, string> = {};
  try {
    mediaMap = JSON.parse(await mediaFile.async("string"));
  } catch {
    return out;
  }

  const entries = Object.entries(mediaMap);
  let i = 0;
  for (const [num, filename] of entries) {
    i++;
    if (typeof filename !== "string" || !filename) continue;
    onItem(i, entries.length, filename);

    // The media file inside the zip has the numeric name (no extension).
    let f = zip.file(num);
    if (!f) {
      // Some exports place them in "media/<num>"
      f = zip.file(`media/${num}`);
    }
    if (!f) continue;

    try {
      const ext = filename.split(".").pop()?.toLowerCase() || "";
      const mime = mimeFor(ext);
      // Skip audio/video to keep app size reasonable. They can't render anyway.
      if (mime.startsWith("audio/") || mime.startsWith("video/")) continue;
      const b64 = await f.async("base64");
      out[filename] = `data:${mime};base64,${b64}`;
      // Yield to UI every 20 files
      if (i % 20 === 0) await new Promise(r => setTimeout(r, 0));
    } catch {
      /* skip */
    }
  }
  return out;
}

function mimeFor(ext: string): string {
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
    mp4: "video/mp4", webm: "video/webm",
  };
  return map[ext] || "application/octet-stream";
}

// ─── Build decks ─────────────────────────────────────────────────────

function buildDecks(
  notes: Map<string, AnkiNote>,
  models: Map<string, AnkiModel>,
  decks: Map<string, AnkiDeck>,
  cards: AnkiCard[],
  filename: string,
  warnings: string[]
): { decks: ParsedDeck[]; total: number } {
  // Group cards by deck
  const cardsByDeck = new Map<string, ParsedCard[]>();
  let total = 0;
  let skipped = 0;

  for (const c of cards) {
    const note = notes.get(c.nid);
    if (!note) { skipped++; continue; }
    const model = models.get(note.mid);
    if (!model) { skipped++; continue; }

    const parsed = renderCard(note, model, c.ord);
    if (!parsed) { skipped++; continue; }

    const list = cardsByDeck.get(c.did) ?? [];
    list.push(parsed);
    cardsByDeck.set(c.did, list);
    total++;
  }

  if (skipped > 0) {
    warnings.push(`${skipped} carte(s) ignorée(s) (note ou modèle introuvable, ou contenu vide).`);
  }

  // Build ParsedDeck list with proper deck names.
  const result: ParsedDeck[] = [];
  const fallbackName = filename.replace(/\.apkg$/i, "") || "Import Anki";

  for (const [deckId, deckCards] of cardsByDeck) {
    if (deckCards.length === 0) continue;
    const deck = decks.get(deckId);
    let name = deck?.name || fallbackName;
    if (name === "Default" && cardsByDeck.size === 1) {
      // Only one deck and it's named "Default" → use the file name
      name = fallbackName;
    }
    // Anki uses "::" as folder separator. Keep last segment for the deck name to keep things simple,
    // but prefix unique deck folders with the parent path joined by "/".
    const segments = name.split("::").filter(Boolean);
    const folderName = segments.join(" / ") || fallbackName;
    result.push({ folderName, cards: deckCards });
  }

  // Stable order
  result.sort((a, b) => (a.folderName || "").localeCompare(b.folderName || ""));

  return { decks: result, total };
}

// ─── Card rendering (templates + cloze) ──────────────────────────────

function renderCard(note: AnkiNote, model: AnkiModel, ord: number): ParsedCard | null {
  if (model.isCloze) {
    return renderClozeCard(note, model, ord);
  }
  return renderStandardCard(note, model, ord);
}

function renderStandardCard(note: AnkiNote, model: AnkiModel, ord: number): ParsedCard | null {
  const tmpl = model.templates[Math.min(Math.max(ord, 0), model.templates.length - 1)];
  if (!tmpl) return null;

  const filled = (s: string) => fillTemplate(s, model.fields, note.fields);

  const front = cleanHtml(filled(tmpl.qfmt));

  // Build the answer side. {{FrontSide}} expands to the front HTML.
  let afmt = tmpl.afmt
    .replace(/\{\{\s*FrontSide\s*\}\}/gi, "");
  let answer = cleanHtml(filled(afmt));

  // Some templates use <hr id="answer"> to separate front from back; strip up to and including it.
  const hr = answer.match(/<hr[^>]*id\s*=\s*["']?answer["']?[^>]*>([\s\S]*)/i);
  if (hr) answer = cleanHtml(hr[1]);
  else {
    const hr2 = answer.match(/<hr[^>]*>([\s\S]*)/i);
    if (hr2) answer = cleanHtml(hr2[1]);
  }

  if (!front.trim()) return null;
  // If answer is empty, fall back to second field
  const back = answer.trim() || cleanHtml(note.fields[1] || "");
  if (!back.trim()) return null;

  return {
    front: front.trim(),
    back: back.trim(),
    tags: note.tags.length ? note.tags : undefined,
  };
}

function renderClozeCard(note: AnkiNote, _model: AnkiModel, ord: number): ParsedCard | null {
  // ord = cloze number minus 1 (c1 -> ord 0, c2 -> ord 1, etc.)
  const targetCloze = ord + 1;

  // Find the field that contains cloze markers
  const clozeFieldIdx = note.fields.findIndex(f => /\{\{c\d+::/.test(f));
  if (clozeFieldIdx < 0) return null;

  const clozeText = note.fields[clozeFieldIdx];

  // Build front: target cloze becomes [...], others reveal their text
  const frontText = clozeText.replace(/\{\{c(\d+)::([^{}]*?)(?:::([^{}]*?))?\}\}/g,
    (_m, num, content, hint) => {
      if (Number(num) === targetCloze) {
        return hint ? `[${hint}]` : "[…]";
      }
      return content;
    });

  // Build back: all clozes reveal their text, with the target highlighted
  const backText = clozeText.replace(/\{\{c(\d+)::([^{}]*?)(?:::([^{}]*?))?\}\}/g,
    (_m, num, content) => {
      if (Number(num) === targetCloze) return `**${content}**`;
      return content;
    });

  // Append other fields (Extra, Back Extra, etc.) to back
  const extraFields = note.fields.filter((_, i) => i !== clozeFieldIdx).filter(Boolean);
  const fullBack = extraFields.length > 0
    ? `${backText}\n\n${extraFields.join("\n\n")}`
    : backText;

  const front = cleanHtml(frontText).trim();
  const back = cleanHtml(fullBack).trim();
  if (!front || !back) return null;

  return {
    front,
    back,
    tags: note.tags.length ? note.tags : undefined,
  };
}

function fillTemplate(template: string, fieldNames: string[], fieldValues: string[]): string {
  let result = template;

  // Replace {{FieldName}}, {{type:FieldName}}, {{hint:FieldName}}, {{cloze:FieldName}}, {{text:FieldName}}, etc.
  for (let i = 0; i < fieldNames.length && i < fieldValues.length; i++) {
    const escaped = fieldNames[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value = fieldValues[i];
    // {{FieldName}}
    result = result.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, "gi"), value);
    // {{anyPrefix:FieldName}}
    result = result.replace(new RegExp(`\\{\\{\\s*[a-z]+:${escaped}\\s*\\}\\}`, "gi"), value);
  }

  // Conditionals {{#Field}}...{{/Field}} : keep block if field non-empty
  result = result.replace(/\{\{#([\w]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, name, block) => {
    const idx = fieldNames.indexOf(name);
    if (idx >= 0 && fieldValues[idx]?.trim()) return block;
    return "";
  });
  // Inverse conditionals {{^Field}}...{{/Field}} : keep block if field empty
  result = result.replace(/\{\{\^([\w]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, name, block) => {
    const idx = fieldNames.indexOf(name);
    if (idx < 0 || !fieldValues[idx]?.trim()) return block;
    return "";
  });

  // Strip leftover {{...}} that we couldn't resolve
  result = result.replace(/\{\{[^}]+\}\}/g, "");

  return result;
}

// ─── HTML → markdown cleanup ─────────────────────────────────────────

function cleanHtml(s: string): string {
  if (!s) return "";

  let out = s
    // Decode common entities first
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");

  // Convert structural tags to whitespace
  out = out
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<p\b[^>]*>/gi, "")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<div\b[^>]*>/gi, "");

  // Convert formatting
  out = out
    .replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, (_, t) => `**${t}**`)
    .replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, (_, t) => `*${t}*`)
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, (_, t) => `<u>${t}</u>`);

  // Convert images to [image:filename] (handle url-encoded names too)
  out = out.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, src) => {
    let clean = src;
    try { clean = decodeURIComponent(src); } catch {}
    return `[image:${clean}]`;
  });

  // Drop sound tags entirely (we skip audio media)
  out = out.replace(/\[sound:[^\]]+\]/gi, "");

  // Strip remaining tags except span (color preservation handled in renderer) and u
  out = out.replace(/<\/?(?!span|u\b)[a-z][^>]*>/gi, "");

  // Collapse 3+ consecutive blank lines into 2
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " o";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " Ko";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " Mo";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " Go";
}
