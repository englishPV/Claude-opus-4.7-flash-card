// Firebase sync optionnelle - identique à la config fournie par l'utilisateur
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, type User } from "firebase/auth";
import { getDatabase, ref, set, get } from "firebase/database";
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

let app: ReturnType<typeof initializeApp> | null = null;
let isInit = false;

function ensureInit() {
  if (!isInit) {
    app = initializeApp(firebaseConfig);
    isInit = true;
  }
}

export type SyncStatus = {
  user: User | null;
  syncing: boolean;
  lastError?: string;
};

export const FireSync = {
  async login() {
    ensureInit();
    const auth = getAuth(app!);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      if (e?.code === "auth/popup-blocked" || e?.code === "auth/popup-closed-by-user") {
        await signInWithRedirect(auth, provider);
      } else {
        throw e;
      }
    }
  },
  async logout() {
    ensureInit();
    await signOut(getAuth(app!));
  },
  onAuthChange(cb: (u: User | null) => void) {
    ensureInit();
    // Vérifier le redirect
    getRedirectResult(getAuth(app!)).catch(() => {});
    return onAuthStateChanged(getAuth(app!), cb);
  },
  async push(uid: string, data: AppData) {
    ensureInit();
    const db = getDatabase(app!);
    // Ne pas mettre tout le deck dans une seule string JSON : Realtime Database
    // refuse les strings > 10 Mo. On stocke donc les images séparément.
    const images = data.images || {};
    const dataWithoutImages: AppData = { ...data, images: {} };
    await set(ref(db, "users/" + uid + "/flashcardData"), dataWithoutImages);

    const imagesRef = ref(db, "users/" + uid + "/flashcardImages");
    await set(imagesRef, null);
    for (const [id, url] of Object.entries(images)) {
      const optimized = await optimizeDataUrlIfNeeded(url);
      if (utf8Bytes(optimized) > 9_500_000) {
        throw new Error(`Image trop lourde pour Firebase (> 10 Mo) : ${id}. Réimporte-la en plus petit ou compresse-la.`);
      }
      await set(ref(db, "users/" + uid + "/flashcardImages/" + encodeKey(id)), optimized);
    }

    await set(ref(db, "users/" + uid + "/syncMeta"), {
      lastModified: Date.now(),
      schema: 2,
      imageCount: Object.keys(images).length,
    });
  },
  async pull(uid: string): Promise<AppData | null> {
    ensureInit();
    const db = getDatabase(app!);
    const snap = await get(ref(db, "users/" + uid + "/flashcardData"));
    const v = snap.val();
    if (!v) return null;
    try {
      const data = (typeof v === "string" ? JSON.parse(v) : v) as AppData;
      const imgSnap = await get(ref(db, "users/" + uid + "/flashcardImages"));
      const rawImages = imgSnap.val() || {};
      data.images = {};
      for (const [key, url] of Object.entries(rawImages)) {
        data.images[decodeKey(key)] = String(url);
      }
      return data;
    } catch { return null; }
  },
  async pullMeta(uid: string): Promise<{ lastModified: number } | null> {
    ensureInit();
    const db = getDatabase(app!);
    const snap = await get(ref(db, "users/" + uid + "/syncMeta"));
    return snap.val() || null;
  }
};

function encodeKey(id: string) {
  return encodeURIComponent(id).replace(/\./g, "%2E");
}

function decodeKey(key: string) {
  return decodeURIComponent(key);
}

function utf8Bytes(s: string) {
  return new TextEncoder().encode(s).length;
}

async function optimizeDataUrlIfNeeded(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  if (utf8Bytes(dataUrl) < 2_500_000) return dataUrl;
  try {
    const img = await loadImage(dataUrl);
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, width, height);
    const out = canvas.toDataURL("image/jpeg", 0.82);
    return utf8Bytes(out) < utf8Bytes(dataUrl) ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
