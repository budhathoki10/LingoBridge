"use client";

import type { SavedWordRecord } from "@lingobridge/contracts/account";
import { useMemo, useState } from "react";
import { SearchIcon, TrashIcon } from "@/components/icons";
import { useDashboardApi, useToast } from "@/components/providers";
import { formatDate } from "@/lib/format";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function VocabularyView({ words }: { words: SavedWordRecord[] }) {
  const api = useDashboardApi();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const remaining = useMemo(() => words.filter((word) => !hidden.has(word.id)), [hidden, words]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return remaining;
    return remaining.filter(
      (word) =>
        word.word.toLocaleLowerCase().includes(needle) ||
        word.translation.toLocaleLowerCase().includes(needle),
    );
  }, [query, remaining]);

  async function remove(word: SavedWordRecord) {
    setHidden((current) => new Set(current).add(word.id));
    const result = await api<{ deleted: number }>("/api/dashboard/vocabulary/delete", {
      ids: [word.id],
    });
    if (result.ok) {
      toast({ message: `Deleted “${word.word}”`, tone: "neutral" });
      return;
    }
    setHidden((current) => {
      const next = new Set(current);
      next.delete(word.id);
      return next;
    });
    toast({ message: result.message, tone: "danger" });
  }

  if (remaining.length === 0) {
    return (
      <section className="empty">
        <h2>No saved words yet</h2>
        <p>
          In a translation, choose an underlined word to see what it means, then select{" "}
          <strong>Save word</strong>. It appears here and in your export.
        </p>
      </section>
    );
  }

  return (
    <>
      <section aria-label="Search vocabulary" className="toolbar">
        <div className="toolbar__row">
          <div className="toolbar__search">
            <SearchIcon className="toolbar__search-icon" size={16} />
            <label className="visually-hidden" htmlFor="vocabulary-search">
              Search words and translations
            </label>
            <input
              className="input"
              id="vocabulary-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search words or translations"
              type="search"
              value={query}
            />
          </div>
        </div>
        <div aria-live="polite" className="filter-summary">
          <span className="tabular">
            {query.trim()
              ? `${plural(visible.length, "match")} of ${plural(remaining.length, "word")}`
              : plural(remaining.length, "word")}
          </span>
        </div>
      </section>

      {visible.length === 0 ? (
        <section className="empty">
          <h2>No words match “{query.trim()}”</h2>
          <p>Search looks at the saved word and its translation.</p>
          <button className="button button--small" onClick={() => setQuery("")} type="button">
            Clear search
          </button>
        </section>
      ) : (
        <div className="data-list">
          <ul aria-label="Saved vocabulary" className="data-list__rows">
            {visible.map((word) => (
              <li className="row row--vocab" key={word.id}>
                <div className="vocab">
                  <div className="vocab__line">
                    <strong className="vocab__word" dir="auto" lang={word.sourceLanguage}>
                      {word.word}
                    </strong>
                    <span className="vocab__pos">{word.partOfSpeech}</span>
                    {word.pronunciation ? (
                      <span className="vocab__pronunciation" lang={word.targetLanguage}>
                        {word.pronunciation}
                      </span>
                    ) : null}
                  </div>
                  <span className="row__translation" dir="auto" lang={word.targetLanguage}>
                    {word.translation}
                  </span>
                  <span className="vocab__meaning" dir="auto" lang={word.targetLanguage}>
                    {word.meaning}
                  </span>
                  <span className="row__meta">
                    <span className="lang-pair">
                      {word.sourceLanguage} → {word.targetLanguage}
                    </span>
                    <time className="tabular" dateTime={word.savedAt}>
                      {formatDate(word.savedAt)}
                    </time>
                  </span>
                </div>
                <span className="row__actions">
                  <button
                    aria-label={`Delete “${word.word}”`}
                    className="button button--ghost button--small button--icon row__reveal"
                    onClick={() => void remove(word)}
                    title="Delete"
                    type="button"
                  >
                    <TrashIcon size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
