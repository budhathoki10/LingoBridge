import { SavedPhrases } from "./SavedPhrases";
import { SelectionMagicCard } from "./SelectionMagicCard";

export function App() {
  const version = chrome.runtime.getManifest().version;

  return (
    <main className="popup-shell">
      <header className="app-header">
        <div className="brand">
          <img src="/icon/32.png" alt="" width="30" height="30" />
          <div>
            <strong>LingoBridge</strong>
            <span>Translate without leaving the page</span>
          </div>
        </div>
      </header>

      <SelectionMagicCard />

      <SavedPhrases />

      <footer>
        <span>v{version}</span>
      </footer>
    </main>
  );
}
