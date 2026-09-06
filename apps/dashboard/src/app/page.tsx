const workspaceRows = [
  ["Dashboard", "Next.js application ready"],
  ["Extension", "Manifest V3 workspace ready"],
  ["Gateway", "Protected API boundary ready"],
] as const;

export default function Home() {
  return (
    <main className="foundation">
      <p className="eyebrow">Phase 1 foundation</p>
      <h1>LingoBridge dashboard</h1>
      <p className="summary">
        The project structure is ready. Authentication, saved phrases, and synchronization arrive in
        their approved phases.
      </p>

      <section aria-labelledby="workspace-status">
        <h2 id="workspace-status">Workspace status</h2>
        <dl>
          {workspaceRows.map(([name, status]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{status}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
