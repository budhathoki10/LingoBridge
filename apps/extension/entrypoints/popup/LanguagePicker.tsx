import { useEffect, useId, useRef, useState } from "react";
import {
  AUTO_LANGUAGE_CODE,
  buildLanguageSections,
  getPreviewLanguage,
  type PreviewLanguage,
} from "../../lib/capabilities";
import { ArrowDownIcon, CheckIcon, CloseIcon, SearchIcon, StarIcon } from "./Icons";

interface LanguagePickerProps {
  disabledCode?: string;
  favouriteCodes: readonly string[];
  includeAuto?: boolean;
  isOpen: boolean;
  label: string;
  languages: readonly PreviewLanguage[];
  onOpenChange: (open: boolean) => void;
  onSelect: (languageCode: string) => void;
  onToggleFavourite: (languageCode: string) => void;
  recentCodes: readonly string[];
  side: "source" | "target";
  value: string;
}

export function LanguagePicker({
  disabledCode,
  favouriteCodes,
  includeAuto = false,
  isOpen,
  label,
  languages,
  onOpenChange,
  onSelect,
  onToggleFavourite,
  recentCodes,
  side,
  value,
}: LanguagePickerProps) {
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLFieldSetElement>(null);
  const dialogId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedLanguage = getPreviewLanguage(value, languages);
  const sections = buildLanguageSections(query, favouriteCodes, recentCodes, languages);
  const hasResults = sections.some((section) => section.languages.length > 0);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }

    const focusTimer = window.setTimeout(() => searchInputRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        triggerRef.current?.focus();
      }

      const menu = containerRef.current?.querySelector(".language-menu");
      if (!menu?.contains(event.target as Node)) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const choices = Array.from(
        menu.querySelectorAll<HTMLButtonElement>(
          ".language-option__choice:not(:disabled), .auto-language-option",
        ),
      );
      if (!choices.length) return;
      event.preventDefault();
      const current = choices.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        current < 0
          ? event.key === "ArrowDown"
            ? 0
            : choices.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
      choices[next]?.focus();
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, onOpenChange]);

  function chooseLanguage(languageCode: string) {
    onSelect(languageCode);
    onOpenChange(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function renderLanguageRow(language: PreviewLanguage) {
    const isDisabled = language.code === disabledCode;
    const isFavourite = favouriteCodes.includes(language.code);
    const isSelected = value === language.code;

    return (
      <div className="language-option" key={language.code}>
        <button
          aria-pressed={isSelected}
          className="language-option__choice"
          disabled={isDisabled}
          onClick={() => chooseLanguage(language.code)}
          type="button"
        >
          <span className="language-option__text">
            <span>{language.name}</span>
            <span dir={language.textDirection} lang={language.code}>
              {language.nativeName} · {language.code}
            </span>
          </span>
          {isSelected ? <CheckIcon className="language-option__check" /> : null}
          {isDisabled ? <span className="language-option__disabled">In use</span> : null}
        </button>
        <button
          aria-label={`${isFavourite ? "Remove" : "Add"} ${language.name} ${isFavourite ? "from" : "to"} favourites`}
          aria-pressed={isFavourite}
          className="favourite-button"
          onClick={() => onToggleFavourite(language.code)}
          type="button"
        >
          <StarIcon fill={isFavourite ? "currentColor" : "none"} />
        </button>
      </div>
    );
  }

  return (
    <fieldset
      className={`language-picker language-picker--${side}`}
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpenChange(false);
      }}
    >
      <legend className="field-label">{label}</legend>
      <button
        aria-controls={isOpen ? dialogId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`${label}: ${value === AUTO_LANGUAGE_CODE ? "Detect language" : selectedLanguage?.name}`}
        className="language-trigger"
        onClick={() => onOpenChange(!isOpen)}
        ref={triggerRef}
        type="button"
      >
        <span>
          <strong>
            {value === AUTO_LANGUAGE_CODE ? "Detect language" : selectedLanguage?.name}
          </strong>
          <small dir={selectedLanguage?.textDirection} lang={selectedLanguage?.code}>
            {value === AUTO_LANGUAGE_CODE ? "Automatic" : selectedLanguage?.nativeName}
          </small>
        </span>
        <ArrowDownIcon />
      </button>

      {isOpen ? (
        <div
          aria-label={`Choose ${label.toLocaleLowerCase()}`}
          className="language-menu"
          id={dialogId}
          role="dialog"
        >
          <div className="language-menu__heading">
            <strong>{label === "From" ? "Source language" : "Translate to"}</strong>
            <button
              type="button"
              className="picker-close"
              aria-label="Close language picker"
              onClick={() => {
                onOpenChange(false);
                triggerRef.current?.focus();
              }}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="language-search">
            <SearchIcon />
            <input
              aria-label={`Search ${label.toLocaleLowerCase()} languages`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, native name or code"
              ref={searchInputRef}
              type="search"
              value={query}
            />
          </div>

          <div className="language-list">
            {includeAuto && !query.trim() ? (
              <section className="language-section">
                <h3>Source option</h3>
                <button
                  aria-pressed={value === AUTO_LANGUAGE_CODE}
                  className="auto-language-option"
                  onClick={() => chooseLanguage(AUTO_LANGUAGE_CODE)}
                  type="button"
                >
                  <span>
                    <strong>Detect language</strong>
                    <small>Choose automatically from the source text</small>
                  </span>
                  {value === AUTO_LANGUAGE_CODE ? <CheckIcon /> : null}
                </button>
              </section>
            ) : null}

            {hasResults ? (
              sections.map((section) =>
                section.languages.length > 0 ? (
                  <section className="language-section" key={section.id}>
                    <h3>{section.label}</h3>
                    {section.languages.map(renderLanguageRow)}
                  </section>
                ) : null,
              )
            ) : (
              <p className="empty-search">No language matches “{query}”.</p>
            )}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
