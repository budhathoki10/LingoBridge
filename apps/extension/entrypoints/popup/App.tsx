export function App() {
  const version = chrome.runtime.getManifest().version;

  return (
    <main className="popup-shell">
      <header>
        <img src="/icon/32.png" alt="" width="32" height="32" />
        <div>
          <strong>LingoBridge</strong>
          <span>Foundation v{version}</span>
        </div>
      </header>

      <section aria-labelledby="foundation-ready">
        <p className="status">Phase 1</p>
        <h1 id="foundation-ready">Extension shell ready</h1>
        <p>The translation interface will be connected to a safe fake provider in Phase 2.</p>
      </section>
    </main>
  );
}
