import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { Cloud, X, Download, Upload } from "./icons";
import { FireSync } from "../lib/firebase";
import type { User } from "firebase/auth";

interface Progress {
  step: string;
  done: number;
  total: number;
}

export function SyncPanel({ onClose }: { onClose: () => void }) {
  const { data, setData } = useStore();
  const [user, setUser] = useState<User | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const didInit = useRef(false);

  // Écoute l'état auth au montage
  useEffect(() => {
    unsubRef.current = FireSync.onAuthChange(async (u) => {
      setUser(u);
      if (!u) return;
      // Au login, récupère la méta pour afficher la date du dernier sync
      try {
        const meta = await FireSync.pullMeta(u.uid);
        if (meta?.lastModified) setLastSync(meta.lastModified);
      } catch {}
    });
    return () => { unsubRef.current?.(); };
  }, []);

  const report = (step: string, done: number, total: number) =>
    setProgress({ step, done, total });

  const busy = progress !== null;

  // ── Login ────────────────────────────────────────────────────────────────
  const doLogin = async () => {
    setError("");
    try { await FireSync.login(); }
    catch (e: any) {
      if (e?.code === "auth/unauthorized-domain") {
        setError(
          `Domaine non autorisé dans Firebase.\n` +
          `→ console.firebase.google.com → Authentication → Paramètres → Domaines autorisés\n` +
          `→ Ajoute : ${window.location.hostname}\n\n` +
          `En attendant, utilise l'Export/Import JSON.`
        );
      } else { setError("Connexion : " + (e?.message || e)); }
    }
  };

  // ── Push ────────────────────────────────────────────────────────────────
  const doPush = async () => {
    if (!user) return;
    setError(""); setProgress({ step: "Démarrage…", done: 0, total: 1 });
    try {
      await FireSync.push(user.uid, data, report);
      const meta = await FireSync.pullMeta(user.uid);
      if (meta?.lastModified) setLastSync(meta.lastModified);
      setProgress(null);
    } catch (e: any) {
      setError("Erreur : " + (e?.message || e));
      setProgress(null);
    }
  };

  // ── Pull ────────────────────────────────────────────────────────────────
  const doPull = async () => {
    if (!user) return;
    setError(""); setProgress({ step: "Démarrage…", done: 0, total: 1 });
    try {
      const cloud = await FireSync.pull(user.uid, report);
      setProgress(null);
      if (!cloud) { setError("Aucune donnée sur le cloud."); return; }
      const nCards = cloud.folders?.reduce((s, f) => s + (f.cards?.length || 0), 0) ?? 0;
      const nImg = Object.keys(cloud.images || {}).length;
      if (confirm(
        `Cloud : ${nCards} cartes · ${nImg} images.\n` +
        `Remplacer les données locales ?`
      )) {
        setData(() => cloud);
        const meta = await FireSync.pullMeta(user.uid);
        if (meta?.lastModified) setLastSync(meta.lastModified);
      }
    } catch (e: any) {
      setError("Erreur : " + (e?.message || e));
      setProgress(null);
    }
  };

  // ── Init automatique au premier push si cloud vide ──────────────────────
  const doSmartSync = async () => {
    if (!user || didInit.current) return;
    didInit.current = true;
    setError(""); setProgress({ step: "Vérification cloud…", done: 0, total: 1 });
    try {
      const meta = await FireSync.pullMeta(user.uid);
      if (!meta) {
        // Première connexion, cloud vide → on push
        setProgress({ step: "Premier push…", done: 0, total: 1 });
        await FireSync.push(user.uid, data, report);
        setProgress(null);
        return;
      }
      const localCards = data.folders?.reduce((s, f) => s + (f.cards?.length || 0), 0) ?? 0;
      const localImages = Object.keys(data.images || {}).length;
      setProgress(null);
      const choice = confirm(
        `Cloud détecté (${new Date(meta.lastModified).toLocaleString()}, ${meta.imageCount ?? "?"} images).\n\n` +
        `Local : ${localCards} cartes · ${localImages} images.\n\n` +
        `OK = Récupérer le cloud   |   Annuler = Garder le local`
      );
      if (choice) await doPull();
      else await doPush();
    } catch (e: any) {
      setError("Erreur sync : " + (e?.message || e));
      setProgress(null);
    }
  };

  // ── Export JSON ─────────────────────────────────────────────────────────
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `flashcards-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Import JSON ─────────────────────────────────────────────────────────
  const importJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed.folders || !parsed.settings) { setError("Fichier JSON invalide."); return; }
        const nCards = parsed.folders.reduce((s: number, f: any) => s + (f.cards?.length || 0), 0);
        const nImg = Object.keys(parsed.images || {}).length;
        if (confirm(`Importer : ${nCards} cartes · ${nImg} images ?\nCela remplacera tes données locales.`)) {
          setData(() => parsed);
          onClose();
        }
      } catch { setError("Fichier JSON illisible."); }
    };
    reader.readAsText(file);
  };

  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100) : 0;

  const totalCards = data.folders?.reduce((s, f) => s + (f.cards?.length || 0), 0) ?? 0;
  const totalImages = Object.keys(data.images || {}).length;

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 fade-in"
      onPointerDown={() => {}} onClick={onClose}>
      <div className="bg-card border border-app rounded-xl w-full max-w-lg flex flex-col card-shadow overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app">
          <div className="text-sm font-medium flex items-center gap-2"><Cloud /> Synchronisation</div>
          <button className="btn btn-ghost p-1" onClick={onClose} disabled={busy}><X /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-5">

          {/* ── État local ── */}
          <div className="rounded-lg border border-app bg-soft px-3 py-2 text-xs text-muted flex gap-4 flex-wrap">
            <span>💾 Local : <strong className="text-[var(--text)]">{totalCards} cartes · {totalImages} images</strong></span>
            {lastSync && <span>☁️ Dernier sync : <strong className="text-[var(--text)]">{new Date(lastSync).toLocaleString()}</strong></span>}
          </div>

          {/* ── Progress ── */}
          {progress && (
            <div className="space-y-1.5">
              <div className="text-sm text-soft">{progress.step}</div>
              <div className="w-full h-2 rounded-full bg-soft overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${pct}%`, background: "var(--info)" }}
                />
              </div>
              <div className="text-xs text-muted text-right">
                {progress.done} / {progress.total}
              </div>
            </div>
          )}

          {/* ── Cloud Google ── */}
          <section>
            <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">
              Cloud Google — Firebase Storage (illimité)
            </div>
            {!user ? (
              <button className="btn btn-primary w-full py-3" onClick={doLogin} disabled={busy}>
                <Cloud /> Se connecter avec Google
              </button>
            ) : (
              <div className="space-y-2">
                <div className="text-sm text-soft flex items-center justify-between">
                  <span>✓ <strong>{user.email}</strong></span>
                  <button className="btn btn-ghost text-xs" onClick={() => { FireSync.logout(); setUser(null); didInit.current = false; }}>
                    Déconnecter
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button className="btn btn-primary col-span-1" onClick={doPush} disabled={busy} title="Envoyer cartes + images vers le cloud">
                    <Upload /> Envoyer
                  </button>
                  <button className="btn col-span-1" onClick={doPull} disabled={busy} title="Récupérer cartes + images depuis le cloud">
                    ↓ Récupérer
                  </button>
                  <button className="btn col-span-1" onClick={doSmartSync} disabled={busy} title="Laisser l'appli choisir la bonne direction">
                    ⚡ Auto
                  </button>
                </div>
                <div className="text-[11px] text-muted leading-relaxed">
                  <strong>Envoyer</strong> : pousse tout vers le cloud (cartes + toutes les images).<br />
                  <strong>Récupérer</strong> : écrase le local par le cloud.<br />
                  <strong>Auto</strong> : compare cloud et local, te demande quoi faire.
                </div>
              </div>
            )}
          </section>

          {/* ── JSON ── */}
          <section>
            <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">
              Export / Import JSON (sans Firebase)
            </div>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={exportJSON} disabled={busy}>
                <Download /> Exporter (.json)
              </button>
              <button className="btn flex-1" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload /> Importer (.json)
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) importJSON(f); e.currentTarget.value = ""; }} />
            <div className="text-[11px] text-muted mt-1.5">
              Le fichier JSON inclut cartes + images. Parfait pour sauvegarder ou migrer entre appareils.
            </div>
          </section>

          {/* ── Erreur ── */}
          {error && (
            <div className="rounded-lg border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,transparent)] p-3 text-sm whitespace-pre-line">
              ⚠️ {error}
              <button className="block mt-2 text-xs underline" onClick={() => setError("")}>Fermer</button>
            </div>
          )}

          {/* ── Note Firebase Storage ── */}
          {user && (
            <div className="text-[11px] text-muted leading-relaxed rounded border border-app p-2 bg-soft">
              Les images sont stockées dans <strong>Firebase Storage</strong> (pas de limite de taille, optimisation automatique avant upload). Les cartes sont dans Firebase Realtime DB.
              Si tu vois une erreur "storage/unauthorized", active Firebase Storage dans la console Firebase et ajoute des règles de sécurité.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
