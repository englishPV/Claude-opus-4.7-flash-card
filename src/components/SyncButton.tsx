import { useEffect, useState } from "react";
import { FireSync } from "../lib/firebase";
import { useStore } from "../lib/store";
import { Cloud } from "./icons";
import type { User } from "firebase/auth";

export function SyncButton() {
  const { data, setData } = useStore();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastPush, setLastPush] = useState<number>(0);

  useEffect(() => {
    const unsub = FireSync.onAuthChange(async (u) => {
      setUser(u);
      if (u) {
        // pull au login si cloud plus récent
        try {
          setBusy(true);
          const meta = await FireSync.pullMeta(u.uid);
          if (meta && meta.lastModified > lastPush + 5000) {
            const cloud = await FireSync.pull(u.uid);
            if (cloud && cloud.folders) {
              if (confirm("Données distantes plus récentes détectées. Les charger ?")) {
                setData(() => cloud);
              }
            }
          } else if (!meta) {
            // premier push
            await FireSync.push(u.uid, data);
            setLastPush(Date.now());
          }
        } catch (e) {
          console.warn(e);
        } finally {
          setBusy(false);
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-push debounced quand data change
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(async () => {
      try {
        setBusy(true);
        await FireSync.push(user.uid, data);
        setLastPush(Date.now());
      } catch (e) {
        console.warn("push fail", e);
      } finally {
        setBusy(false);
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [data, user]);

  const onClick = async () => {
    if (!user) {
      try { await FireSync.login(); } catch (e: any) { alert("Erreur connexion : " + e?.message); }
    } else {
      const action = prompt(
        "Sync :\n1 = Envoyer maintenant\n2 = Récupérer depuis le cloud\n3 = Se déconnecter",
        "1"
      );
      if (action === "1") {
        try {
          setBusy(true);
          await FireSync.push(user.uid, data);
          setLastPush(Date.now());
          alert("Envoyé !");
        } catch (e: any) { alert("Erreur : " + e?.message); }
        finally { setBusy(false); }
      } else if (action === "2") {
        try {
          setBusy(true);
          const cloud = await FireSync.pull(user.uid);
          if (cloud) {
            if (confirm("Remplacer les données locales par celles du cloud ?")) {
              setData(() => cloud);
            }
          } else {
            alert("Aucune donnée distante.");
          }
        } catch (e: any) { alert("Erreur : " + e?.message); }
        finally { setBusy(false); }
      } else if (action === "3") {
        await FireSync.logout();
      }
    }
  };

  return (
    <button
      className="btn btn-ghost p-2"
      onClick={onClick}
      title={user ? `Connecté : ${user.email}` : "Se connecter (sync cloud)"}
    >
      {busy ? <span className="text-xs">⏳</span> : <Cloud className={user ? "text-[var(--info)]" : ""} />}
    </button>
  );
}
