"use client";

import type { SavedWordRecord } from "@lingobridge/contracts/account";
import { useMemo, useState } from "react";
import { useDashboardApi, useToast } from "@/components/providers";

export function VocabularyView({ words }: { words: SavedWordRecord[] }) {
  const api = useDashboardApi();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return words.filter(
      (word) =>
        !hidden.has(word.id) &&
        (!needle ||
          word.word.toLocaleLowerCase().includes(needle) ||
          word.translation.toLocaleLowerCase().includes(needle)),
    );
  }, [hidden, query, words]);

  async function remove(id: string) {
    const result = await api<{ deleted: number }>("/api/dashboard/vocabulary/delete", {
      ids: [id],
    });
    if (result.ok) {
      setHidden((current) => new Set(current).add(id));
      toast({ message: "Saved word deleted", tone: "neutral" });
    } else {
      toast({ message: result.message, tone: "danger" });
    }
  }

  return (
    <>
      <section aria-label="Search vocabulary" className="toolbar">
        <label className="field">
          <span className="field__label">Search</span>
          <input
            className="input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved words"
            type="search"
            value={query}
          />
        </label>
      </section>
      {visible.length === 0 ? (
        <section className="empty-state">
          <h2>No saved words yet</h2>
          <p>Choose a word in a translated selection, understand it, then select Save word.</p>
        </section>
      ) : (
        <ul aria-label="Saved vocabulary" className="data-list__rows">
          {visible.map((word) => (
            <li className="data-list__row" key={word.id}>
              <div>
                <strong>{word.word}</strong>
                <p lang={word.targetLanguage}>{word.translation}</p>
                <p>{word.meaning}</p>
                <small>{word.partOfSpeech}</small>
              </div>
              <button
                className="button button--quiet"
                onClick={() => void remove(word.id)}
                type="button"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
