// Icônes SVG inline minimales (sobre)
import type { SVGProps } from "react";
const I = (p: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p} />
);

export const FolderIcon = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></I>;
export const FolderOpenIcon = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2H3z"/><path d="M3 9h18l-2 9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></I>;
export const ChevronRight = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M9 6l6 6-6 6"/></I>;
export const ChevronDown = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M6 9l6 6 6-6"/></I>;
export const Plus = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 5v14M5 12h14"/></I>;
export const Trash = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></I>;
export const Edit = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></I>;
export const Search = (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></I>;
export const Sun = (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></I>;
export const Moon = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></I>;
export const Cloud = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M17.5 19a4.5 4.5 0 1 0-1.42-8.78A6.5 6.5 0 0 0 4 13.5 4.5 4.5 0 0 0 8 19z"/></I>;
export const Upload = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></I>;
export const BarChart = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 20V10M18 20V4M6 20v-6"/></I>;
export const Play = (p: SVGProps<SVGSVGElement>) => <I {...p}><polygon points="5 3 19 12 5 21 5 3"/></I>;
export const X = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M18 6L6 18M6 6l12 12"/></I>;
export const Menu = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M3 6h18M3 12h18M3 18h18"/></I>;
export const Card = (p: SVGProps<SVGSVGElement>) => <I {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></I>;
export const Copy = (p: SVGProps<SVGSVGElement>) => <I {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></I>;
export const Sparkles = (p: SVGProps<SVGSVGElement>) => <I {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></I>;
export const ImageIcon = (p: SVGProps<SVGSVGElement>) => <I {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5L5 19"/></I>;
export const SettingsIcon = (p: SVGProps<SVGSVGElement>) => <I {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1.06V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.06-.33H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1.06V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.32.37.6.6 1 .32.22.69.33 1.06.33H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/></I>;
