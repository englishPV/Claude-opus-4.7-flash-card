// Parsers multi-formats pour importer des cartes
import type { Card, CardType } from "./types";
import { newSrs } from "./srs";

export interface ParsedDeck {
  folderName: string | null;     // nom de chapitre/deck si détecté
  cards: ParsedCard[];
}

export interface ParsedCard {
  front: string;
  back: string;
  type?: CardType;
  tags?: string[];
}

export interface ParseResult {
  decks: ParsedDeck[];           // possibilité de plusieurs decks (séparés par # titres ou DECK :)
  total: number;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function toCard(p: ParsedCard): Card {
  const now = Date.now();
  return {
    id: uid(),
    front: p.front.trim(),
    back: p.back.trim(),
    type: p.type,
    tags: p.tags,
    imageId: null,
    createdAt: now,
    updatedAt: now,
    srs: newSrs(),
  };
}

// ─── Détection automatique du format ──────────────────────────────
export function parseAuto(text: string): ParseResult {
  const t = text.trim();
  if (!t) return { decks: [], total: 0 };

  // JSON Anki/CrowdAnki
  if (t.startsWith("{") && (t.includes('"__type__"') || t.includes('"note_models"') || t.includes('"notes"'))) {
    try { return parseCrowdAnki(t); } catch { /* fallback */ }
  }

  // Format Q:/R:/======= DECK
  if (/^Q:\s/m.test(t) || /^DECK\s*:/im.test(t)) {
    return parseQR(t);
  }
  // Format pipe vocabulaire (8048|...|...|...)
  if (/^\d+\|[^|\n]+\|[^|\n]+\|/m.test(t)) {
    return parsePipe(t);
  }
  // Format markdown carte ### Carte X — ... + RECTO/VERSO
  if (/RECTO\s*:/i.test(t) || /^###\s+Carte/m.test(t)) {
    return parseMarkdownCards(t);
  }
  // fallback: ligne par ligne front | back
  return parseSimplePipe(t);
}

// ─── CrowdAnki / Anki JSON ─────────────────────────────────────────
// Format: { name, notes: [{note_model_uuid, fields, tags}], note_models: [{crowdanki_uuid, flds, tmpls, type}], children: [...] }
function parseCrowdAnki(text: string): ParseResult {
  const json = JSON.parse(text);

  // Build model registry — one model can have multiple templates → multiple cards per note.
  type Tmpl = { qfmt: string; afmt: string };
  type Model = { fields: string[]; templates: Tmpl[]; isCloze: boolean };
  const models = new Map<string, Model>();

  // CrowdAnki can have nested decks via "children". Walk recursively to collect all models.
  const collectModels = (deck: any) => {
    for (const nm of (deck.note_models || [])) {
      const fieldNames = (nm.flds || []).map((f: any) => f.name || "");
      const templates: Tmpl[] = (nm.tmpls || []).map((t: any) => ({
        qfmt: t.qfmt || "{{Front}}",
        afmt: t.afmt || "{{FrontSide}}<hr>{{Back}}",
      }));
      const key = nm.crowdanki_uuid || nm.name || String(Math.random());
      models.set(key, {
        fields: fieldNames,
        templates: templates.length > 0 ? templates : [{ qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr>{{Back}}" }],
        isCloze: nm.type === 1,
      });
    }
    for (const child of (deck.children || [])) collectModels(child);
  };
  collectModels(json);

  // Walk decks recursively, building one ParsedDeck per Anki deck.
  const decks: ParsedDeck[] = [];
  const walkDeck = (deck: any, prefix: string) => {
    const name = prefix ? `${prefix} / ${deck.name}` : (deck.name || "Import Anki");
    const cards: ParsedCard[] = [];
    for (const note of (deck.notes || [])) {
      const generated = renderCrowdNote(note, models);
      cards.push(...generated);
    }
    if (cards.length > 0) decks.push({ folderName: name, cards });
    for (const child of (deck.children || [])) walkDeck(child, name);
  };
  walkDeck(json, "");

  return { decks, total: decks.reduce((s, d) => s + d.cards.length, 0) };
}

function renderCrowdNote(
  note: any,
  models: Map<string, { fields: string[]; templates: { qfmt: string; afmt: string }[]; isCloze: boolean }>
): ParsedCard[] {
  const fields: string[] = note.fields || [];
  if (fields.length < 1) return [];
  const model = models.get(note.note_model_uuid);
  const tags: string[] = note.tags || [];

  // Cloze: one card per cloze deletion
  if (model?.isCloze || /\{\{c\d+::/.test(fields[0] || "")) {
    return renderClozeNote(fields, tags);
  }

  if (!model) {
    // Unknown model → simple front/back
    const front = cleanAnkiHtml(fields[0] || "");
    const back = cleanAnkiHtml(fields[1] || "");
    if (!front || !back) return [];
    return [{ front, back, tags: tags.length ? tags : undefined }];
  }

  // For each template generate one card
  const result: ParsedCard[] = [];
  for (const tmpl of model.templates) {
    const filled = (s: string) => fillCrowdTemplate(s, model.fields, fields);
    const front = cleanAnkiHtml(filled(tmpl.qfmt));
    let afmt = tmpl.afmt.replace(/\{\{\s*FrontSide\s*\}\}/gi, "");
    let answer = cleanAnkiHtml(filled(afmt));
    const hr = answer.match(/<hr[^>]*>([\s\S]*)/i);
    if (hr) answer = cleanAnkiHtml(hr[1]);

    if (!front.trim()) continue;
    const back = answer.trim() || cleanAnkiHtml(fields[1] || "");
    if (!back.trim()) continue;

    result.push({ front: front.trim(), back: back.trim(), tags: tags.length ? tags : undefined });
  }

  // Fallback: if all templates produced nothing, use raw fields
  if (result.length === 0 && fields.length >= 2) {
    const front = cleanAnkiHtml(fields[0]);
    const back = cleanAnkiHtml(fields[1]);
    if (front && back) result.push({ front, back, tags: tags.length ? tags : undefined });
  }

  return result;
}

function renderClozeNote(fields: string[], tags: string[]): ParsedCard[] {
  const clozeFieldIdx = fields.findIndex(f => /\{\{c\d+::/.test(f));
  if (clozeFieldIdx < 0) return [];
  const clozeText = fields[clozeFieldIdx];
  const extraFields = fields.filter((_, i) => i !== clozeFieldIdx).filter(Boolean);

  // Extract all unique cloze numbers
  const numbers = new Set<number>();
  for (const m of clozeText.matchAll(/\{\{c(\d+)::/g)) numbers.add(Number(m[1]));
  if (numbers.size === 0) return [];

  const cards: ParsedCard[] = [];
  for (const target of [...numbers].sort()) {
    const frontText = clozeText.replace(/\{\{c(\d+)::([^{}]*?)(?:::([^{}]*?))?\}\}/g,
      (_m, num, content, hint) => Number(num) === target ? (hint ? `[${hint}]` : "[…]") : content);
    const backText = clozeText.replace(/\{\{c(\d+)::([^{}]*?)(?:::([^{}]*?))?\}\}/g,
      (_m, num, content) => Number(num) === target ? `**${content}**` : content);
    const fullBack = extraFields.length > 0 ? `${backText}\n\n${extraFields.join("\n\n")}` : backText;
    const front = cleanAnkiHtml(frontText).trim();
    const back = cleanAnkiHtml(fullBack).trim();
    if (front && back) {
      cards.push({ front, back, tags: tags.length ? tags : undefined });
    }
  }
  return cards;
}

function fillCrowdTemplate(template: string, fieldNames: string[], fieldValues: string[]): string {
  let result = template;
  for (let i = 0; i < fieldNames.length && i < fieldValues.length; i++) {
    const name = escapeRegex(fieldNames[i]);
    result = result.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, "gi"), fieldValues[i]);
    result = result.replace(new RegExp(`\\{\\{\\s*[a-z]+:${name}\\s*\\}\\}`, "gi"), fieldValues[i]);
  }
  // Conditionals
  result = result.replace(/\{\{#([\w]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, name, block) => {
    const idx = fieldNames.indexOf(name);
    return (idx >= 0 && fieldValues[idx]?.trim()) ? block : "";
  });
  result = result.replace(/\{\{\^([\w]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, name, block) => {
    const idx = fieldNames.indexOf(name);
    return (idx < 0 || !fieldValues[idx]?.trim()) ? block : "";
  });
  result = result.replace(/\{\{[^}]+\}\}/g, "");
  return result;
}

function cleanAnkiHtml(s: string): string {
  if (!s) return "";
  let out = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<p\b[^>]*>/gi, "")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<div\b[^>]*>/gi, "")
    .replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, (_, t) => `**${t}**`)
    .replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, (_, t) => `*${t}*`)
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, (_, t) => `<u>${t}</u>`)
    .replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, src) => {
      let clean = src;
      try { clean = decodeURIComponent(src); } catch {}
      return `[image:${clean}]`;
    })
    .replace(/\[sound:[^\]]+\]/gi, "")
    .replace(/<\/?(?!span|u\b)[a-z][^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Format Markdown "### Carte X [M] — Chap" ─────────────────────
function parseMarkdownCards(text: string): ParseResult {
  const decks: ParsedDeck[] = [];
  // Découpe par titre H1 (= chapitre principal)
  const chapters = text.split(/^#\s+(?!#)/m); // split sur "# titre" niveau 1
  // re-attache un préfixe si pas de # initial
  const blocks: { title: string | null; body: string }[] = [];
  if (text.trimStart().startsWith("# ")) {
    // chapters[0] est vide
    for (let i = 1; i < chapters.length; i++) {
      const lines = chapters[i].split("\n");
      const title = lines.shift()?.trim() || null;
      blocks.push({ title, body: lines.join("\n") });
    }
  } else {
    blocks.push({ title: null, body: text });
  }

  for (const blk of blocks) {
    const cards: ParsedCard[] = [];
    // découpe en cartes via "### Carte"
    const parts = blk.body.split(/^###\s+/m).slice(1);
    for (const p of parts) {
      // header line
      const headerEnd = p.indexOf("\n");
      const header = headerEnd === -1 ? p : p.slice(0, headerEnd);
      const rest = headerEnd === -1 ? "" : p.slice(headerEnd + 1);

      // type entre crochets [M] [T] [C] [P]
      const typeMatch = header.match(/\[([MTCPVQ])\]/);
      const type = (typeMatch ? typeMatch[1] : undefined) as CardType | undefined;

      // découpe RECTO / VERSO
      const rectoMatch = rest.match(/\*\*RECTO\s*:\*\*([\s\S]*?)(?=\*\*VERSO\s*:\*\*|$)/i);
      const versoMatch = rest.match(/\*\*VERSO\s*:\*\*([\s\S]*?)$/i);
      if (rectoMatch && versoMatch) {
        let front = rectoMatch[1].trim();
        let back = versoMatch[1].trim();
        // enlever séparateurs --- en queue
        back = back.replace(/^---+\s*$/gm, "").trim();
        front = front.replace(/^---+\s*$/gm, "").trim();
        cards.push({ front, back, type });
      }
    }
    if (cards.length > 0) {
      decks.push({ folderName: blk.title, cards });
    }
  }
  if (decks.length === 0) {
    return parseSimplePipe(text);
  }
  return { decks, total: decks.reduce((s, d) => s + d.cards.length, 0) };
}

// ─── Format pipe vocabulaire (id|fr|en|tag) ──────────────────────
function parsePipe(text: string): ParseResult {
  const cards: ParsedCard[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const parts = l.split("|");
    if (parts.length >= 3) {
      // id | front | back | tag
      const front = parts[1].trim();
      const back = parts[2].trim();
      const tag = parts[3]?.trim().replace(/^\$\{|\}$/g, "");
      cards.push({ front, back, type: "V", tags: tag ? [tag] : undefined });
    }
  }
  return { decks: [{ folderName: null, cards }], total: cards.length };
}

function parseSimplePipe(text: string): ParseResult {
  const cards: ParsedCard[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const idx = l.indexOf("|");
    if (idx > 0) {
      cards.push({ front: l.slice(0, idx).trim(), back: l.slice(idx + 1).trim() });
    }
  }
  return { decks: [{ folderName: null, cards }], total: cards.length };
}

// ─── Format Q:/R: ────────────────────────────────────────────────
function parseQR(text: string): ParseResult {
  const decks: ParsedDeck[] = [];
  // découpe par DECK :
  const deckBlocks = text.split(/^={3,}\s*\n\s*DECK\s*:\s*(.+?)\s*\n={3,}\s*$/im);
  let blocks: { name: string | null; body: string }[] = [];
  if (deckBlocks.length === 1) {
    blocks.push({ name: null, body: deckBlocks[0] });
  } else {
    // alterne body, name, body, name…
    if (deckBlocks[0].trim()) blocks.push({ name: null, body: deckBlocks[0] });
    for (let i = 1; i < deckBlocks.length; i += 2) {
      blocks.push({ name: deckBlocks[i].trim(), body: deckBlocks[i + 1] || "" });
    }
  }

  for (const blk of blocks) {
    const cards: ParsedCard[] = [];
    // séparateur = ligne avec --- ou plusieurs tirets
    const items = blk.body.split(/^-{3,}\s*$/m);
    for (const it of items) {
      const m = it.match(/Q:\s*(?:\(([A-Z]+)\))?\s*([\s\S]*?)\nR:\s*([\s\S]*?)$/);
      if (m) {
        const tag = m[1];
        const front = m[2].trim();
        const back = m[3].trim();
        if (front && back) {
          cards.push({ front, back, type: "Q", tags: tag ? [tag] : undefined });
        }
      }
    }
    if (cards.length > 0) {
      decks.push({ folderName: blk.name, cards });
    }
  }
  if (decks.length === 0) return parseSimplePipe(text);
  return { decks, total: decks.reduce((s, d) => s + d.cards.length, 0) };
}
