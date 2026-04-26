import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { Card, Folder, Rating } from "../lib/types";
import { dueState, formatInterval, previewIntervals, rate as srsRate, isInQueue } from "../lib/srs";
import { RichText } from "../lib/render";
import { useZoomable } from "../lib/zoomable";
import { X } from "./icons";

interface Props {
  folder: Folder;
  includeChildren: boolean;
  onClose: () => void;
}

export function Review({ folder, includeChildren, onClose }: Props) {
  const { data, allDescendantFolders, rateCard, setFontScale } = useStore();

  const queue = useMemo(() => {
    const folders = [folder, ...(includeChildren ? allDescendantFolders(folder.id) : [])];
    const all: { folderId: string; card: Card }[] = [];
    const now = Date.now();
    for (const f of folders) {
      const live = data.folders.find(x => x.id === f.id);
      if (!live) continue;
      for (const c of live.cards) {
        if (isInQueue(c, now)) all.push({ folderId: live.id, card: c });
      }
    }
    all.sort((a, b) => {
      const order = (s: string) =>
        s === "relearning" ? 0 : s === "learning" ? 1 : s === "due" ? 2 : 3;
      return order(dueState(a.card, now)) - order(dueState(b.card, now));
    });
    const reviews = all.filter(x => dueState(x.card, now) !== "new").slice(0, data.settings.reviewsPerDay || 200);
    const news = all.filter(x => dueState(x.card, now) === "new").slice(0, data.settings.newPerDay || 20);
    return [...reviews, ...news];
  }, [data, folder, includeChildren, allDescendantFolders]);

  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const current = queue[idx];

  // Référence sur la zone scrollable — on revient TOUJOURS en haut
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  };

  // Retourner la carte → scroll to top
  const revealBack = () => {
    setShowBack(true);
    // micro-délai pour que le verso soit monté avant de scroller
    setTimeout(scrollToTop, 0);
  };

  // Carte suivante → scroll to top + reset
  const rate = (r: Rating) => {
    if (!current) return;
    rateCard(current.folderId, current.card.id, r);
    setShowBack(false);
    setIdx(i => i + 1);
    setTimeout(scrollToTop, 0);
  };

  // Raccourcis clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " ") { e.preventDefault(); if (!showBack) revealBack(); }
      else if (e.key === "Escape") onClose();
      else if (showBack && current) {
        const map: Record<string, Rating> = { "1": 1, "2": 2, "3": 3, "4": 4 };
        if (map[e.key]) rate(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const frontZoomRef = useZoomable(data.settings.fontScaleFront, v => setFontScale("front", v));
  const backZoomRef = useZoomable(data.settings.fontScaleBack, v => setFontScale("back", v));

  if (!current) {
    return (
      <div className="fixed inset-0 z-30 bg-app flex items-center justify-center fade-in">
        <div className="text-center">
          <div className="text-2xl font-medium mb-2">🎉 Plus rien à réviser</div>
          <div className="text-muted mb-6">Reviens plus tard ou ajoute des cartes.</div>
          <button className="btn btn-primary" onClick={onClose}>Retour</button>
        </div>
      </div>
    );
  }

  const intervals = previewIntervals(current.card);
  const stats = countStats(queue, idx);

  return (
    <div className="fixed inset-0 z-30 bg-app flex flex-col fade-in">

      {/* Header — fixe en haut */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-app bg-card">
        <button className="btn btn-ghost p-1" onClick={onClose}><X /></button>
        <div className="text-sm text-soft truncate px-3 flex-1 text-center">{folder.name}</div>
        <div className="text-xs text-muted flex items-center gap-2.5 tabular-nums">
          <CountDot color="var(--bad)"       n={stats.relearning} title="Oubliées" />
          <CountDot color="var(--warn)"      n={stats.learning}   title="Apprentissage" />
          <CountDot color="var(--info)"      n={stats.due}        title="Révision" />
          <CountDot color="var(--text-muted)" n={stats.new}       title="Nouvelles" />
        </div>
      </div>

      {/* Zone scrollable — contient recto + verso */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div className="w-full max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-4 min-w-0">

          {/* Recto */}
          <div
            ref={frontZoomRef}
            className="bg-card border border-app rounded-xl p-5 md:p-8 card-shadow prose-card touch-none"
            style={{ fontSize: `${data.settings.fontScaleFront}rem`, lineHeight: 1.6 }}
          >
            <div className="text-xs uppercase tracking-wider text-muted mb-3 font-medium">
              Recto{current.card.type ? ` · ${current.card.type}` : ""}
            </div>
            <RichText text={current.card.front} images={data.images} />
          </div>

          {/* Verso — apparaît sous le recto, on peut scroller pour tout voir */}
          {showBack && (
            <div
              ref={backZoomRef}
              className="bg-card border border-app rounded-xl p-5 md:p-8 card-shadow prose-card touch-none fade-in"
              style={{ fontSize: `${data.settings.fontScaleBack}rem`, lineHeight: 1.6 }}
            >
              <div className="text-xs uppercase tracking-wider text-muted mb-3 font-medium">Verso</div>
              <RichText text={current.card.back} images={data.images} />
            </div>
          )}

          {/* Espace en bas pour que les boutons fixes ne cachent rien */}
          <div className="h-4" />
        </div>
      </div>

      {/* Actions — fixes en bas */}
      <div className="shrink-0 border-t border-app p-3 bg-card">
        {!showBack ? (
          <button className="btn btn-primary w-full py-3" onClick={revealBack}>
            Afficher la réponse <span className="text-xs opacity-60 ml-2">(Espace)</span>
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            <RateBtn label="À revoir"  sub={intervals[1]} k="1" color="bad"  onClick={() => rate(1)} />
            <RateBtn label="Difficile" sub={intervals[2]} k="2" color="warn" onClick={() => rate(2)} />
            <RateBtn label="Bien"      sub={intervals[3]} k="3" color="good" onClick={() => rate(3)} />
            <RateBtn label="Facile"    sub={intervals[4]} k="4" color="info" onClick={() => rate(4)} />
          </div>
        )}
      </div>

    </div>
  );
}

function RateBtn({ label, sub, k, color, onClick }: {
  label: string; sub: string; k: string; color: string; onClick: () => void;
}) {
  const colorVar: Record<string, string> = {
    bad: "var(--bad)", warn: "var(--warn)", good: "var(--good)", info: "var(--info)",
  };
  return (
    <button
      onClick={onClick}
      className="btn flex-col py-2.5 gap-0.5"
      style={{ borderColor: colorVar[color] }}
    >
      <span className="text-sm font-medium" style={{ color: colorVar[color] }}>{label}</span>
      <span className="text-[11px] text-muted">{sub} · {k}</span>
    </button>
  );
}

function countStats(queue: { card: Card }[], from: number) {
  let relearning = 0, learning = 0, due = 0, neu = 0;
  for (let i = from; i < queue.length; i++) {
    const s = dueState(queue[i].card);
    if (s === "relearning") relearning++;
    else if (s === "learning") learning++;
    else if (s === "due") due++;
    else if (s === "new") neu++;
  }
  return { relearning, learning, due, new: neu };
}

function CountDot({ color, n, title }: { color: string; n: number; title: string }) {
  if (n === 0) return null;
  return (
    <span title={title} className="inline-flex items-center gap-1">
      <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: color }} />
      {n}
    </span>
  );
}

void srsRate;
void formatInterval;
