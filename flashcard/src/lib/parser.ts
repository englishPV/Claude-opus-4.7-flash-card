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
