import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { Cloud, X, Download, Upload } from "./icons";
import { FireSync, type PushProgress } from "../lib/firebase";
import type { User } from "firebase/auth";

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function SyncPanel({ onClose }: { onClose: () => void }) {
  const { data, setData } = useStore();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PushProgress | null>(null);
  const [pullMsg, setPullMsg] = useState("");
  const [cloudMeta, setCloudMeta] = useState<{ lastModified: number; imageCount?: number; cardCount?: number } | null>(null);
  const [statusLine, setStatusLine] = useState("");
  const [errorLines, setErrorLines] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const autoPulled = useRef(false);

  // ── Auth + auto-check cloud ──
  useEffect(() => {
    const unsub = FireSync.onAuthChange(async (u) => {
      setUser(u);
      if (u && !autoPulled.current) {
        autoPulled.current = true;
        try {
          const meta = await FireSync.pullMeta(u.uid);
          setCloudMeta(meta);
          if (meta) {
            const localMax = Math.max(
              0,
              ...data.folders.flatMap(f => f.cards.map(c => c.updatedAt || 0))
            );
            if (meta.lastModified > localMax + 5000) {
              setStatusLine(`☁️ Cloud plus récent (${fmtDate(meta.lastModified)}) — tu peux récupérer.`);
            } else {
              setStatusLine(`✅ Local à jour. Dernière synchro cloud : ${fmtDate(meta.lastModified)}`);
            }
          } else {
            setStatusLine("Aucune donnée cloud pour ce compte.");
          }
        } catch {
          setStatusLine("Impossible de vérifier le cloud.");
        }
      }
    });
    return () => unsub();
  }, []); // intentionnellement vide — on ne re-check qu'au login

  const doLogin = async () => {
    setErrorLines([]);
    try { await FireSync.login(); }
    catch (e: any) {
      if (e?.code === "auth/unauthorized-domain") {
        setErrorLines([
          `Domaine non autorisé : ${window.location.hostname}`,
          "→ console.firebase.google.com → Authentication → Paramètres → Domaines autorisés",
          "→ Ajoute ce domaine puis réessaie.",
          "",
          "En attendant, utilise Export/Import JSON."
        ]);
      } else {
        setErrorLines(["Erreur login : " + (e?.message || e)]);
      }
    }
  };

  const doLogout = async () => {
    await FireSync.logout();
    setUser(null);
    setCloudMeta(null);
    setStatusLine("");
    autoPulled.current = false;
  };

  // ── PUSH ──
  const doPush = async () => {
    if (!user || busy) return;
    setBusy(true);
    setErrorLines([]);
    setProgress(null);
    setStatusLine("Envoi des cartes…");

    try {
      const result = await FireSync.push(user.uid, data, (p) => {
        setProgress({ ...p });
        if (p.phase === "data") setStatusLine("Envoi des cartes et paramètres…");
        else if (p.phase === "images") {
          const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
          setStatusLine(`Images : ${p.done}/${p.total} (${pct}%)${p.current ? ` — ${p.current}` : ""}`);
        }
        else if (p.phase === "done") setStatusLine("Finalisation…");
      });

      // Relit le meta pour afficher la date réelle
      const meta = await FireSync.pullMeta(user.uid);
      setCloudMeta(meta);

      const imgCount = Object.keys(data.images || {}).length;
      const cardCount = data.folders.reduce((s, f) => s + f.cards.length, 0);
      setStatusLine(
        `✅ Envoyé le ${meta ? fmtDate(meta.lastModified) : "maintenant"} — ${cardCount} cartes, ${imgCount} images`
      );
      if (result.errors.length > 0) setErrorLines(result.errors);
    } catch (e: any) {
      setErrorLines(["Erreur push : " + (e?.message || e)]);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // ── PULL ──
  const doPull = async () => {
    if (!user || busy) return;
    setBusy(true);
    setErrorLines([]);
    setPullMsg("Démarrage…");

    try {
      const cloud = await FireSync.pull(user.uid, (msg) => {
        setPullMsg(msg);
        setStatusLine(msg);
      });
      if (!cloud) {
        setStatusLine("Aucune donnée sur le cloud.");
      } else {
        const imgCount = Object.keys(cloud.images || {}).length;
        const cardCount = cloud.folders.reduce((s, f) => s + f.cards.length, 0);
        if (confirm(`Remplacer les données locales ? (${cardCount} cartes, ${imgCount} images sur le cloud)`)) {
          setData(() => cloud);
          const meta = await FireSync.pullMeta(user.uid);
          setCloudMeta(meta);
          setStatusLine(`✅ Données cloud chargées — ${cardCount} cartes, ${imgCount} images`);
        } else {
          setStatusLine("Annulé — données locales conservées.");
        }
      }
    } catch (e: any) {
      setErrorLines(["Erreur pull : " + (e?.message || e)]);
    } finally {
      setBusy(false);
      setPullMsg("");
    }
  };

  // ── Export JSON ──
  const exportJSON = () => {
    const json = JSON.stringify(data, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = `flashcards-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const importJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed.folders && parsed.settings) {
          if (confirm("Remplacer toutes les données locales ?")) {
            setData(() => parsed);
            setStatusLine("✅ Données importées depuis le fichier.");
          }
        } else alert("Fichier invalide.");
      } catch { alert("JSON invalide."); }
    };
    reader.readAsText(file);
  };

  const totalCards = data.folders.reduce((s, f) => s + f.cards.length, 0);
  const totalImgs = Object.keys(data.images || {}).length;
  const progressPct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 fade-in"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-app rounded-xl w-full max-w-lg overflow-hidden flex flex-col card-shadow"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 py-3 border-b border-app">
          <div className="text-sm font-medium flex items-center gap-2"><Cloud /> Synchronisation</div>
          <button className="btn btn-ghost p-1" onClick={onClose}><X /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* État local */}
          <div className="text-xs text-muted border border-app rounded-lg px-3 py-2 flex gap-4">
            <span>📦 Local : <strong>{totalCards}</strong> cartes</span>
            <span>🖼 <strong>{totalImgs}</strong> images</span>
          </div>

          {/* Cloud Google */}
          <section>
            <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">Cloud Google</div>
            {!user ? (
              <button className="btn btn-primary w-full py-3" onClick={doLogin} disabled={busy}>
                <Cloud /> Se connecter avec Google
              </button>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="text-muted">Connecté : </span>
                  <strong>{user.email}</strong>
                </div>

                {/* Info cloud */}
                {cloudMeta && (
                  <div className="text-xs text-muted border border-app rounded-lg px-3 py-2 flex gap-4">
                    <span>☁️ Cloud : <strong>{cloudMeta.cardCount ?? "?"}</strong> cartes</span>
                    <span>🖼 <strong>{cloudMeta.imageCount ?? "?"}</strong> images</span>
                    <span>🕐 {fmtDate(cloudMeta.lastModified)}</span>
                  </div>
                )}

                {/* Barre de progression */}
                {progress && progress.total > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted">
                      <span>{progress.phase === "images" ? `Images ${progress.done}/${progress.total}` : progress.phase}</span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-soft overflow-hidden">
                      <div
                        className="h-full bg-[var(--info)] transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    {progress.current && (
                      <div className="text-[11px] text-muted truncate">{progress.current}</div>
                    )}
                  </div>
                )}

                {/* Message de pull en cours */}
                {pullMsg && <div className="text-xs text-muted">{pullMsg}</div>}

                {/* Boutons */}
                <div className="flex gap-2">
                  <button
                    className="btn btn-primary flex-1 py-2.5"
                    onClick={doPush}
                    disabled={busy}
                  >
                    <Upload /> {busy && progress?.phase !== "done" ? "Envoi…" : "Envoyer →"}
                  </button>
                  <button
                    className="btn flex-1 py-2.5"
                    onClick={doPull}
                    disabled={busy}
                  >
                    ← Récupérer
                  </button>
                  <button className="btn px-3" onClick={doLogout} disabled={busy} title="Se déconnecter">
                    ✕
                  </button>
                </div>
                <div className="text-[11px] text-muted">
                  Les images sont découpées en blocs et envoyées progressivement. Laisse la page ouverte jusqu'à la fin.
                </div>
              </div>
            )}
          </section>

          {/* Status */}
          {statusLine && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${
              statusLine.startsWith("✅")
                ? "border-[var(--good)] bg-[color-mix(in_srgb,var(--good)_8%,transparent)]"
                : "border-app bg-soft"
            }`}>
              {statusLine}
            </div>
          )}

          {/* Erreurs */}
          {errorLines.length > 0 && (
            <div className="rounded-lg border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,transparent)] p-3 text-sm space-y-1">
              {errorLines.map((l, i) => <div key={i} className={l === "" ? "h-2" : ""}>{l}</div>)}
              <button className="text-xs underline mt-1" onClick={() => setErrorLines([])}>Fermer</button>
            </div>
          )}

          {/* Export / Import */}
          <section>
            <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">Export / Import local</div>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={exportJSON}>
                <Download /> Exporter JSON
              </button>
              <button className="btn flex-1" onClick={() => fileRef.current?.click()}>
                <Upload /> Importer JSON
              </button>
              <input ref={fileRef} type="file" accept=".json" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) importJSON(f); e.currentTarget.value = ""; }} />
            </div>
            <div className="text-[11px] text-muted mt-1.5">
              Sauvegarde complète en un fichier (cartes + images). Fonctionne sans connexion.
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
