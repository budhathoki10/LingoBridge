import { useEffect, useMemo, useState } from "react";
import {
  loadSavedPhrases,
  removeSavedPhrase,
  type SavedPhrase,
  saveSavedPhrases,
  searchSavedPhrases,
  serializeSavedPhrases,
} from "../../lib/saved-phrases";

type CardState =
  | { kind: "loading" }
  | { kind: "ready"; phrases: SavedPhrase[] }
  | { kind: "error"; message: string };

function formatSavedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function SavedPhrases() {
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    let active = true;
    void loadSavedPhrases()
      .then((phrases) => {
        if (active) setState({ kind: "ready", phrases });
      })
      .catch(() => {
        if (active) setState({ kind: "error", message: "Saved phrases could not be read." });
      });
    return () => {
      active = false;
    };
  }, []);

  const phrases = state.kind === "ready" ? state.phrases : [];
  const visible = useMemo(() => searchSavedPhrases(phrases, query), [phrases, query]);

  async function persist(next: SavedPhrase[]): Promise<void> {
    setState({ kind: "ready", phrases: next });
    try {
      setState({ kind: "ready", phrases: await saveSavedPhrases(next) });
    } catch {
      setState({ kind: "error", message: "The change could not be saved." });
    }
  }

  function handleDelete(id: string): void {
    void persist(removeSavedPhrase(phrases, id));
  }

  function handleClearAll(): void {
    setConfirmingClear(false);
    void persist([]);
  }

  function handleExport(): void {
    const blob = new Blob([serializeSavedPhrases(phrases)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `lingobridge-phrases-${new Date().toISOString().slice(0, 10)}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (state.kind === "loading") {
    return (
      <section aria-busy="true" className="phrases">
        <h2>Saved phrases</h2>
        <p className="phrases__empty">Loading…</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="phrases">
        <h2>Saved phrases</h2>
        <p className="phrases__empty">{state.message}</p>
      </section>
    );
  }

  return (
    <section className="phrases">
      <div className="phrases__heading">
        <h2>Saved phrases</h2>
        {phrases.length > 0 ? <span className="phrases__count">{phrases.length}</span> : null}
      </div>

      {phrases.length === 0 ? (
        <p className="phrases__empty">
          Nothing saved yet. Translate a selection, then choose <strong>Save phrase</strong> to keep
          it here.
        </p>
      ) : (
        <>
          <input
            aria-label="Search saved phrases"
            className="phrases__search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={query}
          />

          {visible.length === 0 ? (
            <p className="phrases__empty">No phrase matches “{query}”.</p>
          ) : (
            <ul className="phrases__list">
              {visible.map((phrase) => (
                <li className="phrase" key={phrase.id}>
                  <div className="phrase__text">
                    <p className="phrase__source" dir="auto" lang={phrase.sourceLanguage}>
                      {phrase.sourceText}
                    </p>
                    <p className="phrase__translation" dir="auto" lang={phrase.targetLanguage}>
                      {phrase.translatedText}
                    </p>
                    <p className="phrase__meta">
                      {phrase.sourceLanguage} → {phrase.targetLanguage} ·{" "}
                      {formatSavedAt(phrase.savedAt)}
                    </p>
                  </div>
                  <button
                    aria-label={`Delete saved phrase ${phrase.sourceText}`}
                    className="phrase__delete"
                    onClick={() => handleDelete(phrase.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="phrases__actions">
            <button className="phrases__quiet" onClick={handleExport} type="button">
              Export
            </button>
            {confirmingClear ? (
              <>
                <button className="phrases__danger" onClick={handleClearAll} type="button">
                  Delete all
                </button>
                <button
                  className="phrases__quiet"
                  onClick={() => setConfirmingClear(false)}
                  type="button"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="phrases__quiet"
                onClick={() => setConfirmingClear(true)}
                type="button"
              >
                Delete all
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
