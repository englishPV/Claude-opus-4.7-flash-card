import { useMemo } from "react";
import { useStore } from "../lib/store";
import { dueState } from "../lib/srs";
import { X } from "./icons";

export function Stats({ onClose }: { onClose: () => void }) {
  const { data } = useStore();

  const summary = useMemo(() => {
    let total = 0, neu = 0, learning = 0, review = 0, due = 0;
    const intervals: number[] = [];
    for (const f of data.folders) {
      for (const c of f.cards) {
        total++;
        if (c.srs.state === "new") neu++;
        else if (c.srs.state === "learning" || c.srs.state === "relearning") learning++;
        else review++;
        const s = dueState(c);
        if (s === "due" || s === "learning" || s === "new") due++;
        if (c.srs.interval > 0) intervals.push(c.srs.interval);
      }
    }
    const avgInterval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    return { total, neu, learning, review, due, avgInterval };
  }, [data.folders]);

  // Reviews par jour (30 derniers)
  const last30 = useMemo(() => {
    const days: { date: string; count: number; lapses: number }[] = [];
    const dayMs = 86_400_000;
    const now = Date.now();
    const start = now - 29 * dayMs;
    const buckets = new Map<string, { count: number; lapses: number }>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(start + i * dayMs);
      const k = d.toISOString().slice(0, 10);
      buckets.set(k, { count: 0, lapses: 0 });
    }
    for (const log of data.history) {
      const k = new Date(log.ts).toISOString().slice(0, 10);
      const b = buckets.get(k);
      if (b) {
        b.count++;
        if (log.rating === 1) b.lapses++;
      }
    }
    for (const [date, v] of buckets) days.push({ date, ...v });
    return days;
  }, [data.history]);

  const max = Math.max(1, ...last30.map(d => d.count));

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 fade-in" onClick={onClose}>
      <div className="bg-card border border-app rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col card-shadow" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-app">
          <div className="text-sm font-medium">Statistiques</div>
          <button className="btn btn-ghost p-1" onClick={onClose}><X /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total cartes" value={summary.total.toString()} />
            <Stat label="À réviser" value={summary.due.toString()} accent />
            <Stat label="En apprentissage" value={summary.learning.toString()} />
            <Stat label="En révision" value={summary.review.toString()} />
            <Stat label="Nouvelles" value={summary.neu.toString()} />
            <Stat label="Intervalle moyen" value={summary.avgInterval > 0 ? summary.avgInterval.toFixed(1) + "j" : "—"} />
            <Stat label="Reviews 30j" value={last30.reduce((s, d) => s + d.count, 0).toString()} />
            <Stat label="Oublis 30j" value={last30.reduce((s, d) => s + d.lapses, 0).toString()} />
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-3 font-medium">Activité (30 derniers jours)</div>
            <div className="flex items-end gap-1 h-32 border-b border-app">
              {last30.map(d => (
                <div key={d.date} className="flex-1 flex flex-col justify-end" title={`${d.date} : ${d.count} reviews`}>
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${(d.count / max) * 100}%`, background: "var(--info)", minHeight: d.count > 0 ? 2 : 0 }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted mt-1">
              <span>{last30[0]?.date.slice(5)}</span>
              <span>{last30[last30.length - 1]?.date.slice(5)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border border-app rounded-lg p-3 bg-app">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${accent ? "text-[var(--info)]" : ""}`}>{value}</div>
    </div>
  );
}
