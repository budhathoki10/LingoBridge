"use client";

import type { ProcessingPreference, SyncedPreferences } from "@lingobridge/contracts/account";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useDashboardApi, useToast } from "@/components/providers";
import { formatDateTime, languageName } from "@/lib/format";
import type { LanguageOption } from "@/server/languages";
import { PREFERENCES_COPY as COPY } from "./copy";

const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

export function PreferencesForm({
  initial,
  languages,
}: {
  initial: SyncedPreferences;
  languages: LanguageOption[] | null;
}) {
  const api = useDashboardApi();
  const toast = useToast();
  const router = useRouter();
  const ids = { language: useId(), languageHelp: useId(), processing: useId(), sync: useId() };

  const [saved, setSaved] = useState(initial);
  const [language, setLanguage] = useState(initial.preferredTargetLanguage ?? "");
  const [processing, setProcessing] = useState<ProcessingPreference>(
    initial.processingPreference ?? "online",
  );
  const [syncEnabled, setSyncEnabled] = useState(initial.phraseSyncEnabled);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty =
    (language || null) !== saved.preferredTargetLanguage ||
    processing !== (saved.processingPreference ?? "online") ||
    syncEnabled !== saved.phraseSyncEnabled;

  function adopt(preferences: SyncedPreferences) {
    setSaved(preferences);
    setLanguage(preferences.preferredTargetLanguage ?? "");
    setProcessing(preferences.processingPreference ?? "online");
    setSyncEnabled(preferences.phraseSyncEnabled);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const code = language.trim();
    if (code && !LANGUAGE_CODE.test(code)) {
      setLanguageError("Use a language code such as ne, en, or pt-BR.");
      return;
    }
    setLanguageError(null);
    setStatus("saving");
    setError(null);
    const result = await api<{ preferences: SyncedPreferences }>("/api/dashboard/preferences", {
      baseRevision: saved.revision,
      phraseSyncEnabled: syncEnabled,
      preferredTargetLanguage: code || null,
      processingPreference: processing,
    });
    if (result.ok) {
      adopt(result.data.preferences);
      setStatus("idle");
      toast({
        message: "Preferences saved. Connected extensions pick them up on their next sync.",
        tone: "neutral",
      });
      router.refresh();
      return;
    }
    if (result.status === 409 && result.data?.preferences) {
      adopt(result.data.preferences as SyncedPreferences);
      setStatus("error");
      setError(
        "These preferences changed on another device. The latest values are shown; review and save again.",
      );
      return;
    }
    setStatus("error");
    setError(result.message);
  }

  return (
    <form className="card" noValidate onSubmit={submit}>
      <div className="setting">
        <div className="setting__text">
          <h2>
            <label htmlFor={ids.language}>{COPY.language.title}</label>
          </h2>
          <p id={ids.languageHelp}>{COPY.language.help}</p>
        </div>
        <div className="setting__control field">
          {languages && languages.length > 0 ? (
            <select
              aria-describedby={ids.languageHelp}
              className="select"
              id={ids.language}
              onChange={(event) => setLanguage(event.target.value)}
              value={language}
            >
              <option value="">Use each device’s choice</option>
              {language && !languages.some((option) => option.code === language) ? (
                <option value={language}>{languageName(language)}</option>
              ) : null}
              {languages.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                  {option.nativeName && option.nativeName !== option.name
                    ? ` — ${option.nativeName}`
                    : ""}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                aria-describedby={`${ids.languageHelp} ${ids.language}-fallback`}
                aria-invalid={Boolean(languageError)}
                autoComplete="off"
                className="input"
                id={ids.language}
                inputMode="text"
                onBlur={() =>
                  setLanguageError(
                    language.trim() && !LANGUAGE_CODE.test(language.trim())
                      ? "Use a language code such as ne, en, or pt-BR."
                      : null,
                  )
                }
                onChange={(event) => setLanguage(event.target.value)}
                placeholder="Language code, e.g. ne"
                value={language}
              />
              <span className="field__hint" id={`${ids.language}-fallback`}>
                The language list is unavailable right now, so enter a code instead.
              </span>
            </>
          )}
          {languageError ? (
            <span className="field__error" role="alert">
              {languageError}
            </span>
          ) : null}
        </div>
      </div>

      <fieldset aria-labelledby={ids.processing} className="setting">
        <div className="setting__text">
          <h2 id={ids.processing}>{COPY.processing.title}</h2>
          <p>{COPY.processing.help}</p>
        </div>
        <div className="setting__control radio-group">
          <label className="radio">
            <input
              checked={processing === "online"}
              name="processing"
              onChange={() => setProcessing("online")}
              type="radio"
              value="online"
            />
            <span>
              {COPY.processing.online.label}
              <small>{COPY.processing.online.detail}</small>
            </span>
          </label>
          <label className="radio">
            <input
              checked={processing === "on-device"}
              disabled={processing !== "on-device"}
              name="processing"
              onChange={() => setProcessing("on-device")}
              type="radio"
              value="on-device"
            />
            <span>
              {COPY.processing.onDevice.label}
              <small>{COPY.processing.onDevice.detail}</small>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="setting">
        <div className="setting__text">
          <h2 id={ids.sync}>{COPY.sync.title}</h2>
          <p>{COPY.sync.help}</p>
        </div>
        <div className="setting__control setting__control--end">
          <button
            aria-checked={syncEnabled}
            aria-labelledby={ids.sync}
            className="switch"
            onClick={() => setSyncEnabled((value) => !value)}
            role="switch"
            type="button"
          />
        </div>
      </div>

      <div className="card__footer">
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : saved.updatedAt ? (
          <p className="muted">Last changed {formatDateTime(saved.updatedAt)}</p>
        ) : null}
        <span className="button-row">
          <button
            className="button"
            disabled={!dirty || status === "saving"}
            onClick={() => {
              adopt(saved);
              setError(null);
              setLanguageError(null);
              setStatus("idle");
            }}
            type="button"
          >
            Discard
          </button>
          <button className="button button--primary" disabled={status === "saving"} type="submit">
            {status === "saving" ? <span aria-hidden="true" className="spinner" /> : null}
            {status === "saving" ? "Saving…" : "Save preferences"}
          </button>
        </span>
      </div>
    </form>
  );
}
