/**
 * Firebase sync — RTDB uniquement, pas de Storage.
 *
 * Stratégie :
 *  - flashcardData   : JSON des cartes/dossiers/settings, SANS images (~quelques Ko)
 *  - imageManifest   : { [safeKey]: { name, chunkCount, size } }
 *  - imageChunks/{safeKey}/c{i} : chaque image découpée en tranches de 900 Ko max
 *
 * RTDB limite : 10 Mo par écriture unitaire.
 * Une image base64 de 3 Mo originale = ~4 Mo base64 → 5 chunks de 900 Ko → OK.
 * On évite complètement Firebase Storage et ses règles.
 */
import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged, type User
} from "firebase/auth";
import { getDatabase, ref as dbRef, set, get, remove } from "firebase/database";
import type { AppData } from "./types";

const firebaseConfig = {
  apiKey: "AIzaSyCc8-kMmHvJagbj-nV4ZGcWDUXYytRrD0I",
  authDomain: "englishpv-b6727.firebaseapp.com",
  databaseURL: "https://englishpv-b6727-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "englishpv-b6727",
  storageBucket: "englishpv-b6727.firebasestorage.app",
  messagingSenderId: "285413164654",
  appId: "1:285413164654:web:a0d8d27dfa0009ab45887f",
  measurementId: "G-VKX6DSZV4Z"
};

const CHUNK_SIZE = 900_000; // 900 Ko — bien en dessous de la limite RTDB 10 Mo

let app: ReturnType<typeof initializeApp> | null = null;
let isInit = false;

function ensureInit() {
  if (!isInit) { app = initializeApp(firebaseConfig); isInit = true; }
}

// Encode le nom de fichier en clé RTDB-safe (pas de . / # $ [ ])
function toKey(name: string): string {
  return encodeURIComponent(name).replace(/\./g, "%2E");
}
function fromKey(key: string): string {
  try { return decodeURIComponent(key); } catch { return key; }
}

// Découpe une chaîne en tranches de taille fixe
function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

// Pool de concurrence simple
async function pool<T>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<void>) {
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
}

// Retire avec retries (le RTDB peut throttler)
async function setWithRetry(ref: any, value: any, retries = 3, delayMs = 600) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { await set(ref, value); return; }
    catch (e: any) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
}

export type PushProgress = {
  phase: "data" | "images" | "done";
  done: number;
  total: number;
  current?: string;
  errors: string[];
};

