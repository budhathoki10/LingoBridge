"use client";

import type { LivePhraseRecord } from "@lingobridge/contracts/account";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckIcon, MinusIcon, SearchIcon, TrashIcon } from "@/components/icons";
import { Pagination } from "@/components/pagination";
import { useDashboardApi, useToast } from "@/components/providers";
import { formatDate, languageName, plural, providerLabel } from "@/lib/format";

interface Filters {
  from: string;
  q: string;
  sort: "newest" | "oldest";
  source: string;
  target: string;
  to: string;
}

interface PhrasesViewProps {
  filters: Filters;
  page: number;
  pageSize: number;
  phrases: LivePhraseRecord[];
  sourceLanguages: string[];
  targetLanguages: string[];
  total: number;
  totalSaved: number;
}

const MAX_NOTE = 500;

function NoteEditor({
  onDone,
  phrase,
}: {
  onDone: (updated: LivePhraseRecord | null) => void;
  phrase: LivePhraseRecord;
}) {
  const api = useDashboardApi();
  const toast = useToast();
  const [value, setValue] = useState(phrase.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Focus once when the editor opens, with the caret after any existing note.
  const initialLength = useRef((phrase.note ?? "").length);
  useEffect(() => {
    textarea.current?.focus();
    textarea.current?.setSelectionRange(initialLength.current, initialLength.current);
  }, []);

  async function save() {
    if (value.trim() === (phrase.note ?? "")) {
      onDone(null);
      return;
    }
    if (Array.from(value).length > MAX_NOTE) {
      setError(`Keep the note under ${MAX_NOTE} characters.`);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await api<{ phrase: LivePhraseRecord }>("/api/dashboard/phrases/note", {
      baseRevision: phrase.revision,
      note: value.trim() ? value : null,
      phraseId: phrase.id,
    });
    setSaving(false);
    if (result.ok) {
      toast({ message: "Note saved", tone: "neutral" });
      onDone(result.data.phrase);
      return;
    }
    if (result.status === 409 && result.data?.phrase) {
      toast({
        message: "This phrase changed elsewhere. Showing the latest version.",
        tone: "danger",
      });
      onDone(result.data.phrase as LivePhraseRecord);
      return;
    }
    setError(result.message);
  }

  const remaining = MAX_NOTE - Array.from(value).length;
  return (
    <div className="note-editor">
      <label className="visually-hidden" htmlFor={`note-${phrase.id}`}>
        Note for {phrase.sourceText}
      </label>
      <textarea
        aria-describedby={`note-help-${phrase.id}`}
        aria-invalid={remaining < 0}
        className="textarea"
        disabled={saving}
        id={`note-${phrase.id}`}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDone(null);
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
        }}
        placeholder="Add context, pronunciation, or where you’ll use it"
        ref={textarea}
        rows={2}
        value={value}
      />
      <div className="note-editor__footer">
        <span id={`note-help-${phrase.id}`}>
          {error ? (
            <span className="field__error" role="alert">
              {error}
            </span>
          ) : (
            <>
              <span className="kbd">Enter</span> save · <span className="kbd">Esc</span> cancel ·{" "}
              <span className={remaining < 0 ? "field__error" : "tabular"}>{remaining}</span> left
            </>
          )}
        </span>
        <span className="button-row">
          <button
            className="button button--small"
            disabled={saving}
            onClick={() => onDone(null)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--primary button--small"
            disabled={saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? <span aria-hidden="true" className="spinner" /> : null}
            Save note
          </button>
        </span>
      </div>
    </div>
  );
}

export function PhrasesView(props: PhrasesViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const api = useDashboardApi();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState(props.filters.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Map<string, LivePhraseRecord>>(new Map());
  const searchInput = useRef<HTMLInputElement>(null);
  const lastClicked = useRef<number | null>(null);

  // Fresh server data replaces local overrides and selection (adjusted during render, not in an effect).
  const [renderedPhrases, setRenderedPhrases] = useState(props.phrases);
  if (renderedPhrases !== props.phrases) {
    setRenderedPhrases(props.phrases);
    setOverrides(new Map());
    setSelected(new Set());
    setHidden(new Set());
  }

  useEffect(() => setQuery(props.filters.q), [props.filters.q]);

  const updateUrl = useCallback(
    (changes: Partial<Record<keyof Filters | "page", string>>) => {
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

  // Debounced, URL-backed search.
  const currentQuery = props.filters.q;
  useEffect(() => {
    if (query === currentQuery) return;
    const timer = setTimeout(() => updateUrl({ q: query.trim() }), 250);
    return () => clearTimeout(timer);
  }, [query, currentQuery, updateUrl]);

  // "/" focuses search; Escape clears the selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing =
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInput.current?.focus();
      } else if (event.key === "Escape" && !typing && selected.size > 0) {
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  const visible = useMemo(
    () =>
      props.phrases
        .filter((phrase) => !hidden.has(phrase.id))
        .map((phrase) => overrides.get(phrase.id) ?? phrase),
    [props.phrases, hidden, overrides],
  );

  const filtersActive = Boolean(
    props.filters.q ||
      props.filters.source ||
      props.filters.target ||
      props.filters.from ||
      props.filters.to,
  );

  function toggle(index: number, shiftKey: boolean) {
    const phrase = visible[index];
    if (!phrase) return;
    setSelected((current) => {
      const next = new Set(current);
      if (shiftKey && lastClicked.current !== null) {
        const [start, end] = [lastClicked.current, index].sort((a, b) => a - b);
        const shouldSelect = !current.has(phrase.id);
        for (const entry of visible.slice(start, (end ?? index) + 1)) {
          if (shouldSelect) next.add(entry.id);
          else next.delete(entry.id);
        }
      } else if (next.has(phrase.id)) {
        next.delete(phrase.id);
      } else {
        next.add(phrase.id);
      }
      return next;
    });
    lastClicked.current = index;
  }

  const allSelected = visible.length > 0 && visible.every((phrase) => selected.has(phrase.id));
  const someSelected = selected.size > 0 && !allSelected;

  /**
   * Deletion is optimistic and undoable: rows disappear at once, and the request is sent when the
   * undo window closes, the notification is dismissed, or the tab is hidden.
   */
  function deleteWithUndo(ids: string[]) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setHidden((current) => new Set([...current, ...ids]));
    setSelected((current) => new Set([...current].filter((id) => !idSet.has(id))));
    let undone = false;
    toast({
      action: {
        label: "Undo",
        onAction: () => {
          undone = true;
          setHidden((current) => new Set([...current].filter((id) => !idSet.has(id))));
        },
      },
      durationMs: 6_000,
      message: `Deleted ${plural(ids.length, "phrase")}`,
      onExpire: () => {
        if (undone) return;
        void api("/api/dashboard/phrases/delete", { phraseIds: ids }, { keepalive: true }).then(
          (result) => {
            if (!result.ok) {
              setHidden((current) => new Set([...current].filter((id) => !idSet.has(id))));
              toast({ message: `Couldn’t delete: ${result.message}`, tone: "danger" });
              return;
            }
            router.refresh();
          },
        );
      },
      tone: "neutral",
    });
  }

  if (props.totalSaved === 0) {
    return (
      <div className="empty">
        <h2>No saved phrases yet</h2>
        <p>
          In the extension, translate a selection and choose <strong>Save phrase</strong>. With the
          extension connected to this account, saved phrases sync here and stay searchable.
        </p>
      </div>
    );
  }

  const firstItem = props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1;
  const lastItem = Math.min(props.total, props.page * props.pageSize);
  const pageCount = Math.max(1, Math.ceil(props.total / props.pageSize));

  return (
    <>
      <section aria-label="Search and filter phrases" className="toolbar">
        <div className="toolbar__row">
          <div className="toolbar__search">
            <SearchIcon className="toolbar__search-icon" size={16} />
            <label className="visually-hidden" htmlFor="phrase-search">
              Search source and translated text
            </label>
            <input
              className="input"
              id="phrase-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search phrases"
              ref={searchInput}
              type="search"
              value={query}
            />
            <span aria-hidden="true" className="kbd">
              /
            </span>
          </div>
          <div className="toolbar__filters">
            <label className="filter">
              <span className="filter__label">Source</span>
              <select
                className="select"
                onChange={(event) => updateUrl({ source: event.target.value })}
                value={props.filters.source}
              >
                <option value="">All languages</option>
                {props.sourceLanguages.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter">
              <span className="filter__label">Target</span>
              <select
                className="select"
                onChange={(event) => updateUrl({ target: event.target.value })}
                value={props.filters.target}
              >
                <option value="">All languages</option>
                {props.targetLanguages.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter">
              <span className="filter__label">Saved after</span>
              <input
                className="input"
                max={props.filters.to || undefined}
                onChange={(event) => updateUrl({ from: event.target.value })}
                type="date"
                value={props.filters.from}
              />
            </label>
            <label className="filter">
              <span className="filter__label">Saved before</span>
              <input
                className="input"
                min={props.filters.from || undefined}
                onChange={(event) => updateUrl({ to: event.target.value })}
                type="date"
                value={props.filters.to}
              />
            </label>
          </div>
        </div>
        <div aria-live="polite" className="filter-summary">
          <span className="tabular">
            {isPending
              ? "Updating…"
              : props.total === 0
                ? "No matches"
                : `${firstItem}–${lastItem} of ${plural(props.total, "phrase")}`}
          </span>
          <span className="button-row">
            {filtersActive ? (
              <button
                className="button button--ghost button--small"
                onClick={() => {
                  setQuery("");
                  startTransition(() => router.replace(pathname, { scroll: false }));
                }}
                type="button"
              >
                Clear filters
              </button>
            ) : null}
            <label className="visually-hidden" htmlFor="sort">
              Sort
            </label>
            <select
              className="select button--small"
              id="sort"
              onChange={(event) =>
                updateUrl({ sort: event.target.value === "oldest" ? "oldest" : "" })
              }
              value={props.filters.sort}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </span>
        </div>
      </section>

      {visible.length === 0 ? (
        <div className="empty">
          <h2>{filtersActive ? "No phrases match these filters" : "Nothing on this page"}</h2>
          <p>
            {filtersActive
              ? "Try a different search or language, or clear the filters to see every saved phrase."
              : "The phrases on this page were deleted. Go back to the first page."}
          </p>
          <button
            className="button"
            onClick={() => {
              setQuery("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
            type="button"
          >
            {filtersActive ? "Clear filters" : "Go to first page"}
          </button>
        </div>
      ) : (
        <div aria-busy={isPending} className="data-list">
          <div className="data-list__head">
            <span>
              <input
                aria-checked={someSelected ? "mixed" : allSelected}
                aria-label={allSelected ? "Clear selection" : "Select all on this page"}
                checked={allSelected}
                className="checkbox"
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(visible.map((phrase) => phrase.id)))
                }
                ref={(element) => {
                  if (element) element.indeterminate = someSelected;
                }}
                type="checkbox"
              />
            </span>
            <span>Phrase</span>
            <span>Languages</span>
            <span>Provider</span>
            <span>Saved</span>
            <span className="visually-hidden">Actions</span>
          </div>
          <ul aria-label="Saved phrases" className="data-list__rows">
            {visible.map((phrase, index) => {
              const isSelected = selected.has(phrase.id);
              return (
                <li className="row" data-selected={isSelected} key={phrase.id}>
                  <span className="row__select">
                    <input
                      aria-label={`Select “${phrase.sourceText.slice(0, 60)}”`}
                      checked={isSelected}
                      className="checkbox"
                      onChange={() => undefined}
                      onClick={(event) => toggle(index, event.shiftKey)}
                      type="checkbox"
                    />
                  </span>
                  <div className="row__phrase">
                    <span className="row__source" dir="auto" lang={phrase.sourceLanguage}>
                      {phrase.sourceText}
                    </span>
                    <span className="row__translation" dir="auto" lang={phrase.targetLanguage}>
                      {phrase.translatedText}
                    </span>
                    <span className="row__meta row__meta--compact">
                      <span className="lang-pair">
                        {phrase.sourceLanguage} → {phrase.targetLanguage}
                      </span>
                      <span>{providerLabel(phrase.provider)}</span>
                      <time dateTime={phrase.savedAt}>{formatDate(phrase.savedAt)}</time>
                    </span>
                    {editing === phrase.id ? (
                      <NoteEditor
                        onDone={(updated) => {
                          setEditing(null);
                          if (updated)
                            setOverrides((current) => new Map(current).set(updated.id, updated));
                        }}
                        phrase={phrase}
                      />
                    ) : (
                      <button
                        className={`note-button${phrase.note ? " note-button--filled" : " row__reveal"}`}
                        onClick={() => setEditing(phrase.id)}
                        type="button"
                      >
                        {phrase.note ?? "Add note"}
                      </button>
                    )}
                  </div>
                  <span className="row__cell">
                    <span
                      className="lang-pair"
                      title={`${languageName(phrase.sourceLanguage)} to ${languageName(phrase.targetLanguage)}`}
                    >
                      {phrase.sourceLanguage} → {phrase.targetLanguage}
                    </span>
                  </span>
                  <span className="row__cell">{providerLabel(phrase.provider)}</span>
                  <span className="row__cell tabular">
                    <time dateTime={phrase.savedAt}>{formatDate(phrase.savedAt)}</time>
                  </span>
                  <span className="row__actions">
                    <button
                      aria-label={`Delete “${phrase.sourceText.slice(0, 60)}”`}
                      className="button button--ghost button--small button--icon row__reveal"
                      onClick={() => deleteWithUndo([phrase.id])}
                      title="Delete"
                      type="button"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Pagination
        disabled={isPending}
        onPageChange={(page) => updateUrl({ page: page > 1 ? String(page) : "" })}
        page={props.page}
        pageCount={pageCount}
      />

      {selected.size > 0 ? (
        <section aria-label="Selection actions" className="selection-bar">
          <span className="tabular">
            <CheckIcon size={14} /> {plural(selected.size, "phrase")} selected
          </span>
          <span className="button-row">
            <button
              className="button button--ghost button--small"
              onClick={() => setSelected(new Set())}
              type="button"
            >
              <MinusIcon size={14} />
              Clear
            </button>
            <button
              className="button button--danger-quiet button--small"
              onClick={() => deleteWithUndo([...selected])}
              type="button"
            >
              <TrashIcon size={14} />
              Delete {plural(selected.size, "phrase")}
            </button>
          </span>
        </section>
      ) : null}
    </>
  );
}
