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
    await set(ref(db, "users/" + uid + "/flashcardData"), JSON.stringify(data));
    await set(ref(db, "users/" + uid + "/syncMeta"), {
      lastModified: Date.now(),
    });
  },
  async pull(uid: string): Promise<AppData | null> {
    ensureInit();
    const db = getDatabase(app!);
    const snap = await get(ref(db, "users/" + uid + "/flashcardData"));
    const v = snap.val();
    if (!v) return null;
    try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
  },
  async pullMeta(uid: string): Promise<{ lastModified: number } | null> {
    ensureInit();
    const db = getDatabase(app!);
    const snap = await get(ref(db, "users/" + uid + "/syncMeta"));
    return snap.val() || null;
  }
};
