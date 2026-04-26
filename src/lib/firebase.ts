// Firebase sync — cartes dans Realtime DB, images dans Storage (illimité)
import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged, type User
} from "firebase/auth";
import { getDatabase, ref as dbRef, set, get } from "firebase/database";
import {
  getStorage, ref as storageRef,
  uploadString, getDownloadURL, deleteObject, listAll,
} from "firebase/storage";
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

let _app: ReturnType<typeof initializeApp> | null = null;
function app() {
  if (!_app) _app = initializeApp(firebaseConfig);
  return _app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function utf8Bytes(s: string) {
  return new TextEncoder().encode(s).length;
}

// Firebase Storage keys ne peuvent pas contenir certains chars. On encode le nom.
function encodeImageKey(name: string) {
  return encodeURIComponent(name);
}

function decodeImageKey(key: string) {
  try { return decodeURIComponent(key); } catch { return key; }
}

async function optimizeImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  // Si < 500 Ko, pas besoin de recompresser
  if (utf8Bytes(dataUrl) < 500_000) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
    });
    const maxSide = 1920;
    const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    // Qualité agressive si très lourd
    const quality = utf8Bytes(dataUrl) > 3_000_000 ? 0.72 : 0.88;
    const out = c.toDataURL("image/jpeg", quality);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch { return dataUrl; }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const FireSync = {
  async login() {
    const auth = getAuth(app());
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      if (e?.code === "auth/popup-blocked" || e?.code === "auth/popup-closed-by-user") {
        await signInWithRedirect(auth, provider);
      } else { throw e; }
    }
  },

  async logout() { await signOut(getAuth(app())); },

  onAuthChange(cb: (u: User | null) => void) {
    getRedirectResult(getAuth(app())).catch(() => {});
    return onAuthStateChanged(getAuth(app()), cb);
  },

  // ─── Push (cartes + images) ─────────────────────────────────────────────
  async push(
    uid: string,
    data: AppData,
    onProgress?: (step: string, done: number, total: number) => void
  ) {
    const db = getDatabase(app());
    const storage = getStorage(app());

    // 1. Cartes sans images → Realtime DB (léger)
    const dataWithoutImages: AppData = { ...data, images: {} };
    onProgress?.("Envoi des cartes…", 0, 1);
    await set(dbRef(db, `users/${uid}/flashcardData`), dataWithoutImages);
    onProgress?.("Cartes envoyées", 1, 1);

    // 2. Images → Firebase Storage (conçu pour ça, pas de limite de taille par fichier)
    const images = data.images || {};
    const imageIds = Object.keys(images);
    const total = imageIds.length;

    if (total === 0) {
      await set(dbRef(db, `users/${uid}/syncMeta`), {
        lastModified: Date.now(), imageCount: 0, schema: 3
      });
      return;
    }

    // Récupère la liste des images déjà présentes dans Storage pour ne pas ré-uploader
    const baseRef = storageRef(storage, `users/${uid}/images/`);
    let existingKeys = new Set<string>();
    try {
      const list = await listAll(baseRef);
      existingKeys = new Set(list.items.map(i => decodeImageKey(i.name)));
    } catch { /* pas encore de dossier images */ }

    let done = 0;
    // Upload en parallèle par batch de 5 pour être rapide sans surcharger
    const BATCH = 5;
    for (let i = 0; i < imageIds.length; i += BATCH) {
      const batch = imageIds.slice(i, i + BATCH);
      await Promise.all(batch.map(async (id) => {
        if (existingKeys.has(id)) {
          // Déjà uploadé → skip (diff intelligent)
          done++;
          onProgress?.(`Images ${done}/${total}`, done, total);
          return;
        }
        const url = images[id];
        const optimized = await optimizeImage(url);
        const imgRef = storageRef(storage, `users/${uid}/images/${encodeImageKey(id)}`);
        await uploadString(imgRef, optimized, "data_url");
        done++;
        onProgress?.(`Images ${done}/${total}`, done, total);
      }));
    }

    // Méta finale
    await set(dbRef(db, `users/${uid}/syncMeta`), {
      lastModified: Date.now(),
      imageCount: total,
      schema: 3,
    });
  },

  // ─── Pull (cartes + images) ─────────────────────────────────────────────
  async pull(
    uid: string,
    onProgress?: (step: string, done: number, total: number) => void
  ): Promise<AppData | null> {
    const db = getDatabase(app());
    const storage = getStorage(app());

    // 1. Cartes
    onProgress?.("Récupération des cartes…", 0, 1);
    const snap = await get(dbRef(db, `users/${uid}/flashcardData`));
    const v = snap.val();
    if (!v) return null;
    let result: AppData;
    try {
      result = (typeof v === "string" ? JSON.parse(v) : v) as AppData;
    } catch { return null; }
    result.images = {};
    onProgress?.("Cartes récupérées", 1, 1);

    // 2. Images depuis Storage
    const baseRef = storageRef(storage, `users/${uid}/images/`);
    let items: { name: string; ref: any }[] = [];
    try {
      const list = await listAll(baseRef);
      items = list.items.map(i => ({ name: decodeImageKey(i.name), ref: i }));
    } catch { /* pas d'images */ }

    const total = items.length;
    let done = 0;
    const BATCH = 8;
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      await Promise.all(batch.map(async ({ name, ref: itemRef }) => {
        try {
          const dlUrl = await getDownloadURL(itemRef);
          // Convertit l'URL publique en dataURL pour stockage local
          const dataUrl = await fetchAsDataUrl(dlUrl);
          result.images[name] = dataUrl;
        } catch { /* image corrompue, on skip */ }
        done++;
        onProgress?.(`Images ${done}/${total}`, done, total);
      }));
    }

    return result;
  },

  // ─── Supprime une image du Storage ─────────────────────────────────────
  async deleteImage(uid: string, name: string) {
    try {
      const storage = getStorage(app());
      await deleteObject(storageRef(storage, `users/${uid}/images/${encodeImageKey(name)}`));
    } catch { /* déjà supprimée ou inexistante */ }
  },

  // ─── Méta uniquement (pour vérifier si cloud plus récent) ──────────────
  async pullMeta(uid: string): Promise<{ lastModified: number; imageCount?: number } | null> {
    const db = getDatabase(app());
    const snap = await get(dbRef(db, `users/${uid}/syncMeta`));
    return snap.val() || null;
  },
};

// ─── Fetch une URL publique et la convertit en dataURL ───────────────────────
async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
