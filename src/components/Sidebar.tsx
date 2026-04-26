import { useState, useRef, useEffect } from "react";
import { useStore } from "../lib/store";
import type { Folder, UUID } from "../lib/types";
import { ChevronDown, ChevronRight, FolderIcon, FolderOpenIcon, ImageIcon, Plus } from "./icons";

interface Props {
  selectedId: UUID | null;
  onSelect: (id: UUID | null) => void;
}

export function Sidebar({ selectedId, onSelect }: Props) {
  const { childrenOf, createFolder, moveFolder, data } = useStore();
  const roots = childrenOf(null);
  const [expanded, setExpanded] = useState<Set<UUID>>(() => new Set());
  const [rootOver, setRootOver] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex items-center justify-between border-b border-app">
        <span className="text-xs uppercase tracking-wider text-muted font-medium">Dossiers</span>
        <button
          className="btn btn-ghost p-1.5"
          title="Nouveau dossier racine"
          onClick={() => {
            const name = prompt("Nom du dossier ? (tu pourras ajouter un emoji ensuite)");
            if (name) {
              const f = createFolder(name, null);
              onSelect(f.id);
            }
          }}
        >
          <Plus />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        <div
          className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
            selectedId === null ? "bg-soft" : "hover:bg-soft"
          } ${rootOver ? "drop-target" : ""}`}
          onClick={() => onSelect(null)}
          onDragOver={(e) => { e.preventDefault(); setRootOver(true); }}
          onDragLeave={() => setRootOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setRootOver(false);
            const raw = e.dataTransfer.getData("application/x-fc");
            if (!raw) return;
            try {
              const p = JSON.parse(raw);
              if (p.type === "folder") moveFolder(p.id, null);
            } catch {}
          }}
        >
          <FolderOpenIcon />
          <span className="font-medium">Accueil</span>
        </div>
        <div
          className="px-3 py-2 text-sm cursor-pointer flex items-center gap-2 hover:bg-soft"
          onClick={() => window.dispatchEvent(new CustomEvent("fc:open-images"))}
        >
          <ImageIcon />
          <span className="font-medium">Images</span>
          <span className="ml-auto text-xs text-muted">{Object.keys(data.images).length}</span>
        </div>
        {roots.map(r => (
          <Node
            key={r.id}
            folder={r}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            expanded={expanded}
            setExpanded={setExpanded}
          />
        ))}
      </div>
    </div>
  );
}

function Node({
  folder, depth, selectedId, onSelect, expanded, setExpanded,
}: {
  folder: Folder;
  depth: number;
  selectedId: UUID | null;
  onSelect: (id: UUID | null) => void;
  expanded: Set<UUID>;
  setExpanded: (s: Set<UUID>) => void;
}) {
  const { childrenOf, createFolder, renameFolder, setFolderEmoji, deleteFolder, moveFolder, moveCard, allDescendantFolders, data } = useStore();
  const children = childrenOf(folder.id);
  const isOpen = expanded.has(folder.id);
  const [over, setOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // ferme le menu au clic externe
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as globalThis.Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const n = new Set(expanded);
    if (isOpen) n.delete(folder.id); else n.add(folder.id);
    setExpanded(n);
  };

  const ensureExpanded = () => {
    const n = new Set(expanded); n.add(folder.id); setExpanded(n);
  };

  return (
    <div>
      <div
        className={`px-2 py-2 text-sm cursor-pointer flex items-center gap-1.5 group ${
          selectedId === folder.id ? "bg-soft" : "hover:bg-soft"
        } ${over ? "drop-target" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(folder.id)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-fc", JSON.stringify({ type: "folder", id: folder.id }));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const raw = e.dataTransfer.getData("application/x-fc");
          if (!raw) return;
          try {
            const p = JSON.parse(raw);
            if (p.type === "folder" && p.id !== folder.id) {
              const desc = allDescendantFolders(p.id);
              if (desc.some(d => d.id === folder.id)) return;
              moveFolder(p.id, folder.id);
              ensureExpanded();
            } else if (p.type === "card") {
              moveCard(p.cardId, p.folderId, folder.id);
            }
          } catch {}
        }}
      >
        <button onClick={toggle} className="text-muted shrink-0 p-0.5 -ml-0.5">
          {children.length > 0
            ? (isOpen ? <ChevronDown /> : <ChevronRight />)
            : <span style={{ width: 16, display: "inline-block" }} />}
        </button>
        {folder.emoji ? (
          <span className="text-base leading-none shrink-0 w-4 text-center">{folder.emoji}</span>
        ) : (
          isOpen ? <FolderOpenIcon className="text-soft shrink-0" /> : <FolderIcon className="text-soft shrink-0" />
        )}
        <span className="truncate flex-1">{folder.name}</span>
        <span className="text-xs text-muted shrink-0 tabular-nums">{folder.cards.length}</span>
        <div className="relative shrink-0" ref={menuRef}>
          <button
            className="btn btn-ghost p-1 leading-none text-muted opacity-60 md:opacity-0 md:group-hover:opacity-100"
            title="Options"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-40 bg-card border border-app rounded-lg card-shadow py-1 w-48 fade-in"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuItem onClick={() => {
                setMenuOpen(false);
                const name = prompt("Nom du sous-dossier ?");
                if (name) { createFolder(name, folder.id); ensureExpanded(); }
              }}>＋ Nouveau sous-dossier</MenuItem>
              <MenuItem onClick={() => {
                setMenuOpen(false);
                const name = prompt("Renommer :", folder.name);
                if (name) renameFolder(folder.id, name);
                if (name && data.settings.showEmojiInFolderRename) {
                  const e = prompt("Emoji du dossier (vide pour retirer) :", folder.emoji || "");
                  if (e !== null) setFolderEmoji(folder.id, e);
                }
              }}>✎ Renommer</MenuItem>
              <MenuItem onClick={() => {
                setMenuOpen(false);
                const e = prompt("Emoji du dossier (vide pour retirer) :", folder.emoji || "");
                if (e !== null) setFolderEmoji(folder.id, e);
              }}>😀 Emoji…</MenuItem>
              <div className="border-t border-app my-1" />
              <MenuItem danger onClick={() => {
                setMenuOpen(false);
                if (confirm(`Supprimer "${folder.name}" et tout son contenu ?`)) {
                  deleteFolder(folder.id);
                  if (selectedId === folder.id) onSelect(null);
                }
              }}>🗑 Supprimer</MenuItem>
            </div>
          )}
        </div>
      </div>
      {isOpen && children.map(c => (
        <Node
          key={c.id}
          folder={c}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          expanded={expanded}
          setExpanded={setExpanded}
        />
      ))}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className="w-full text-left px-3 py-1.5 text-sm hover:bg-soft transition-colors"
      style={{ color: danger ? "var(--bad)" : undefined }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
