import { AccountCard } from "./AccountCard";
import { LogoMark } from "./Icons";
import { SelectionMagicCard } from "./SelectionMagicCard";

export function App() {
  return (
    <main className="popup-shell">
      <header className="app-header">
        <div className="brand">
          <LogoMark />
          <div className="brand__copy">
            <h1 className="brand__name">LingoBridge</h1>
            <p className="brand__tagline">Translate without leaving the page</p>
          </div>
        </div>
      </header>

      <SelectionMagicCard />

      <AccountCard />
    </main>
  );
}
