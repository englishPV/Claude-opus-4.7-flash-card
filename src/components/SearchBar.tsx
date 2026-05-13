import { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { Search, X } from "./icons";
import { RichText } from "../lib/render";

interface Props {
  onOpen: (folderId: string, cardId: string) => void;
}

export function SearchBar({ onOpen }: Props) {
  const { searchAll, data } = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchAll(q), [q, searchAll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => document.getElementById("global-search")?.focus(), 50);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        className="btn btn-ghost gap-2 text-sm text-muted w-full max-w-xs justify-start"
        onClick={() => { setOpen(true); setTimeout(() => document.getElementById("global-search")?.focus(), 50); }}
      >
        <Search />
        <span className="hidden sm:inline">Rechercher</span>
        <span className="ml-auto text-[10px] hidden md:inline border border-app rounded px-1 py-0.5">⌘K</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-[10vh] fade-in" onClick={() => setOpen(false)}>
          <div className="bg-card border border-app rounded-xl w-full max-w-2xl card-shadow overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center px-3 py-2 border-b border-app">
              <Search className="text-muted" />
              <input
                id="global-search"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Rechercher dans toutes les cartes…"
                className="flex-1 px-3 py-2 text-sm bg-transparent"
                autoFocus
              />
              <button className="btn btn-ghost p-1" onClick={() => setOpen(false)}><X /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {q.trim() === "" && (
                <div className="p-8 text-center text-sm text-muted">
                  Cherche dans tous tes dossiers d'un seul coup.
                </div>
              )}
              {q.trim() !== "" && results.length === 0 && (
                <div className="p-8 text-center text-sm text-muted">Aucun résultat.</div>
              )}
              {results.map(({ folder, card }) => (
                <button
                  key={card.id}
                  className="w-full text-left px-3 py-2.5 border-b border-app hover:bg-soft last:border-b-0"
                  onClick={() => { onOpen(folder.id, card.id); setOpen(false); }}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted mb-0.5">{folder.name}</div>
                  <div className="text-sm prose-card line-clamp-1"><RichText text={card.front} images={data.images} /></div>
                  <div className="text-xs text-muted prose-card line-clamp-1"><RichText text={card.back} images={data.images} /></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
