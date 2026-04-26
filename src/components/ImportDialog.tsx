import { useState, useMemo } from "react";
import { useStore } from "../lib/store";
import { parseAuto, toCard } from "../lib/parser";
import type { UUID } from "../lib/types";
import { X, Sparkles, Copy, Upload } from "./icons";

const AI_PROMPT = `Tu es un assistant qui convertit du contenu de cours en flashcards au format suivant (à coller tel quel) :

# Nom du chapitre

### Carte 1 [M] — Sous-titre
**RECTO :** Question / problème (LaTeX entre $...$ accepté)
**VERSO :** Réponse claire et structurée

### Carte 2 [T] — Sous-titre
**RECTO :** ...
**VERSO :** ...

Règles :
- [M] Méthode, [T] Théorème, [C] Calcul, [P] Piège
- Sépare clairement chaque carte
- Utilise du LaTeX entre $...$ pour les formules inline et $$...$$ pour les blocs
- Pas de phrases trop longues côté recto

Voici le contenu à convertir :
[COLLE TON COURS ICI]`;

interface Props {
  folderId: UUID | null;
  onClose: () => void;
}

export function ImportDialog({ folderId, onClose }: Props) {
  const { addCards, createFolder, childrenOf } = useStore();
  const [text, setText] = useState("");
  const [createSubfolders, setCreateSubfolders] = useState(true);

  const result = useMemo(() => parseAuto(text), [text]);

  const doImport = () => {
    if (result.total === 0) {
      alert("Aucune carte détectée.");
      return;
    }
    let imported = 0;

    if (folderId === null) {
      // racine -> on crée un dossier par deck
      for (const deck of result.decks) {
        const name = deck.folderName || "Import du " + new Date().toLocaleDateString();
        const f = createFolder(name, null);
        addCards(f.id, deck.cards.map(toCard));
        imported += deck.cards.length;
      }
    } else {
      for (const deck of result.decks) {
        if (createSubfolders && deck.folderName && result.decks.length > 1) {
          // sous-dossier dans le dossier sélectionné
          const existing = childrenOf(folderId).find(f => f.name === deck.folderName);
          const target = existing || createFolder(deck.folderName, folderId);
          addCards(target.id, deck.cards.map(toCard));
        } else {
          addCards(folderId, deck.cards.map(toCard));
        }
        imported += deck.cards.length;
      }
    }
    alert(`${imported} carte(s) importée(s) !`);
    onClose();
  };

  const copyAIPrompt = () => {
    navigator.clipboard.writeText(AI_PROMPT).then(() => {
      alert("Prompt copié ! Colle-le dans ChatGPT / Gemini avec ton cours.");
    }).catch(() => {
      prompt("Copie ce prompt :", AI_PROMPT);
    });
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 fade-in" onClick={onClose}>
      <div className="bg-card border border-app rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col card-shadow" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-app">
          <div className="text-sm font-medium">Importer des cartes</div>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost text-xs gap-1" onClick={copyAIPrompt} title="Copier un prompt à donner à ChatGPT pour convertir n'importe quel cours">
              <Sparkles /> Prompt IA
            </button>
            <button className="btn btn-ghost p-1" onClick={onClose}><X /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1.5 font-medium">Colle ton texte ici</div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={20}
              className="w-full p-3 rounded-lg border border-app bg-soft font-mono text-xs resize-y"
              placeholder="Format Markdown (### Carte 1 [M]...), Q:/R:, pipe, ou JSON Anki."
            />
            <div className="flex items-center gap-2 mt-2">
              <label className="btn btn-ghost text-xs gap-1 cursor-pointer">
                <Upload /> Importer un fichier .json (Anki / CrowdAnki)
                <input type="file" accept=".json,.colpkg,.anki2" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    const reader = new FileReader();
                    reader.onload = () => { setText(String(reader.result)); };
                    reader.readAsText(f);
                  }
                  e.currentTarget.value = "";
                }} />
              </label>
            </div>
            <label className="flex items-center gap-2 mt-2 text-xs text-soft">
              <input type="checkbox" checked={createSubfolders} onChange={e => setCreateSubfolders(e.target.checked)} />
              Créer un sous-dossier par deck (si plusieurs # détectés)
            </label>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1.5 font-medium">
              Aperçu : {result.total} carte(s) — {result.decks.length} deck(s)
            </div>
            <div className="border border-app rounded-lg bg-app overflow-y-auto" style={{ maxHeight: 460 }}>
              {result.decks.length === 0 && (
                <div className="p-6 text-center text-muted text-sm">
                  Colle du texte à gauche, le format est détecté automatiquement.
                </div>
              )}
              {result.decks.map((deck, i) => (
                <div key={i} className="border-b border-app last:border-b-0">
                  <div className="px-3 py-2 bg-soft text-xs font-medium flex justify-between">
                    <span>{deck.folderName || "(sans titre)"}</span>
                    <span className="text-muted">{deck.cards.length} cartes</span>
                  </div>
                  <div className="divide-y divide-app">
                    {deck.cards.slice(0, 8).map((c, j) => (
                      <div key={j} className="px-3 py-2 text-xs">
                        <div className="text-soft truncate">{stripMd(c.front)}</div>
                        <div className="text-muted truncate">→ {stripMd(c.back)}</div>
                      </div>
                    ))}
                    {deck.cards.length > 8 && (
                      <div className="px-3 py-1.5 text-xs text-muted">… +{deck.cards.length - 8} autres</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-app bg-soft">
          <div className="text-xs text-muted">
            <Copy className="inline" /> Tu peux aussi cliquer "Prompt IA" puis donner ton cours brut à ChatGPT.
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={onClose}>Annuler</button>
            <button className="btn btn-primary" disabled={result.total === 0} onClick={doImport}>
              Importer {result.total > 0 ? `(${result.total})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function stripMd(s: string) {
  return s.replace(/[*_`#]/g, "").replace(/\$([^\$]+)\$/g, "$1").replace(/\s+/g, " ").trim().slice(0, 80);
}
