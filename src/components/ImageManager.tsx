import { useState } from "react";
import { useStore } from "../lib/store";
import { Copy, ImageIcon, Trash, X } from "./icons";
import { imageFileToDataUrl } from "../lib/images";

export function ImageManager({ onClose }: { onClose: () => void }) {
  const { data, setData } = useStore();
  const [filter, setFilter] = useState("");
  const ids = Object.keys(data.images)
    .filter(id => id.toLowerCase().includes(filter.toLowerCase()))
    .sort();

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const entries = await Promise.all(Array.from(files).map(async file => {
      const url = await imageFileToDataUrl(file);
      return [file.name, url] as const;
    }));
    setData(d => { Object.assign(d.images, Object.fromEntries(entries)); });
  };

  const copyToken = (id: string) => {
    const token = `[image:${id}]`;
    navigator.clipboard?.writeText(token).then(
      () => alert(`Copié : ${token}`),
      () => prompt("Copie ce code dans ta carte :", token)
    );
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-3 fade-in" onClick={onClose}>
      <div className="bg-card border border-app rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col card-shadow" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-app">
          <div className="text-sm font-medium flex items-center gap-2"><ImageIcon /> Dossier Images</div>
          <button className="btn btn-ghost p-1" onClick={onClose}><X /></button>
        </div>

        <div className="p-4 border-b border-app flex flex-col sm:flex-row gap-2 sm:items-center">
          <label className="btn btn-primary">
            Importer des images
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { importFiles(e.target.files); e.currentTarget.value = ""; }} />
          </label>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="flex-1 p-2 rounded-lg border border-app bg-soft text-sm"
            placeholder="Rechercher une image..."
          />
          <div className="text-xs text-muted">{Object.keys(data.images).length} image(s) sauvegardée(s)</div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {ids.length === 0 ? (
            <div className="border border-dashed border-app rounded-lg p-10 text-center text-muted">
              Aucune image. Importe des schémas de physique, captures, figures, etc.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {ids.map(id => (
                <div key={id} className="border border-app rounded-lg overflow-hidden bg-app group">
                  <div className="aspect-video bg-soft flex items-center justify-center overflow-hidden">
                    <img src={data.images[id]} alt={id} className="max-w-full max-h-full object-contain" loading="lazy" />
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-medium truncate" title={id}>{id}</div>
                    <div className="flex gap-1 mt-2">
                      <button className="btn btn-ghost text-xs px-2 py-1 flex-1" onClick={() => copyToken(id)}><Copy /> Code</button>
                      <button className="btn btn-ghost text-xs px-2 py-1" onClick={() => {
                        if (confirm(`Supprimer l'image ${id} ? Les cartes qui l'utilisent afficheront "image manquante".`)) {
                          setData(d => { delete d.images[id]; });
                        }
                      }}><Trash /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-app bg-soft text-xs text-muted">
          Pour afficher une image dans une carte, insère <code>[image:nom-du-fichier.png]</code>. Les anciens formats physique <code>&gt;&gt;&gt; [IMAGE_ID: fichier.jpg] &lt;&lt;&lt;</code> sont aussi reconnus.
        </div>
      </div>
    </div>
  );
}