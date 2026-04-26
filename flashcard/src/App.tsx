import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { Browse } from "./components/Browse";
import { SearchBar } from "./components/SearchBar";
import { Stats } from "./components/Stats";
import { SyncButton } from "./components/SyncButton";
import { CardEditor } from "./components/CardEditor";
import { ImageManager } from "./components/ImageManager";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sun, Moon, Menu, X, BarChart, Card, ImageIcon, SettingsIcon } from "./components/icons";
import type { Card as TCard, UUID } from "./lib/types";

function Shell() {
  const { data, toggleTheme, getFolder } = useStore();
  const [selectedId, setSelectedId] = useState<UUID | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editFromSearch, setEditFromSearch] = useState<{ folderId: UUID; card: TCard } | null>(null);

  // Listen to selection events from Browse cards
  useEffect(() => {
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent).detail as UUID;
      setSelectedId(id);
      setSidebarOpen(false);
    };
    window.addEventListener("fc:select-folder", onSelect);
    const onImages = () => setShowImages(true);
    window.addEventListener("fc:open-images", onImages);
    return () => {
      window.removeEventListener("fc:select-folder", onSelect);
      window.removeEventListener("fc:open-images", onImages);
    };
  }, []);

  const folder = selectedId ? getFolder(selectedId) || null : null;

  const handleSearchOpen = (folderId: UUID, cardId: string) => {
    const f = getFolder(folderId);
    if (!f) return;
    const card = f.cards.find(c => c.id === cardId);
    if (!card) return;
    setSelectedId(folderId);
    setEditFromSearch({ folderId, card });
  };

  return (
    <div className="h-full flex flex-col bg-app text-[var(--text)]">
      {/* Top bar */}
      <header className="h-12 border-b border-app flex items-center px-2 md:px-3 gap-2 bg-card shrink-0">
        <button className="btn btn-ghost p-2 md:hidden" onClick={() => setSidebarOpen(v => !v)}>
          {sidebarOpen ? <X /> : <Menu />}
        </button>
        <div className="flex items-center gap-1.5 mr-2">
          <Card className="text-soft" />
          <span className="font-medium text-sm hidden sm:inline">Flashcards</span>
        </div>
        <div className="flex-1 max-w-md">
          <SearchBar onOpen={handleSearchOpen} />
        </div>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost p-2" onClick={() => setShowStats(true)} title="Statistiques">
            <BarChart />
          </button>
          <button className="btn btn-ghost p-2" onClick={() => setShowImages(true)} title="Images">
            <ImageIcon />
          </button>
          <SyncButton />
          <button className="btn btn-ghost p-2" onClick={() => setShowSettings(true)} title="Paramètres">
            <SettingsIcon />
          </button>
          <button className="btn btn-ghost p-2" onClick={toggleTheme} title="Thème">
            {data.settings.theme === "dark" ? <Sun /> : <Moon />}
          </button>
        </div>
      </header>

      {/* Layout */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Sidebar */}
        <aside
          className="sidebar-aside border-r border-app bg-card flex flex-col h-full"
          data-open={sidebarOpen ? "true" : "false"}
        >
          <Sidebar selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setSidebarOpen(false); }} />
        </aside>
        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0">
          <Browse folder={folder} />
        </main>
      </div>

      {showStats && <Stats onClose={() => setShowStats(false)} />}
      {showImages && <ImageManager onClose={() => setShowImages(false)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {editFromSearch && (
        <CardEditor
          folderId={editFromSearch.folderId}
          card={editFromSearch.card}
          onClose={() => setEditFromSearch(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
