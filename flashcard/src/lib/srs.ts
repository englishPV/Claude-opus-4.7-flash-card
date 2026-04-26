// Algorithme SRS inspiré d'Anki (SM-2 modifié)
import type { Card, Rating, SrsState } from "./types";

export const DAY_MS = 86_400_000;

export const LEARNING_STEPS_MIN = [1, 10]; // 1min, 10min
export const RELEARNING_STEPS_MIN = [10];
export const GRADUATING_INTERVAL_DAYS = 1;
export const EASY_INTERVAL_DAYS = 4;
export const MIN_EASE = 1.3;
export const STARTING_EASE = 2.5;

export function newSrs(): SrsState {
  return {
    ease: STARTING_EASE,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: Date.now(),
    lastReview: null,
    state: "new",
    step: 0,
  };
}

export interface RatedResult {
  srs: SrsState;
  prevInterval: number;
  newInterval: number;
}

export function rate(card: Card, rating: Rating, now = Date.now()): RatedResult {
  const s: SrsState = { ...card.srs };
  const prevInterval = s.interval;

  if (s.state === "new" || s.state === "learning") {
    if (rating === 1) {
      // Again -> retour étape 0
      s.step = 0;
      s.state = "relearning";
      s.lapses += 1;
      s.due = now + LEARNING_STEPS_MIN[0] * 60_000;
      s.interval = 0;
    } else if (rating === 2) {
      // Hard -> répète l'étape courante
      const stepMin = LEARNING_STEPS_MIN[s.step] ?? LEARNING_STEPS_MIN[0];
      s.due = now + stepMin * 60_000;
    } else if (rating === 3) {
      // Good -> étape suivante ou diplomé
      if (s.step + 1 >= LEARNING_STEPS_MIN.length) {
        s.state = "review";
        s.interval = GRADUATING_INTERVAL_DAYS;
        s.due = now + s.interval * DAY_MS;
        s.reps = 1;
      } else {
        s.step += 1;
        s.due = now + LEARNING_STEPS_MIN[s.step] * 60_000;
      }
    } else {
      // Easy -> diplomé direct
      s.state = "review";
      s.interval = EASY_INTERVAL_DAYS;
      s.due = now + s.interval * DAY_MS;
      s.reps = 1;
    }
  } else if (s.state === "review") {
    if (rating === 1) {
      // Lapse
      s.lapses += 1;
      s.ease = Math.max(MIN_EASE, s.ease - 0.2);
      s.state = "relearning";
      s.step = 0;
      s.interval = Math.max(1, Math.round(s.interval * 0.3));
      s.due = now + RELEARNING_STEPS_MIN[0] * 60_000;
    } else {
      let factor = 1;
      if (rating === 2) {
        s.ease = Math.max(MIN_EASE, s.ease - 0.15);
        factor = 1.2;
      } else if (rating === 3) {
        factor = s.ease;
      } else if (rating === 4) {
        s.ease = s.ease + 0.15;
        factor = s.ease * 1.3;
      }
      const next = Math.max(s.interval + 1, Math.round(s.interval * factor));
      s.interval = next;
      s.due = now + next * DAY_MS;
      s.reps += 1;
    }
  } else if (s.state === "relearning") {
    if (rating === 1) {
      s.step = 0;
      s.due = now + RELEARNING_STEPS_MIN[0] * 60_000;
    } else if (rating === 2) {
      s.due = now + RELEARNING_STEPS_MIN[s.step] * 60_000;
    } else {
      // Good ou Easy -> retour en review
      s.state = "review";
      s.due = now + Math.max(1, s.interval) * DAY_MS;
      s.reps += 1;
    }
  }

  s.lastReview = now;
  return { srs: s, prevInterval, newInterval: s.interval };
}

export function dueState(card: Card, now = Date.now()):
  | "new" | "learning" | "relearning" | "due" | "future" {
  if (card.srs.state === "new") return "new";
  if (card.srs.state === "relearning") {
    return card.srs.due <= now ? "relearning" : "relearning";
    // toujours visible comme rouge (lapse récent), même si dans le futur proche
  }
  if (card.srs.state === "learning") {
    return card.srs.due <= now ? "learning" : "learning";
  }
  return card.srs.due <= now ? "due" : "future";
}

// Une carte est-elle "à étudier maintenant" (apparait dans la file) ?
export function isInQueue(card: Card, now = Date.now()): boolean {
  if (card.srs.state === "new") return true;
  return card.srs.due <= now;
}

export function previewIntervals(card: Card, now = Date.now()): Record<Rating, string> {
  const r: Record<number, string> = {};
  ([1, 2, 3, 4] as Rating[]).forEach(rt => {
    const { srs } = rate(card, rt, now);
    r[rt] = formatInterval(srs.due - now);
  });
  return r as Record<Rating, string>;
}

export function formatInterval(ms: number): string {
  if (ms < 60_000) return "<1min";
  if (ms < 3_600_000) return Math.round(ms / 60_000) + "min";
  if (ms < DAY_MS) return Math.round(ms / 3_600_000) + "h";
  if (ms < 30 * DAY_MS) return Math.round(ms / DAY_MS) + "j";
  if (ms < 365 * DAY_MS) return Math.round(ms / (30 * DAY_MS)) + "mo";
  return (ms / (365 * DAY_MS)).toFixed(1) + "an";
}
