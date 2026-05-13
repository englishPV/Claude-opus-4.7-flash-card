// Types principaux de l'application
export type UUID = string;

export type CardType = "M" | "T" | "C" | "P" | "V" | "Q";
// M=Méthode, T=Théorème, C=Calcul, P=Piège, V=Vocabulaire, Q=Question générique

export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy (Anki SM-2 like)

export interface SrsState {
  // SM-2 / Anki simplifié
  ease: number;          // facteur de facilité (default 2.5)
  interval: number;      // intervalle en jours
  reps: number;          // nb de répétitions réussies consécutives
  lapses: number;        // nb d'oublis
  due: number;           // timestamp ms de prochaine révision
  lastReview: number | null;
  state: "new" | "learning" | "review" | "relearning";
  step: number;          // index dans les learning steps
}

export interface Card {
  id: UUID;
  front: string;
  back: string;
  type?: CardType;
  tags?: string[];
  imageId?: string | null;     // référence à une image stockée
  createdAt: number;
  updatedAt: number;
  srs: SrsState;
}

export interface Folder {
  id: UUID;
  name: string;
  emoji?: string;              // emoji optionnel pour décorer
  parentId: UUID | null;       // null = racine
  createdAt: number;
  cards: Card[];
}

export interface AppData {
  version: number;
  folders: Folder[];           // arborescence à plat (parentId)
  settings: {
    theme: "light" | "dark";
    fontScaleFront: number;    // 1 = normal
    fontScaleBack: number;
    newPerDay: number;
    reviewsPerDay: number;
    showEmojiInFolderRename?: boolean;
    showMathToolbar?: boolean;
    compactMode?: boolean;
  };
  images: Record<string, string>; // imageId -> dataURL
  history: ReviewLog[];
}

export interface ReviewLog {
  cardId: UUID;
  ts: number;
  rating: Rating;
  prevInterval: number;
  newInterval: number;
}
