import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import type { Card, Folder } from "../lib/types";
import { RichText } from "../lib/render";
import { dueState, formatInterval } from "../lib/srs";
import { Plus, Trash, Edit, Play, Upload, FolderIcon } from "./icons";
import { CardEditor } from "./CardEditor";
import { ImportDialog } from "./ImportDialog";
import { Review } from "./Review";

interface Props {
  folder: Folder | null;     // null = racine (vue d'accueil)
}

export function Browse({ folder }: Props) {
  const { childrenOf, deleteCard, allDescendantFolders, data } = useStore();
  const [editing, setEditing] = useState<Card | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reviewing, setReviewing] = useState<{ folder: Folder; includeChildren: boolean } | null>(null);

  if (!folder) {
    // Racine = vue d'accueil
    return (
      <RootHome onImport={() => setImporting(true)} importing={importing} setImporting={setImporting} />
    );
  }

  const subfolders = childrenOf(folder.id);
  const allCardsCount = folder.cards.length + allDescendantFolders(folder.id).reduce((s, f) => s + f.cards.length, 0);
  const dueCount = countDueRecursive(folder, data.folders);

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
      {/* Header dossier */}
      <div className="px-4 md:px-8 py-5 border-b border-app">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted uppercase tracking-wider mb-1">Dossier</div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              {folder.emoji && <span className="text-2xl leading-none">{folder.emoji}</span>}
              <span className="truncate">{folder.name}</span>
            </h1>
            <div className="text-sm text-muted mt-1">
              {folder.cards.length} carte{folder.cards.length > 1 ? "s" : ""} ici · {allCardsCount} au total · {dueCount} à réviser
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {dueCount > 0 && (
              <button
                className="btn btn-primary"
                onClick={() => setReviewing({ folder, includeChildren: true })}
              >
                <Play /> Réviser ({dueCount})
              </button>
            )}
            <button className="btn" onClick={() => setCreating(true)}>
              <Plus /> Carte
            </button>
            <button className="btn" onClick={() => setImporting(true)}>
              <Upload /> Importer
            </button>
          </div>
        </div>
      </div>

      {/* Sous-dossiers */}
      {subfolders.length > 0 && (
        <div className="px-4 md:px-8 py-4 border-b border-app">
          <div className="text-xs uppercase tracking-wider text-muted mb-2 font-medium">Sous-dossiers</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {subfolders.map(sf => (
              <SubfolderCard key={sf.id} folder={sf} />
            ))}
          </div>
        </div>
      )}

      {/* Cartes */}
      <div className="px-4 md:px-8 py-4">
        <div className="text-xs uppercase tracking-wider text-muted mb-2 font-medium">
          Cartes ({folder.cards.length})
        </div>
        {folder.cards.length === 0 ? (
          <div className="text-center py-12 text-muted">
            <div className="text-sm">Aucune carte dans ce dossier.</div>
            <div className="mt-3 flex justify-center gap-2">
              <button className="btn" onClick={() => setCreating(true)}><Plus /> Nouvelle carte</button>
              <button className="btn" onClick={() => setImporting(true)}><Upload /> Importer</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {[...folder.cards].sort(sortByState).map(c => (
              <CardRow
                key={c.id}
                card={c}
                folderId={folder.id}
                onEdit={() => setEditing(c)}
                onDelete={() => {
                  if (confirm("Supprimer cette carte ?")) deleteCard(folder.id, c.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {creating && <CardEditor folderId={folder.id} onClose={() => setCreating(false)} />}
      {editing && <CardEditor folderId={folder.id} card={editing} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog folderId={folder.id} onClose={() => setImporting(false)} />}
      {reviewing && <Review folder={reviewing.folder} includeChildren={reviewing.includeChildren} onClose={() => setReviewing(null)} />}
    </div>
  );
}

function SubfolderCard({ folder }: { folder: Folder }) {
  const { allDescendantFolders, data } = useStore();
  const total = folder.cards.length + allDescendantFolders(folder.id).reduce((s, f) => s + f.cards.length, 0);
  const due = countDueRecursive(folder, data.folders);
  return (
    <div
      className="border border-app rounded-lg p-3 bg-card hover:bg-soft cursor-pointer transition-colors"
      onClick={() => {
        window.dispatchEvent(new CustomEvent("fc:select-folder", { detail: folder.id }));
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-fc", JSON.stringify({ type: "folder", id: folder.id }));
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        {folder.emoji
          ? <span className="text-base leading-none shrink-0 w-4 text-center">{folder.emoji}</span>
          : <FolderIcon className="text-soft shrink-0" />}
        <span className="text-sm font-medium truncate flex-1">{folder.name}</span>
      </div>
      <div className="text-xs text-muted">
        {total} carte{total > 1 ? "s" : ""}{due > 0 && <> · <span className="text-[var(--info)]">{due} dues</span></>}
      </div>
    </div>
  );
}

function CardRow({ card, folderId, onEdit, onDelete }: { card: Card; folderId: string; onEdit: () => void; onDelete: () => void }) {
  const { data } = useStore();
  const ds = dueState(card);
  const labelMap: Record<string, string> = {
    new: "Nouvelle",
    due: "À réviser",
    learning: "Apprentissage",
    relearning: "Oubliée — à reprendre",
    future: "Acquise",
  };
  return (
    <div
      className="border border-app rounded-lg p-3 bg-card hover:bg-soft group"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-fc", JSON.stringify({ type: "card", cardId: card.id, folderId }));
      }}
    >
      <div className="flex items-start gap-3">
        <Dot state={ds} title={labelMap[ds]} className="mt-1.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="prose-card text-sm line-clamp-2"><RichText text={card.front} images={data.images} /></div>
          <div className="prose-card text-xs text-muted mt-1 line-clamp-1"><RichText text={card.back} images={data.images} /></div>
          <div className="text-[10px] text-muted mt-1 flex items-center gap-2 flex-wrap">
            {card.type && <span className="px-1.5 py-0.5 rounded bg-soft border border-app">{card.type}</span>}
            {card.tags?.map(t => <span key={t} className="text-muted">#{t}</span>)}
            <span>· {card.srs.state}{card.srs.interval > 0 ? ` · ${formatInterval(card.srs.interval * 86_400_000)}` : ""}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <button className="btn btn-ghost p-1.5" onClick={onEdit} title="Éditer"><Edit /></button>
          <button className="btn btn-ghost p-1.5" onClick={onDelete} title="Supprimer"><Trash /></button>
        </div>
      </div>
    </div>
  );
}

function Dot({ state, title, className }: { state: "new" | "learning" | "relearning" | "due" | "future"; title?: string; className?: string }) {
  const colors: Record<string, string> = {
    new: "var(--text-muted)",
    learning: "var(--warn)",
    relearning: "var(--bad)",
    due: "var(--info)",
    future: "var(--good)",
  };
  return (
    <span
      title={title}
      className={"inline-block rounded-full " + (className || "")}
      style={{
        width: 9, height: 9,
        background: colors[state],
        boxShadow: state === "future" ? "inset 0 0 0 1px var(--border-strong)" : undefined,
      }}
    />
  );
}

function sortByState(a: Card, b: Card): number {
  const order = (c: Card) => {
    const s = dueState(c);
    if (s === "relearning") return 0;
    if (s === "learning") return 1;
    if (s === "due") return 2;
    if (s === "new") return 3;
    return 4; // future
  };
  const oa = order(a), ob = order(b);
  if (oa !== ob) return oa - ob;
  // dans le même état : par due ascendant
  return a.srs.due - b.srs.due;
}

function countDueRecursive(f: Folder, all: Folder[]): number {
  const now = Date.now();
  let count = 0;
  const walk = (folder: Folder) => {
    for (const c of folder.cards) {
      const s = dueState(c, now);
      if (s === "due" || s === "learning" || s === "new") count++;
    }
    for (const ch of all) if (ch.parentId === folder.id) walk(ch);
  };
  walk(f);
  return count;
}

function RootHome({ onImport, importing, setImporting }: { onImport: () => void; importing: boolean; setImporting: (b: boolean) => void }) {
  const { data, childrenOf, allDescendantFolders, createFolder } = useStore();
  const totalCards = useMemo(() => data.folders.reduce((s, f) => s + f.cards.length, 0), [data.folders]);
  const totalDue = useMemo(() => {
    const now = Date.now();
    let n = 0;
    for (const f of data.folders) for (const c of f.cards) {
      const s = dueState(c, now);
      if (s === "due" || s === "learning" || s === "new") n++;
    }
    return n;
  }, [data.folders]);
  const roots = childrenOf(null);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 md:px-8 py-8 max-w-4xl mx-auto">
        <h1 className="text-3xl font-semibold mb-1">Bienvenue</h1>
        <p className="text-muted mb-6">{totalCards} carte{totalCards > 1 ? "s" : ""} · {totalDue} à réviser maintenant</p>

        <div className="flex flex-wrap gap-2 mb-8">
          <button className="btn btn-primary" onClick={() => {
            const name = prompt("Nom du nouveau dossier ?");
            if (name) createFolder(name, null);
          }}><Plus /> Nouveau dossier</button>
          <button className="btn" onClick={onImport}><Upload /> Importer des cartes</button>
        </div>

        <div className="text-xs uppercase tracking-wider text-muted mb-2 font-medium">Tes dossiers</div>
        {roots.length === 0 ? (
          <div className="border border-dashed border-app rounded-lg p-10 text-center text-muted">
            Aucun dossier. Crée-en un ou importe directement un deck.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {roots.map(r => {
              const total = r.cards.length + allDescendantFolders(r.id).reduce((s, f) => s + f.cards.length, 0);
              const due = countDueRecursive(r, data.folders);
              return (
                <div
                  key={r.id}
                  className="border border-app rounded-lg p-4 bg-card hover:bg-soft cursor-pointer"
                  onClick={() => window.dispatchEvent(new CustomEvent("fc:select-folder", { detail: r.id }))}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {r.emoji
                      ? <span className="text-lg leading-none">{r.emoji}</span>
                      : <FolderIcon className="text-soft" />}
                    <span className="font-medium truncate">{r.name}</span>
                  </div>
                  <div className="text-xs text-muted">{total} cartes · {due} dues</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {importing && <ImportDialog folderId={null} onClose={() => setImporting(false)} />}
    </div>
  );
}
