import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Card, Folder, Rating, ReviewLog, UUID } from "./types";
import { loadData, saveData, defaultData } from "./storage";
import { newSrs, rate as srsRate } from "./srs";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

interface StoreCtx {
  data: AppData;
  setData: (updater: (d: AppData) => AppData | void) => void;

  // Folders
  createFolder: (name: string, parentId: UUID | null, emoji?: string) => Folder;
  renameFolder: (id: UUID, name: string) => void;
  setFolderEmoji: (id: UUID, emoji: string) => void;
  deleteFolder: (id: UUID) => void;
  moveFolder: (id: UUID, newParentId: UUID | null) => void;

  // Cards
  addCards: (folderId: UUID, cards: Card[]) => void;
  upsertCard: (folderId: UUID, card: Card) => void;
  deleteCard: (folderId: UUID, cardId: UUID) => void;
  moveCard: (cardId: UUID, fromFolderId: UUID, toFolderId: UUID) => void;
  rateCard: (folderId: UUID, cardId: UUID, rating: Rating) => void;

  // Settings
  toggleTheme: () => void;
  setFontScale: (which: "front" | "back", value: number) => void;

  // Search
  searchAll: (q: string) => { folder: Folder; card: Card }[];

  // Helpers
  childrenOf: (id: UUID | null) => Folder[];
  pathOf: (id: UUID) => Folder[];
  getFolder: (id: UUID) => Folder | undefined;
  allDescendantFolders: (id: UUID) => Folder[];
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setDataState] = useState<AppData>(() => loadData());
  const dataRef = useRef(data);
  dataRef.current = data;

  // Persist (debounced)
  useEffect(() => {
    const id = setTimeout(() => saveData(data), 200);
    return () => clearTimeout(id);
  }, [data]);

  // Theme
  useEffect(() => {
    const root = document.documentElement;
    if (data.settings.theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [data.settings.theme]);

  const setData = useCallback((updater: (d: AppData) => AppData | void) => {
    setDataState(prev => {
      const draft = JSON.parse(JSON.stringify(prev)) as AppData;
      const r = updater(draft);
      return r ?? draft;
    });
  }, []);

  // ---------- FOLDERS ----------
  const createFolder = useCallback((name: string, parentId: UUID | null, emoji?: string) => {
    const f: Folder = { id: uid(), name: name.trim() || "Sans titre", emoji, parentId, createdAt: Date.now(), cards: [] };
    setData(d => { d.folders.push(f); });
    return f;
  }, [setData]);

  const renameFolder = useCallback((id: UUID, name: string) => {
    setData(d => {
      const f = d.folders.find(x => x.id === id);
      if (f) f.name = name.trim() || f.name;
    });
  }, [setData]);

  const setFolderEmoji = useCallback((id: UUID, emoji: string) => {
    setData(d => {
      const f = d.folders.find(x => x.id === id);
      if (f) f.emoji = emoji.trim() || undefined;
    });
  }, [setData]);

  const allDescendantFolders = useCallback((id: UUID) => {
    const result: Folder[] = [];
    const walk = (pid: UUID) => {
      for (const f of dataRef.current.folders) {
        if (f.parentId === pid) {
          result.push(f);
          walk(f.id);
        }
      }
    };
    walk(id);
    return result;
  }, []);

  const deleteFolder = useCallback((id: UUID) => {
    const ids = new Set<UUID>([id]);
    // collecte récursive
    const walk = (pid: UUID) => {
      for (const f of dataRef.current.folders) {
        if (f.parentId === pid) { ids.add(f.id); walk(f.id); }
      }
    };
    walk(id);
    setData(d => {
      d.folders = d.folders.filter(f => !ids.has(f.id));
    });
  }, [setData]);

  const moveFolder = useCallback((id: UUID, newParentId: UUID | null) => {
    // empêche cycle
    if (id === newParentId) return;
    if (newParentId) {
      const desc = allDescendantFolders(id);
      if (desc.some(d => d.id === newParentId)) return;
    }
    setData(d => {
      const f = d.folders.find(x => x.id === id);
      if (f) f.parentId = newParentId;
    });
  }, [setData, allDescendantFolders]);

  // ---------- CARDS ----------
  const addCards = useCallback((folderId: UUID, cards: Card[]) => {
    setData(d => {
      const f = d.folders.find(x => x.id === folderId);
      if (f) f.cards.push(...cards);
    });
  }, [setData]);

  const upsertCard = useCallback((folderId: UUID, card: Card) => {
    setData(d => {
      const f = d.folders.find(x => x.id === folderId);
      if (!f) return;
      const idx = f.cards.findIndex(c => c.id === card.id);
      card.updatedAt = Date.now();
      if (idx >= 0) f.cards[idx] = card;
      else f.cards.push(card);
    });
  }, [setData]);

  const deleteCard = useCallback((folderId: UUID, cardId: UUID) => {
    setData(d => {
      const f = d.folders.find(x => x.id === folderId);
      if (f) f.cards = f.cards.filter(c => c.id !== cardId);
    });
  }, [setData]);

  const moveCard = useCallback((cardId: UUID, fromFolderId: UUID, toFolderId: UUID) => {
    if (fromFolderId === toFolderId) return;
    setData(d => {
      const fromF = d.folders.find(x => x.id === fromFolderId);
      const toF = d.folders.find(x => x.id === toFolderId);
      if (!fromF || !toF) return;
      const idx = fromF.cards.findIndex(c => c.id === cardId);
      if (idx < 0) return;
      const [card] = fromF.cards.splice(idx, 1);
      toF.cards.push(card);
    });
  }, [setData]);

  const rateCard = useCallback((folderId: UUID, cardId: UUID, rating: Rating) => {
    setData(d => {
      const f = d.folders.find(x => x.id === folderId);
      if (!f) return;
      const c = f.cards.find(x => x.id === cardId);
      if (!c) return;
      const r = srsRate(c, rating);
      const log: ReviewLog = {
        cardId: c.id,
        ts: Date.now(),
        rating,
        prevInterval: r.prevInterval,
        newInterval: r.newInterval,
      };
      c.srs = r.srs;
      d.history.push(log);
      if (d.history.length > 5000) d.history.splice(0, d.history.length - 5000);
    });
  }, [setData]);

  // ---------- SETTINGS ----------
  const toggleTheme = useCallback(() => {
    setData(d => { d.settings.theme = d.settings.theme === "dark" ? "light" : "dark"; });
  }, [setData]);

  const setFontScale = useCallback((which: "front" | "back", value: number) => {
    const v = Math.max(0.6, Math.min(3, value));
    setData(d => {
      if (which === "front") d.settings.fontScaleFront = v;
      else d.settings.fontScaleBack = v;
    });
  }, [setData]);

  // ---------- SEARCH ----------
  const searchAll = useCallback((q: string) => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const res: { folder: Folder; card: Card }[] = [];
    for (const f of dataRef.current.folders) {
      for (const c of f.cards) {
        const hay = (c.front + " " + c.back + " " + (c.tags?.join(" ") || "")).toLowerCase();
        if (hay.includes(term)) res.push({ folder: f, card: c });
        if (res.length > 200) return res;
      }
    }
    return res;
  }, []);

  // ---------- HELPERS ----------
  const childrenOf = useCallback((id: UUID | null) => {
    return data.folders.filter(f => f.parentId === id).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.folders]);

  const pathOf = useCallback((id: UUID) => {
    const path: Folder[] = [];
    let cur = data.folders.find(f => f.id === id);
    while (cur) {
      path.unshift(cur);
      cur = cur.parentId ? data.folders.find(f => f.id === cur!.parentId) : undefined;
    }
    return path;
  }, [data.folders]);

  const getFolder = useCallback((id: UUID) => data.folders.find(f => f.id === id), [data.folders]);

  const value: StoreCtx = useMemo(() => ({
    data, setData,
    createFolder, renameFolder, setFolderEmoji, deleteFolder, moveFolder,
    addCards, upsertCard, deleteCard, moveCard, rateCard,
    toggleTheme, setFontScale,
    searchAll, childrenOf, pathOf, getFolder, allDescendantFolders,
  }), [data, setData, createFolder, renameFolder, setFolderEmoji, deleteFolder, moveFolder, addCards, upsertCard, deleteCard, moveCard, rateCard, toggleTheme, setFontScale, searchAll, childrenOf, pathOf, getFolder, allDescendantFolders]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("StoreProvider missing");
  return v;
}

export { uid, defaultData, newSrs };
