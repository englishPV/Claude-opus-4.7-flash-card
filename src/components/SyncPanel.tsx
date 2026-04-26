import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { Cloud, X, Download, Upload } from "./icons";
import { FireSync } from "../lib/firebase";
import type { User } from "firebase/auth";

export function SyncPanel({ onClose }: { onClose: () => void }) {
  const { data, setData } = useStore();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const didAutoPullRef = useRef(false);

  // Auth
  const doLogin = async () => {
    setError("");
    try {
      await FireSync.login();
    } catch (e: any) {
      if (e?.code === "auth/unauthorized-domain") {
        setError(
          `Ce domaine n'est pas autorisé dans Firebase.\n\n` +
          `→ Va sur console.firebase.google.com\n` +
          `→ Ton projet → Authentication → Paramètres → Domaines autorisés\n` +
          `→ Ajoute : ${window.location.hostname}\n\n` +
          `En attendant, utilise Export/Import JSON ci-dessous.`
        );
      } else {
        setError("Erreur : " + e?.message || e);
      }
    }
  };

  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    unsubRef.current = FireSync.onAuthChange(async (u) => {
      setUser(u);
      if (!u || didAutoPullRef.current) return;
      didAutoPullRef.current = true;
      setBusy(true);
      try {
        const cloud = await FireSync.pull(u.uid);
        if (cloud) {
          const localHasData = data.folders.length > 0 || Object.keys(data.images || {}).length > 0;
          if (!localHasData || confirm("Données cloud trouvées. Les charger maintenant ?")) {
            setData(() => cloud);
          }
        } else if (data.folders.length > 0 || Object.keys(data.images || {}).length > 0) {
          await FireSync.push(u.uid, data);
        }
      } catch (e: any) {
        setError("Erreur auto-sync : " + (e?.message || e));
      } finally {
        setBusy(false);
      }
    });
    return () => unsubRef.current?.();
  }, [data, setData]);

  const doLogout = async () => {
    await FireSync.logout();
    setUser(null);
  };

  const doPush = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await FireSync.push(user.uid, data);
      alert("✅ Envoyé au cloud ! Les images sont stockées séparément pour éviter la limite Firebase de 10 Mo.");
    } catch (e: any) {
      setError("Erreur push : " + (e?.message || e));
    } finally { setBusy(false); }
  };

  const doPull = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const cloud = await FireSync.pull(user.uid);
      if (cloud) {
        if (confirm("Les données du cloud remplaceront tes données locales. Continuer ?")) {
          setData(() => cloud);
          alert("✅ Données récupérées !");
        }
      } else {
        alert("Aucune donnée sur le cloud pour ce compte.");
      }
    } catch (e: any) {
      setError("Erreur pull : " + (e?.message || e));
    } finally { setBusy(false); }
  };

  // JSON export / import
  const exportJSON = () => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flashcards-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed.folders && parsed.settings) {
          if (confirm("Remplacer toutes les données locales par ce fichier ?")) {
            setData(() => parsed);
            alert("✅ Données importées !");
            onClose();
          }
        } else {
          alert("Fichier invalide : pas de structure flashcards reconnue.");
        }
      } catch {
        alert("Fichier JSON invalide.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 fade-in" onClick={onClose}>
      <div className="bg-card border border-app rounded-xl w-full max-w-lg overflow-hidden flex flex-col card-shadow" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-app">
          <div className="text-sm font-medium flex items-center gap-2"><Cloud /> Synchronisation</div>
          <button className="btn btn-ghost p-1" onClick={onClose}><X /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Cloud Sync */}
          <section>
            <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">Cloud (Google)</div>
            {!user ? (
              <button className="btn btn-primary w-full py-3" onClick={doLogin}>
                <Cloud /> Se connecter avec Google
              </button>
            ) : (
              <div className="space-y-2">
                <div className="text-sm text-soft">Connecté : <strong>{user.email}</strong></div>
                <div className="flex gap-2">
                  <button className="btn flex-1" onClick={doPush} disabled={busy}>
                    <Upload /> Envoyer →
                  </button>
                  <button className="btn flex-1" onClick={doPull} disabled={busy}>
                    ← Récupérer
                  </button>
                  <button className="btn" onClick={doLogout}>Déco</button>
                </div>
                <div className="text-[11px] text-muted">Les cartes, images et paramètres sont sauvegardés.</div>
              </div>
            )}
          </section>

          {/* JSON */}
          <section>
            <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">Export / Import (fichier)</div>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={exportJSON}>
                <Download /> Exporter en JSON
              </button>
              <button
                className="btn flex-1"
                onClick={() => fileRef.current?.click()}
              >
                <Upload /> Importer un JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) importJSON(f);
                  e.currentTarget.value = "";
                }}
              />
            </div>
            <div className="text-[11px] text-muted mt-1">
              Exporte un fichier .json avec toutes tes données. Importe-le sur un autre appareil.
            </div>
          </section>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,transparent)] p-3 text-sm whitespace-pre-line">
              {error}
              <button
                className="block mt-2 text-xs underline"
                onClick={() => setError("")}
              >
                Fermer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
