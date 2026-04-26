import { useRef, useState } from "react";
import { useStore, uid, newSrs } from "../lib/store";
import type { Card, UUID } from "../lib/types";
import { RichText } from "../lib/render";
import { ImageIcon, X } from "./icons";

interface Props {
  folderId: UUID;
  card?: Card | null;     // si présent => édition, sinon création
  onClose: () => void;
}

export function CardEditor({ folderId, card, onClose }: Props) {
  const { upsertCard, data, setData } = useStore();
  const [front, setFront] = useState(card?.front || "");
  const [back, setBack] = useState(card?.back || "");
  const [tags, setTags] = useState((card?.tags || []).join(", "));
  const [type, setType] = useState<string>(card?.type || "");
  const [preview, setPreview] = useState(true);
  const [target, setTarget] = useState<"front" | "back">("front");
  const frontRef = useRef<HTMLTextAreaElement | null>(null);
  const backRef = useRef<HTMLTextAreaElement | null>(null);
  const backdropDownRef = useRef(false);

  const save = () => {
    if (!front.trim() || !back.trim()) {
      alert("Recto et verso requis.");
      return;
    }
    const c: Card = card ? { ...card, front, back, tags: parseTags(tags), type: type as any || undefined }
      : {
        id: uid(),
        front, back,
        type: (type as any) || undefined,
        tags: parseTags(tags),
        imageId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        srs: newSrs(),
      };
    upsertCard(folderId, c);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 fade-in"
      onPointerDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onPointerUp={(e) => {
        if (backdropDownRef.current && e.target === e.currentTarget) onClose();
        backdropDownRef.current = false;
      }}
    >
      <div className="bg-card border border-app rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col card-shadow" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-app">
          <div className="text-sm font-medium">{card ? "Modifier la carte" : "Nouvelle carte"}</div>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost text-xs" onClick={() => setPreview(p => !p)}>
              {preview ? "Édition pure" : "Aperçu"}
            </button>
            <button className="btn btn-ghost p-1" onClick={onClose}><X /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Recto (question)">
            {data.settings.showMathToolbar !== false && (
              <MathToolbar onInsert={(s) => insertSnippet(s, "front")} />
            )}
            <textarea
              ref={frontRef}
              value={front}
              onFocus={() => setTarget("front")}
              onChange={e => setFront(e.target.value)}
              rows={6}
              className="w-full p-3 rounded-lg border border-app bg-soft font-mono text-sm resize-y"
              placeholder="Ex: $\sum \frac{n!}{3^n} x^n$ — quel rayon ?"
            />
            {preview && front.trim() && (
              <div className="mt-2 p-3 rounded-lg border border-app bg-app prose-card text-sm">
                <RichText text={front} images={data.images} />
              </div>
            )}
          </Field>

          <Field label="Verso (réponse)">
            {data.settings.showMathToolbar !== false && (
              <MathToolbar onInsert={(s) => insertSnippet(s, "back")} />
            )}
            <textarea
              ref={backRef}
              value={back}
              onFocus={() => setTarget("back")}
              onChange={e => setBack(e.target.value)}
              rows={6}
              className="w-full p-3 rounded-lg border border-app bg-soft font-mono text-sm resize-y"
              placeholder="**Règle de d'Alembert** : ..."
            />
            {preview && back.trim() && (
              <div className="mt-2 p-3 rounded-lg border border-app bg-app prose-card text-sm">
                <RichText text={back} images={data.images} />
              </div>
            )}
          </Field>

          <Field label="Images">
            <div className="flex flex-wrap gap-2">
              <label className="btn text-xs">
                <ImageIcon /> Importer
                <input type="file" accept="image/*" multiple className="hidden" onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (!files.length) return;
                  const imported = await filesToDataUrls(files);
                  setData(d => { Object.assign(d.images, imported); });
                  const first = Object.keys(imported)[0];
                  if (first) insertSnippet(`[image:${first}]`, target);
                  e.currentTarget.value = "";
                }} />
              </label>
              <select
                className="p-2 rounded-lg border border-app bg-soft text-xs flex-1 min-w-40"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) insertSnippet(`[image:${e.target.value}]`, target);
                  e.currentTarget.value = "";
                }}
              >
                <option value="">Insérer une image existante…</option>
                {Object.keys(data.images).sort().map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
            <div className="text-[11px] text-muted mt-1">Clique dans le recto ou verso, puis importe/insère. Format inséré : <code>[image:nom]</code>.</div>
          </Field>

          <Field label="Type (optionnel)">
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full p-2 rounded-lg border border-app bg-soft text-sm"
            >
              <option value="">—</option>
              <option value="M">Méthode</option>
              <option value="T">Théorème</option>
              <option value="C">Calcul</option>
              <option value="P">Piège</option>
              <option value="V">Vocabulaire</option>
              <option value="Q">Question</option>
            </select>
          </Field>

          <Field label="Tags (séparés par virgule)">
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              className="w-full p-2 rounded-lg border border-app bg-soft text-sm"
              placeholder="ex: chap1, examen"
            />
          </Field>

          <div className="md:col-span-2 text-xs text-muted">
            Syntaxes : <code>$x^2$</code>, <code>$$\int_0^1 f$$</code>, <code>[image:nom]</code>, <code>**gras**</code>, listes <code>- item</code>. Les boutons ci-dessus évitent d'écrire à la main <code>\frac</code>, <code>\sum</code>, etc.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-app bg-soft">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={save}>Enregistrer</button>
        </div>
      </div>
    </div>
  );

  function insertSnippet(snippet: string, where: "front" | "back") {
    const ref = where === "front" ? frontRef : backRef;
    const value = where === "front" ? front : back;
    const setValue = where === "front" ? setFront : setBack;
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    setValue(next);
    setTimeout(() => {
      ref.current?.focus();
      const pos = start + snippet.length;
      ref.current?.setSelectionRange(pos, pos);
    }, 0);
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted mb-1.5 font-medium">{label}</div>
      {children}
    </div>
  );
}

function parseTags(s: string) {
  const arr = s.split(",").map(x => x.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

function MathToolbar({ onInsert }: { onInsert: (s: string) => void }) {
  const snippets = [
    ["x²", "$x^2$"], ["frac", "$\\frac{a}{b}$"], ["sqrt", "$\\sqrt{x}$"],
    ["sum", "$\\sum_{n=0}^{+\\infty} u_n$"], ["int", "$\\int_a^b f(x)\\,dx$"],
    ["lim", "$\\lim_{n\\to+\\infty} u_n$"], ["∀", "$\\forall x \\in I,$"],
    ["→", "$\\to$"], ["⇔", "$\\Longleftrightarrow$"], ["vec", "$\\vec{E}$"],
    ["bloc", "$$\n\\begin{aligned}\n&\\text{ligne 1}\\\\\n&\\text{ligne 2}\n\\end{aligned}\n$$"],
  ];
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      {snippets.map(([label, value]) => (
        <button key={label} type="button" className="btn btn-ghost text-[11px] px-2 py-1" onClick={() => onInsert(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}

async function filesToDataUrls(files: File[]) {
  const entries = await Promise.all(files.map(async file => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return [file.name, dataUrl] as const;
  }));
  return Object.fromEntries(entries);
}
