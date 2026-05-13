// Hook pour zoomer le contenu : pinch tactile + Ctrl/Cmd + molette + boutons
import { useEffect, useRef } from "react";

export function useZoomable(scale: number, onChange: (v: number) => void, opts?: { min?: number; max?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const min = opts?.min ?? 0.6;
  const max = opts?.max ?? 3;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Wheel + Ctrl/Cmd
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      onChange(clamp(scale + delta, min, max));
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // Pinch tactile
    let initialDist = 0;
    let initialScale = scale;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialDist = dist(e.touches[0], e.touches[1]);
        initialScale = scale;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialDist > 0) {
        e.preventDefault();
        const d = dist(e.touches[0], e.touches[1]);
        const ratio = d / initialDist;
        onChange(clamp(initialScale * ratio, min, max));
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [scale, onChange, min, max]);

  return ref;
}

function dist(a: Touch, b: Touch) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}
function clamp(v: number, mn: number, mx: number) { return Math.max(mn, Math.min(mx, v)); }
