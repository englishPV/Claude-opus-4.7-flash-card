import { useStore } from "../lib/store";
import { SettingsIcon, X } from "./icons";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { data, setData, toggleTheme } = useStore();
  const s = data.settings;

  const setSetting = <K extends keyof typeof s>(key: K, value: (typeof s)[K]) => {
    setData(d => { (d.settings as any)[key] = value; });
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 fade-in" onClick={onClose}>
      <div className="bg-card border border-app rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col card-shadow" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-app">
          <div className="text-sm font-medium flex items-center gap-2"><SettingsIcon /> Paramètres</div>
          <button className="btn btn-ghost p-1" onClick={onClose}><X /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <Section title="Apparence">
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={toggleTheme}>Basculer dark/light</button>
              <Toggle label="Mode compact" checked={!!s.compactMode} onChange={v => setSetting("compactMode", v)} />
            </div>
            <Slider label="Zoom recto par défaut" value={s.fontScaleFront} min={0.7} max={2.4} step={0.05} onChange={v => setSetting("fontScaleFront", v)} />
            <Slider label="Zoom verso par défaut" value={s.fontScaleBack} min={0.7} max={2.4} step={0.05} onChange={v => setSetting("fontScaleBack", v)} />
          </Section>

          <Section title="Création de cartes">
            <Toggle label="Afficher la barre de formules maths/physique" checked={s.showMathToolbar !== false} onChange={v => setSetting("showMathToolbar", v)} />
            <Toggle label="Demander aussi l'emoji quand je renomme un dossier" checked={!!s.showEmojiInFolderRename} onChange={v => setSetting("showEmojiInFolderRename", v)} />
            <p className="text-xs text-muted">
              Par défaut les dossiers restent sobres sans emoji. Si tu actives cette option, le renommage proposera aussi une case emoji.
            </p>
          </Section>

          <Section title="Répétition espacée">
            <NumberField label="Nouvelles cartes max / session" value={s.newPerDay} min={1} max={500} onChange={v => setSetting("newPerDay", v)} />
            <NumberField label="Révisions max / session" value={s.reviewsPerDay} min={1} max={1000} onChange={v => setSetting("reviewsPerDay", v)} />
            <div className="rounded-lg border border-app bg-soft p-3 text-xs text-muted leading-relaxed">
              L'algo fonctionne comme Anki : une carte réussie revient à J+1, puis l'intervalle grandit selon ta facilité. Les cartes rouges/oranges/bleues sont traitées avant les nouvelles. En pratique, la catégorie importante correspond aux cartes rouges (oubliées), orange (apprentissage) et bleues (dues), triées en priorité dans chaque dossier et dans la file de révision.
            </div>
          </Section>

          <Section title="Données">
            <div className="text-sm text-soft">Images stockées : {Object.keys(data.images).length}</div>
            <div className="text-xs text-muted">Si ton compte Google est connecté, les images sont incluses dans la sauvegarde Firebase avec les cartes et paramètres.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">{title}</div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-sm">
      <div className="flex justify-between mb-1"><span>{label}</span><span className="text-muted">{value.toFixed(2)}x</span></div>
      <input className="w-full" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input className="w-28 p-2 rounded-lg border border-app bg-soft text-sm" type="number" min={min} max={max} value={value} onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))} />
    </label>
  );
}