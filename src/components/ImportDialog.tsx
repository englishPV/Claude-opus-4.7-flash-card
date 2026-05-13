import { useState, useMemo, useRef, useCallback } from "react";
import { useStore } from "../lib/store";
import { parseAuto, toCard, type ParsedDeck } from "../lib/parser";
import { parseApkg, type ApkgProgress } from "../lib/anki";
import { RichText } from "../lib/render";
import type { UUID } from "../lib/types";
import { X, Sparkles, Upload, FolderIcon, Trash } from "./icons";

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

type Source =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "apkg"; fileName: string; decks: ParsedDeck[]; media: Record<string, string>; warnings: string[] }
  | { kind: "json"; fileName: string; text: string };

export function ImportDialog({ folderId, onClose }: Props) {
  const { addCards, createFolder, childrenOf, setData, data } = useStore();

  // ── Source state ──
  const [source, setSource] = useState<Source>({ kind: "none" });
  const [textInput, setTextInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ApkgProgress | null>(null);
  const [error, setError] = useState("");

  // ── Options ──
  const [createSubfolders, setCreateSubfolders] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [targetFolderId, setTargetFolderId] = useState<UUID | "new" | null>(folderId);
  const [previewIdx, setPreviewIdx] = useState(0);

  // ── Drag & drop ──
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Compute parse result. For text: parse on the fly. For apkg: already parsed.
  const decks: ParsedDeck[] = useMemo(() => {
    if (source.kind === "apkg") return source.decks;
    if (source.kind === "json") return parseAuto(source.text).decks;
    if (source.kind === "text") return parseAuto(source.text).decks;
    if (textInput.trim()) return parseAuto(textInput).decks;
    return [];
  }, [source, textInput]);

  const media: Record<string, string> = source.kind === "apkg" ? source.media : {};
  const totalCards = decks.reduce((s, d) => s + d.cards.length, 0);
  const fileName =
    source.kind === "apkg" ? source.fileName :
    source.kind === "json" ? source.fileName : "";

  // List of available folders for target picker
  const allFolders = useMemo(() => {
    return [...data.folders].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.folders]);

  // ── File handling ──
  const handleFile = useCallback(async (file: File) => {
    setError("");
    setProgress(null);
    setSource({ kind: "none" });

    const lower = file.name.toLowerCase();

    if (lower.endsWith(".apkg")) {
      setBusy(true);
      try {
        const result = await parseApkg(file, (p) => setProgress(p));
        if (result.decks.length === 0) {
          setError("Aucune carte trouvée dans ce fichier.");
        } else {
          setSource({
            kind: "apkg",
            fileName: file.name,
            decks: result.decks,
            media: result.media,
            warnings: result.warnings,
          });
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setBusy(false);
        setProgress(null);
      }
      return;
    }

    if (lower.endsWith(".json") || lower.endsWith(".txt") || lower.endsWith(".md")) {
      try {
        const text = await file.text();
        setSource({ kind: "json", fileName: file.name, text });
        setTextInput("");
      } catch (e: any) {
        setError("Lecture impossible : " + (e?.message || e));
      }
      return;
    }

    setError(`Format non reconnu : .${lower.split(".").pop()}. Formats acceptés : .apkg, .json, .txt, .md`);
  }, []);

  // Drag & drop handlers
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      dragCounter.current++;
      setDragOver(true);
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Import action ──
  const doImport = () => {
    if (totalCards === 0) {
      alert("Aucune carte à importer.");
      return;
    }

    // Index existing cards for duplicate detection
    const existingFronts = new Set<string>();
    if (skipDuplicates) {
      for (const f of data.folders) {
        for (const c of f.cards) {
          existingFronts.add(normalizeForDup(c.front));
        }
      }
    }

    // Merge media first
    if (Object.keys(media).length > 0) {
      setData(d => { Object.assign(d.images, media); });
    }

    let imported = 0;
    let skipped = 0;

    const importToFolder = (folderId: UUID, deckCards: typeof decks[number]["cards"]) => {
      const cards = deckCards.filter(c => {
        if (!skipDuplicates) return true;
        const k = normalizeForDup(c.front);
        if (existingFronts.has(k)) { skipped++; return false; }
        existingFronts.add(k);
        return true;
      }).map(toCard);
      if (cards.length > 0) addCards(folderId, cards);
      imported += cards.length;
    };

    const target = targetFolderId;

    if (target === "new" || target === null) {
      // Create root folder(s) from decks
      for (const deck of decks) {
        const name = deck.folderName || (fileName ? fileName.replace(/\.[^.]+$/, "") : "Import");
        if (createSubfolders && decks.length > 1) {
          const f = createFolder(name, null);
          importToFolder(f.id, deck.cards);
        } else {
          // Everything in one new folder
          let f = childrenOf(null).find(x => x.name === name);
          if (!f) f = createFolder(name, null);
          importToFolder(f.id, deck.cards);
        }
      }
    } else {
      // Import into a specific existing folder
      for (const deck of decks) {
        if (createSubfolders && deck.folderName && decks.length > 1) {
          const existing = childrenOf(target).find(f => f.name === deck.folderName);
          const sub = existing || createFolder(deck.folderName, target);
          importToFolder(sub.id, deck.cards);
        } else {
          importToFolder(target, deck.cards);
        }
      }
    }

    if (skipped > 0) {
      alert(`✅ ${imported} carte(s) importée(s).\n⏭ ${skipped} doublon(s) ignoré(s).`);
    } else {
      alert(`✅ ${imported} carte(s) importée(s).`);
    }
    onClose();
  };

  const reset = () => {
    setSource({ kind: "none" });
    setTextInput("");
    setError("");
    setProgress(null);
    setPreviewIdx(0);
  };

  const copyAIPrompt = () => {
    navigator.clipboard.writeText(AI_PROMPT).then(
      () => alert("Prompt copié."),
      () => prompt("Copie ce prompt :", AI_PROMPT)
    );
  };

  // ── Preview card (real render with KaTeX + images) ──
  const allCards = useMemo(() => decks.flatMap(d => d.cards), [decks]);
  const currentPreview = allCards[Math.min(previewIdx, allCards.length - 1)];

  // Block close while busy
  const handleBackdropDown = (e: React.PointerEvent) => {
    if (busy) return;
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 fade-in"
      onPointerDown={handleBackdropDown}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className="bg-card border border-app rounded-xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col card-shadow relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-10 bg-[var(--info)]/10 border-4 border-dashed border-[var(--info)] rounded-xl flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-4xl mb-2">📂</div>
              <div className="font-medium">Lâche le fichier ici</div>
              <div className="text-xs text-muted mt-1">.apkg · .json · .txt · .md</div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app shrink-0">
          <div className="text-sm font-medium">Importer des cartes</div>
          <div className="flex items-center gap-1">
            <button
              className="btn btn-ghost text-xs gap-1"
              onClick={copyAIPrompt}
              title="Prompt à donner à ChatGPT pour convertir un cours en flashcards"
            >
              <Sparkles /> Prompt IA
            </button>
            <button className="btn btn-ghost p-1" onClick={onClose} disabled={busy}>
              <X />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Step 1: Source selection (when no source loaded yet) */}
          {source.kind === "none" && !textInput.trim() && !busy && (
            <div className="p-6 space-y-4">
              <div
                className="border-2 border-dashed border-app rounded-xl p-8 text-center hover:bg-soft cursor-pointer transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mx-auto mb-3 text-muted" />
                <div className="font-medium mb-1">Glisse un fichier ici, ou clique pour choisir</div>
                <div className="text-xs text-muted">
                  Anki <code>.apkg</code> · CrowdAnki <code>.json</code> · Markdown · Texte brut
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".apkg,.json,.txt,.md"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.currentTarget.value = "";
                  }}
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-app" />
                <span className="text-xs text-muted uppercase tracking-wider">ou</span>
                <div className="flex-1 h-px bg-app" />
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">
                  Coller du texte
                </div>
                <textarea
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  rows={8}
                  className="w-full p-3 rounded-lg border border-app bg-soft font-mono text-xs resize-y"
                  placeholder={`Formats détectés automatiquement :\n• Markdown  (### Carte 1 [M]…)\n• Q:/R:    (avec === DECK : === )\n• Pipe     (id|fr|en|tag)\n• Front | Back\n• JSON CrowdAnki`}
                />
              </div>
            </div>
          )}

          {/* Step 2: Loading */}
          {busy && (
            <div className="p-10 text-center">
              <div className="text-2xl mb-3">⏳</div>
              <div className="font-medium mb-2">{progress?.phase || "Traitement…"}</div>
              {progress?.detail && (
                <div className="text-xs text-muted mb-3 truncate max-w-md mx-auto">{progress.detail}</div>
              )}
              {typeof progress?.percent === "number" && (
                <div className="max-w-xs mx-auto">
                  <div className="h-2 rounded-full bg-soft overflow-hidden">
                    <div
                      className="h-full bg-[var(--info)] transition-all duration-150"
                      style={{ width: `${Math.max(2, progress.percent)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted mt-1.5">{Math.round(progress.percent)}%</div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Preview + options + import */}
          {!busy && (source.kind !== "none" || textInput.trim()) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
              {/* Left: source info + options */}
              <div className="space-y-3 min-w-0">
                <div className="border border-app rounded-lg p-3 bg-soft">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-muted font-medium mb-1">Source</div>
                      <div className="font-medium text-sm truncate">
                        {fileName || "Texte collé"}
                      </div>
                      <div className="text-xs text-muted mt-0.5">
                        {totalCards} carte{totalCards > 1 ? "s" : ""} · {decks.length} deck{decks.length > 1 ? "s" : ""}
                        {Object.keys(media).length > 0 && <> · {Object.keys(media).length} image{Object.keys(media).length > 1 ? "s" : ""}</>}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost p-1 shrink-0"
                      onClick={reset}
                      title="Recommencer"
                    >
                      <Trash />
                    </button>
                  </div>

                  {source.kind === "apkg" && source.warnings.length > 0 && (
                    <div className="mt-2 text-xs text-[var(--warn)] space-y-0.5">
                      {source.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                    </div>
                  )}
                </div>

                {/* If we used the textarea */}
                {source.kind === "none" && textInput.trim() && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted font-medium mb-1.5">
                      Texte
                    </div>
                    <textarea
                      value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      rows={6}
                      className="w-full p-3 rounded-lg border border-app bg-soft font-mono text-xs resize-y"
                    />
                  </div>
                )}

                {/* Target folder */}
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted font-medium mb-1.5">
                    Importer dans
                  </div>
                  <select
                    className="w-full p-2 rounded-lg border border-app bg-soft text-sm"
                    value={targetFolderId === null ? "__root__" : targetFolderId}
                    onChange={e => {
                      const v = e.target.value;
                      setTargetFolderId(v === "__root__" ? null : v as UUID);
                    }}
                  >
                    <option value="__root__">📁 Racine — créer de nouveaux dossiers</option>
                    {allFolders.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.emoji ? f.emoji + " " : "📁 "}{f.name} ({f.cards.length})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Options */}
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={createSubfolders}
                      onChange={e => setCreateSubfolders(e.target.checked)}
                    />
                    <span>Créer un sous-dossier par deck</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={e => setSkipDuplicates(e.target.checked)}
                    />
                    <span>Ignorer les doublons (même recto)</span>
                  </label>
                </div>

                {/* Decks list */}
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted font-medium mb-1.5">
                    Decks détectés
                  </div>
                  <div className="border border-app rounded-lg bg-app max-h-44 overflow-y-auto">
                    {decks.map((deck, i) => (
                      <div
                        key={i}
                        className="px-3 py-2 border-b border-app last:border-b-0 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <FolderIcon className="text-soft shrink-0" />
                          <span className="text-sm truncate">{deck.folderName || "(sans titre)"}</span>
                        </div>
                        <span className="text-xs text-muted shrink-0">{deck.cards.length}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right: live card preview */}
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wider text-muted font-medium mb-1.5 flex items-center justify-between">
                  <span>Aperçu</span>
                  {allCards.length > 0 && (
                    <span className="text-muted font-normal">
                      Carte {Math.min(previewIdx + 1, allCards.length)}/{allCards.length}
                    </span>
                  )}
                </div>
                {currentPreview ? (
                  <div className="space-y-2">
                    <div className="border border-app rounded-lg p-3 bg-app prose-card text-sm overflow-hidden">
                      <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5">Recto</div>
                      <RichText text={currentPreview.front} images={{ ...data.images, ...media }} />
                    </div>
                    <div className="border border-app rounded-lg p-3 bg-app prose-card text-sm overflow-hidden">
                      <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5">Verso</div>
                      <RichText text={currentPreview.back} images={{ ...data.images, ...media }} />
                    </div>
                    <div className="flex justify-between gap-2">
                      <button
                        className="btn flex-1"
                        disabled={previewIdx === 0}
                        onClick={() => setPreviewIdx(i => Math.max(0, i - 1))}
                      >
                        ← Précédente
                      </button>
                      <button
                        className="btn flex-1"
                        disabled={previewIdx >= allCards.length - 1}
                        onClick={() => setPreviewIdx(i => Math.min(allCards.length - 1, i + 1))}
                      >
                        Suivante →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="border border-dashed border-app rounded-lg p-8 text-center text-muted text-sm">
                    Aucune carte à prévisualiser.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="mx-4 mb-4 rounded-lg border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,transparent)] p-3 text-sm">
              ❌ {error}
              <button className="block mt-2 text-xs underline" onClick={() => setError("")}>Fermer</button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-app bg-soft shrink-0">
          <div className="text-xs text-muted hidden sm:block">
            Glisser-déposer fonctionne aussi sur cette fenêtre.
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
            <button
              className="btn btn-primary"
              disabled={busy || totalCards === 0}
              onClick={doImport}
            >
              Importer {totalCards > 0 ? `(${totalCards})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function normalizeForDup(s: string): string {
  return s.toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