export const FireSync = {
  async login() {
    ensureInit();
    const auth = getAuth(app!);
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); }
    catch (e: any) {
      if (e?.code === "auth/popup-blocked" || e?.code === "auth/popup-closed-by-user") {
        await signInWithRedirect(auth, provider);
      } else throw e;
    }
  },

  async logout() { ensureInit(); await signOut(getAuth(app!)); },

  onAuthChange(cb: (u: User | null) => void) {
    ensureInit();
    getRedirectResult(getAuth(app!)).catch(() => {});
    return onAuthStateChanged(getAuth(app!), cb);
  },

  // ─── PUSH ────────────────────────────────────────────────────────
  async push(
    uid: string,
    data: AppData,
    onProgress?: (p: PushProgress) => void
  ): Promise<PushProgress> {
    ensureInit();
    const db = getDatabase(app!);
    const errors: string[] = [];
    const images = data.images || {};
    const imageNames = Object.keys(images);
    let done = 0;

    const progress = (phase: PushProgress["phase"], current?: string): PushProgress => {
      const p: PushProgress = { phase, done, total: imageNames.length, current, errors };
      onProgress?.(p);
      return p;
    };

    // 1. Cartes sans images
    progress("data");
    const cardData: AppData = { ...JSON.parse(JSON.stringify(data)), images: {} };
    try {
      await setWithRetry(dbRef(db, `users/${uid}/flashcardData`), JSON.stringify(cardData));
    } catch (e: any) {
      throw new Error("Cartes non envoyées : " + (e?.message || e));
    }

    // 2. Images chunk par chunk
    if (imageNames.length > 0) {
      progress("images", "démarrage…");

      // Lit le manifest existant pour ne pas ré-uploader ce qui est déjà là
      const existingManifestSnap = await get(dbRef(db, `users/${uid}/imageManifest`)).catch(() => null);
      const existingManifest: Record<string, any> = existingManifestSnap?.val() || {};

      const manifest: Record<string, { name: string; chunkCount: number; size: number }> = {};

      await pool(imageNames, 3, async (name) => {
        const key = toKey(name);
        const value = images[name];
        progress("images", name);

        // Skip si déjà uploadé (même nom, même taille)
        const existing = existingManifest[key];
        if (existing && existing.size === value.length && existing.chunkCount > 0) {
          manifest[key] = existing;
          done++;
          progress("images", name);
          return;
        }

        const chunks = chunkString(value, CHUNK_SIZE);
        try {
          // Upload chaque chunk
          for (let ci = 0; ci < chunks.length; ci++) {
            await setWithRetry(
              dbRef(db, `users/${uid}/imageChunks/${key}/c${ci}`),
              chunks[ci]
            );
          }
          manifest[key] = { name, chunkCount: chunks.length, size: value.length };
        } catch (e: any) {
          errors.push(`"${name}" : ${(e as Error).message}`);
        } finally {
          done++;
          progress("images", name);
        }
      });

      // Manifest en une seule écriture (léger)
      try {
        await setWithRetry(dbRef(db, `users/${uid}/imageManifest`), manifest);
      } catch (e: any) {
        errors.push("Manifest : " + (e as Error).message);
      }
    }

    // 3. Meta — timestamp de synchro
    const now = Date.now();
    await setWithRetry(dbRef(db, `users/${uid}/syncMeta`), {
      lastModified: now,
      imageCount: imageNames.length,
      cardCount: data.folders?.reduce((s, f) => s + f.cards.length, 0) ?? 0,
    }).catch(() => {/* non bloquant */});

    done = imageNames.length;
    return progress("done");
  },

  // ─── PULL ────────────────────────────────────────────────────────
  async pull(uid: string, onProgress?: (msg: string) => void): Promise<AppData | null> {
    ensureInit();
    const db = getDatabase(app!);

    // 1. Cartes
    onProgress?.("Téléchargement des cartes…");
    const snap = await get(dbRef(db, `users/${uid}/flashcardData`));
    const v = snap.val();
    if (!v) return null;

    let data: any;
    try { data = typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
    if (!data) return null;

    // Ensure folders exists
    if (!data.folders) data.folders = [];

    // MIGRATION — ancien format subjects/chapters (vieux site)
    if (data.folders.length === 0 && data.subjects && Array.isArray(data.subjects)) {
      onProgress?.("Migration depuis l'ancien format…");
      const migrated: any[] = [];
      for (const subject of data.subjects) {
        if (!subject) continue;
        const subjectFolder: any = {
          id: `old-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
          name: subject.title || subject.name || "Ancien dossier",
          emoji: subject.emoji || undefined,
          parentId: null,
          createdAt: Date.now(),
          cards: [],
        };
        // Support both subjects[].chapters[].cards[] and subjects[].cards[]
        const allCards: any[] = [];
        if (subject.chapters && Array.isArray(subject.chapters)) {
          for (const chapter of subject.chapters) {
            for (const card of (chapter.cards || [])) allCards.push(card);
          }
        }
        if (subject.cards && Array.isArray(subject.cards)) {
          for (const card of subject.cards) allCards.push(card);
        }

        for (const card of allCards) {
          if (!card) continue;
          const front = card.front || card.question || "";
          const back = card.back || card.answer || card.response || "";
          if (!front && !back) continue;
          subjectFolder.cards.push({
            id: card.id || `old-${Math.random().toString(36).slice(2, 12)}`,
            front, back,
            type: card.type || undefined,
            tags: card.tags || [],
            imageId: card.imageId || null,
            createdAt: card.createdAt || Date.now(),
            updatedAt: card.updatedAt || card.lastReviewed || Date.now(),
            srs: card.srs ? {
              ease: card.srs.ease || 2.5,
              interval: card.srs.interval || 0,
              reps: card.srs.reps || 0,
              lapses: card.srs.lapses || 0,
              due: card.srs.due || Date.now(),
              lastReview: card.srs.lastReview || null,
              state: card.srs.state || "new",
              step: card.srs.step || 0,
            } : {
              ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(),
              lastReview: card.lastReviewed || null, state: "new", step: 0,
            },
          });
        }
        if (subjectFolder.cards.length > 0) migrated.push(subjectFolder);
      }
      data.folders = migrated;
    }

    // Ensure settings exist
    if (!data.settings) {
      data.settings = {
        theme: "light", fontScaleFront: 1, fontScaleBack: 1,
        newPerDay: 20, reviewsPerDay: 200,
      };
    }
    if (!data.history) data.history = [];

    data.images = {};

    // 2. Manifest
    const manifestSnap = await get(dbRef(db, `users/${uid}/imageManifest`));
    const manifest: Record<string, { name: string; chunkCount: number; size: number }> = manifestSnap.val() || {};
    const keys = Object.keys(manifest);
    onProgress?.(`Téléchargement des images (${keys.length})…`);

    // 3. Chunks — en parallèle, 4 images à la fois
    await pool(keys, 4, async (key) => {
      const entry = manifest[key];
      if (!entry?.name || !entry?.chunkCount) return;
      try {
        const chunksSnap = await get(dbRef(db, `users/${uid}/imageChunks/${key}`));
        const chunksData = chunksSnap.val();
        if (!chunksData) return;
        let full = "";
        for (let ci = 0; ci < entry.chunkCount; ci++) {
          full += chunksData[`c${ci}`] ?? "";
        }
        if (full) data.images[entry.name] = full;
      } catch { /* ignore une image ratée */ }
    });

    // Compat legacy (ancien format data URL direct dans RTDB)
    const legacySnap = await get(dbRef(db, `users/${uid}/images`));
    const legacy = legacySnap.val();
    if (legacy && typeof legacy === "object") {
      for (const [k, val] of Object.entries(legacy)) {
        if (typeof val === "string" && !data.images[fromKey(k)]) {
          data.images[fromKey(k)] = val;
        }
      }
    }

    onProgress?.(`Terminé — ${keys.length} image(s) récupérée(s)`);
    return data;
  },

  async pullMeta(uid: string) {
    ensureInit();
    const db = getDatabase(app!);
    const snap = await get(dbRef(db, `users/${uid}/syncMeta`));
    return snap.val() as { lastModified: number; imageCount?: number; cardCount?: number } | null;
  },

  async clearCloud(uid: string) {
    ensureInit();
    const db = getDatabase(app!);
    await remove(dbRef(db, `users/${uid}`));
  },
};
