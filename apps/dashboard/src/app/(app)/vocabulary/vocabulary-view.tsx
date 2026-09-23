"use client";

import type { SavedWordRecord } from "@lingobridge/contracts/account";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { SearchIcon, TrashIcon } from "@/components/icons";
import { Pagination } from "@/components/pagination";
import { useDashboardApi, useToast } from "@/components/providers";
import { formatDate } from "@/lib/format";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

interface VocabularyViewProps {
  page: number;
  pageSize: number;
  query: string;
  total: number;
  totalSaved: number;
  words: SavedWordRecord[];
}

export function VocabularyView(props: VocabularyViewProps) {
  const api = useDashboardApi();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(props.query);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [renderedWords, setRenderedWords] = useState(props.words);
  const searchInput = useRef<HTMLInputElement>(null);

  if (renderedWords !== props.words) {
    setRenderedWords(props.words);
    setHidden(new Set());
  }

  useEffect(() => setQuery(props.query), [props.query]);

  const updateUrl = useCallback(
    (changes: { page?: string; q?: string }) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!("page" in changes)) next.delete("page");
      startTransition(() =>
        router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }),
      );
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (query === props.query) return;
    const timer = setTimeout(() => updateUrl({ q: query.trim() }), 250);
    return () => clearTimeout(timer);
  }, [props.query, query, updateUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing =
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(
    () => props.words.filter((word) => !hidden.has(word.id)),
    [hidden, props.words],
  );

  async function remove(word: SavedWordRecord) {
    setHidden((current) => new Set(current).add(word.id));
    const result = await api<{ deleted: number }>("/api/dashboard/vocabulary/delete", {
      ids: [word.id],
    });
    if (result.ok) {
      toast({ message: `Deleted “${word.word}”`, tone: "neutral" });
      router.refresh();
      return;
    }
    setHidden((current) => {
      const next = new Set(current);
      next.delete(word.id);
      return next;
    });
    toast({ message: result.message, tone: "danger" });
  }

  if (props.totalSaved === 0) {
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

  const firstItem = props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1;
  const lastItem = Math.min(props.total, props.page * props.pageSize);
  const pageCount = Math.max(1, Math.ceil(props.total / props.pageSize));
  const searching = query !== props.query;

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
              ref={searchInput}
              type="search"
              value={query}
            />
            <span aria-hidden="true" className="kbd">
              /
            </span>
          </div>
        </div>
        <div aria-live="polite" className="filter-summary">
          <span className="tabular">
            {isPending || searching
              ? "Searching…"
              : props.total === 0
                ? "No matches"
                : `${firstItem}–${lastItem} of ${plural(props.total, "word")}`}
          </span>
          {props.query ? (
            <button
              className="button button--ghost button--small"
              onClick={() => {
                setQuery("");
                startTransition(() => router.replace(pathname, { scroll: false }));
              }}
              type="button"
            >
              Clear search
            </button>
          ) : null}
        </div>
      </section>

      {visible.length === 0 ? (
        <section className="empty">
          <h2>{props.query ? `No words match “${props.query}”` : "Nothing on this page"}</h2>
          <p>
            {props.query
              ? "Search looks at the saved word and its translation."
              : "The words on this page were deleted. Return to the first page to keep browsing."}
          </p>
          <button
            className="button button--small"
            onClick={() => {
              setQuery("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
            type="button"
          >
            {props.query ? "Clear search" : "Go to first page"}
          </button>
        </section>
      ) : (
        <div aria-busy={isPending || searching} className="data-list">
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

      <Pagination
        disabled={isPending}
        onPageChange={(page) => updateUrl({ page: page > 1 ? String(page) : "" })}
        page={props.page}
        pageCount={pageCount}
      />
    </>
  );
}
