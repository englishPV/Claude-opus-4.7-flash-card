import type { AppData } from "./types";

const KEY = "flashcards.app.v1";

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw) as AppData;
    return migrate(parsed);
  } catch (e) {
    console.warn("loadData fail", e);
    return defaultData();
  }
}

export function saveData(data: AppData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("saveData fail", e);
  }
}

export function defaultData(): AppData {
  return {
    version: 1,
    folders: [],
    settings: {
      theme: (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
      fontScaleFront: 1,
      fontScaleBack: 1,
      newPerDay: 20,
      reviewsPerDay: 200,
      showEmojiInFolderRename: false,
      showMathToolbar: true,
      compactMode: false,
    },
    images: {},
    history: [],
  };
}

function migrate(d: AppData): AppData {
  if (!d.version) d.version = 1;
  if (!d.settings) d.settings = defaultData().settings;
  d.settings = { ...defaultData().settings, ...d.settings };
  if (!d.images) d.images = {};
  if (!d.history) d.history = [];
  if (!Array.isArray(d.folders)) d.folders = [];
  // s'assurer que chaque carte a srs
  for (const f of d.folders) {
    if (!Array.isArray(f.cards)) f.cards = [];
    for (const c of f.cards) {
      if (!c.srs) {
        c.srs = {
          ease: 2.5, interval: 0, reps: 0, lapses: 0,
          due: Date.now(), lastReview: null, state: "new", step: 0,
        };
      }
    }
  }
  return d;
}
