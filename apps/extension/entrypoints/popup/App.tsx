import {
  MAX_TRANSLATION_CODE_POINTS,
  MAX_TRANSLATION_UTF8_BYTES,
  type TranslationRequest,
  type TranslationResult,
  translationTextSchema,
} from "@lingobridge/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_LANGUAGE_CODE,
  getPreviewDirectionCapabilities,
  getPreviewLanguage,
  inferPreviewLanguage,
} from "../../lib/capabilities";
import { GatewayClientError, gatewayClient } from "../../lib/gateway-client";
import { LatestRequestRunner } from "../../lib/latest-request";
import {
  addRecentLanguage,
  DEFAULT_POPUP_PREFERENCES,
  loadPopupPreferences,
  savePopupPreferences,
} from "../../lib/popup-preferences";
import { CloseIcon, SwapIcon } from "./Icons";
import { LanguagePicker } from "./LanguagePicker";

type TranslationView =
  | { kind: "cancelled" }
  | { kind: "error"; message: string; retryable: boolean }
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: TranslationResult };

type GatewayState = "checking" | "ready" | "unavailable";

const utf8Encoder = new TextEncoder();

function countCodePoints(text: string): number {
  return Array.from(text).length;
}

function getSafeSwapTarget(sourceLanguage: string, targetLanguage: string, text: string): string {
  const inferredSource =
    sourceLanguage === AUTO_LANGUAGE_CODE ? inferPreviewLanguage(text) : sourceLanguage;

  if (inferredSource !== targetLanguage) return inferredSource;
  return targetLanguage === "en" ? "ne" : "en";
}

export function App() {
  const version = chrome.runtime.getManifest().version;
  const requestRunner = useRef(new LatestRequestRunner());
  const [sourceLanguage, setSourceLanguage] = useState(AUTO_LANGUAGE_CODE);
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_POPUP_PREFERENCES.targetLanguage);
  const [text, setText] = useState("");
  const [view, setView] = useState<TranslationView>({ kind: "idle" });
  const [lastRequest, setLastRequest] = useState<TranslationRequest | null>(null);
  const [gatewayState, setGatewayState] = useState<GatewayState>("checking");
  const [favouriteCodes, setFavouriteCodes] = useState(
    DEFAULT_POPUP_PREFERENCES.favouriteLanguageCodes,
  );
  const [recentCodes, setRecentCodes] = useState(DEFAULT_POPUP_PREFERENCES.recentLanguageCodes);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const target = getPreviewLanguage(targetLanguage);
  const capabilities = getPreviewDirectionCapabilities(sourceLanguage, targetLanguage);
  const codePointCount = countCodePoints(text);
  const utf8ByteCount = utf8Encoder.encode(text).byteLength;
  const textIsOverLimit =
    codePointCount > MAX_TRANSLATION_CODE_POINTS || utf8ByteCount > MAX_TRANSLATION_UTF8_BYTES;

  useEffect(() => {
    let active = true;

    void loadPopupPreferences()
      .then((preferences) => {
        if (!active) return;
        setFavouriteCodes(preferences.favouriteLanguageCodes);
        setRecentCodes(preferences.recentLanguageCodes);
        setTargetLanguage(preferences.targetLanguage);
        setPreferencesReady(true);
      })
      .catch(() => {
        if (active) setPreferencesReady(true);
      });

    return () => {
      active = false;
      requestRunner.current.cancel();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void gatewayClient
      .inspect(controller.signal)
      .then((snapshot) => {
        if (snapshot.version.translationMode === "fake") setGatewayState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setGatewayState("unavailable");
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;

    void savePopupPreferences({
      favouriteLanguageCodes: favouriteCodes,
      recentLanguageCodes: recentCodes,
      targetLanguage,
    }).catch(() => undefined);
  }, [favouriteCodes, preferencesReady, recentCodes, targetLanguage]);

  const openSourcePicker = useCallback((open: boolean) => {
    setSourcePickerOpen(open);
    if (open) setTargetPickerOpen(false);
  }, []);

  const openTargetPicker = useCallback((open: boolean) => {
    setTargetPickerOpen(open);
    if (open) setSourcePickerOpen(false);
  }, []);

  function resetResult() {
    requestRunner.current.cancel();
    setView({ kind: "idle" });
    setLastRequest(null);
  }

  function rememberLanguage(languageCode: string) {
    if (languageCode !== AUTO_LANGUAGE_CODE) {
      setRecentCodes((codes) => addRecentLanguage(codes, languageCode));
    }
  }

  async function runTranslation(request: TranslationRequest) {
    setLastRequest(request);
    setView({ kind: "loading" });

    const outcome = await requestRunner.current.run((signal) =>
      gatewayClient.translate(request, signal),
    );

    if (outcome.status === "stale") return;

    if (outcome.status === "error") {
      const message =
        outcome.error instanceof GatewayClientError
          ? outcome.error.message
          : "The gateway stopped unexpectedly. Your source text is still here.";
      setView({
        kind: "error",
        message,
        retryable: outcome.error instanceof GatewayClientError && outcome.error.retryable,
      });
      return;
    }

    setView({ kind: "success", result: outcome.value });
    if (outcome.value.detectedSourceLanguage) {
      rememberLanguage(outcome.value.detectedSourceLanguage);
    }
    rememberLanguage(outcome.value.targetLanguage);
  }

  function handleTranslate() {
    const parsedText = translationTextSchema.safeParse(text);

    if (!parsedText.success) {
      setView({
        kind: "error",
        message: parsedText.error.issues[0]?.message ?? "Check the source text and try again.",
        retryable: false,
      });
      return;
    }

    if (!target || !capabilities.standardTranslation) {
      setView({
        kind: "error",
        message: "Choose two different supported languages before translating.",
        retryable: false,
      });
      return;
    }

    void runTranslation({
      consent: {
        acceptedAt: new Date().toISOString(),
        google: true,
        nvidiaBackup: false,
        version: "phase-3.1-fake-gateway",
      },
      operation: "translate",
      requestId: crypto.randomUUID(),
      sourceLanguage,
      targetLanguage,
      text,
    });
  }

  function handleRetry() {
    if (!lastRequest) {
      handleTranslate();
      return;
    }

    void runTranslation({
      ...lastRequest,
      requestId: crypto.randomUUID(),
    });
  }

  function handleCancel() {
    requestRunner.current.cancel();
    setView({ kind: "cancelled" });
  }

  function handleClear() {
    requestRunner.current.cancel();
    setText("");
    setLastRequest(null);
    setView({ kind: "idle" });
  }

  function handleTextChange(nextText: string) {
    if (view.kind !== "idle") resetResult();
    setText(nextText);
  }

  function handleSourceSelect(languageCode: string) {
    resetResult();
    setSourceLanguage(languageCode);
    rememberLanguage(languageCode);
  }

  function handleTargetSelect(languageCode: string) {
    resetResult();
    setTargetLanguage(languageCode);
    rememberLanguage(languageCode);
  }

  function handleSwap() {
    const nextTarget =
      view.kind === "success"
        ? (view.result.detectedSourceLanguage ??
          getSafeSwapTarget(sourceLanguage, targetLanguage, text))
        : getSafeSwapTarget(sourceLanguage, targetLanguage, text);
    const nextText = view.kind === "success" ? view.result.translatedText : text;

    requestRunner.current.cancel();
    setSourceLanguage(targetLanguage);
    setTargetLanguage(
      nextTarget === targetLanguage
        ? getSafeSwapTarget(AUTO_LANGUAGE_CODE, targetLanguage, text)
        : nextTarget,
    );
    setText(nextText);
    setLastRequest(null);
    setView({ kind: "idle" });
    rememberLanguage(targetLanguage);
    rememberLanguage(nextTarget);
  }

  function toggleFavourite(languageCode: string) {
    setFavouriteCodes((codes) =>
      codes.includes(languageCode)
        ? codes.filter((code) => code !== languageCode)
        : [languageCode, ...codes],
    );
  }

  const detectedLanguageName = useMemo(() => {
    if (view.kind !== "success") return null;
    if (!view.result.detectedSourceLanguage) return "Unknown";
    return getPreviewLanguage(view.result.detectedSourceLanguage)?.name ?? "Unknown";
  }, [view]);

  return (
    <main className="popup-shell">
      <header className="app-header">
        <div className="brand">
          <img src="/icon/32.png" alt="" width="30" height="30" />
          <div>
            <strong>LingoBridge</strong>
            <span>Text translator</span>
          </div>
        </div>
        <span className="preview-badge">Preview</span>
      </header>

      <section aria-labelledby="translator-title" className="translator">
        <div className="section-heading">
          <div>
            <h1 id="translator-title">Translate text</h1>
          </div>
          <span className="local-note">
            <span
              aria-hidden="true"
              className={`local-note__dot local-note__dot--${gatewayState}`}
            />
            {gatewayState === "ready"
              ? "Fake gateway ready"
              : gatewayState === "checking"
                ? "Checking gateway"
                : "Gateway offline"}
          </span>
        </div>

        <div className="language-row">
          <LanguagePicker
            disabledCode={targetLanguage}
            favouriteCodes={favouriteCodes}
            includeAuto
            isOpen={sourcePickerOpen}
            label="From"
            onOpenChange={openSourcePicker}
            onSelect={handleSourceSelect}
            onToggleFavourite={toggleFavourite}
            recentCodes={recentCodes}
            side="source"
            value={sourceLanguage}
          />

          <button
            aria-label="Swap source and target languages"
            className="swap-button"
            onClick={handleSwap}
            type="button"
          >
            <SwapIcon />
          </button>

          <LanguagePicker
            disabledCode={sourceLanguage === AUTO_LANGUAGE_CODE ? undefined : sourceLanguage}
            favouriteCodes={favouriteCodes}
            isOpen={targetPickerOpen}
            label="To"
            onOpenChange={openTargetPicker}
            onSelect={handleTargetSelect}
            onToggleFavourite={toggleFavourite}
            recentCodes={recentCodes}
            side="target"
            value={targetLanguage}
          />
        </div>

        <div className="source-field">
          <div className="source-field__heading">
            <label htmlFor="source-text">Text to translate</label>
            {text ? (
              <button className="clear-button" onClick={handleClear} type="button">
                <CloseIcon />
                Clear
              </button>
            ) : null}
          </div>
          <textarea
            aria-describedby="source-help source-count"
            aria-invalid={textIsOverLimit}
            dir="auto"
            id="source-text"
            onChange={(event) => handleTextChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                handleTranslate();
              }
            }}
            placeholder="Type or paste a sentence"
            rows={5}
            value={text}
          />
          <div className="source-field__meta">
            <span id="source-help">
              <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
            </span>
            <span className={textIsOverLimit ? "count count--error" : "count"} id="source-count">
              {codePointCount.toLocaleString()} / {MAX_TRANSLATION_CODE_POINTS.toLocaleString()}
            </span>
          </div>
        </div>

        <button
          className={
            view.kind === "loading" ? "translate-button translate-button--stop" : "translate-button"
          }
          disabled={view.kind !== "loading" && text.trim().length === 0}
          onClick={view.kind === "loading" ? handleCancel : handleTranslate}
          type="button"
        >
          {view.kind === "loading" ? (
            <>
              <CloseIcon /> Stop translation
            </>
          ) : (
            <>Translate</>
          )}
        </button>

        <section
          aria-busy={view.kind === "loading"}
          aria-live="polite"
          className={`result-panel result-panel--${view.kind}`}
        >
          {view.kind === "idle" ? (
            <div className="result-empty">
              <div>
                <h2>Your translation appears here</h2>
                <p>Try “Hello, how are you?” with Nepali.</p>
              </div>
            </div>
          ) : null}

          {view.kind === "loading" ? (
            <div className="result-loading">
              <div aria-hidden="true" className="spinner" />
              <div>
                <h2>Translating…</h2>
                <p>Preparing your preview translation.</p>
              </div>
              <div aria-hidden="true" className="loading-lines">
                <span />
                <span />
              </div>
            </div>
          ) : null}

          {view.kind === "success" ? (
            <div className="result-success">
              <div className="result-heading">
                <h2>Translation</h2>
                <span>Fake adapter</span>
              </div>
              <p
                className="translated-text"
                dir={getPreviewLanguage(view.result.targetLanguage)?.textDirection ?? "ltr"}
                lang={view.result.targetLanguage}
              >
                {view.result.translatedText}
              </p>
              <p className="result-meta">
                Detected {detectedLanguageName} · Simulated {view.result.provider} route · no
                external provider call
              </p>
            </div>
          ) : null}

          {view.kind === "error" ? (
            <div className="result-message" role="alert">
              <div>
                <h2>Translation unavailable</h2>
                <p>{view.message}</p>
              </div>
              {view.retryable ? (
                <button className="secondary-button" onClick={handleRetry} type="button">
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {view.kind === "cancelled" ? (
            <div className="result-message">
              <div>
                <h2>Translation stopped</h2>
                <p>Your source text is still here and was not saved.</p>
              </div>
              <button className="secondary-button" onClick={handleRetry} type="button">
                Retry
              </button>
            </div>
          ) : null}
        </section>
      </section>

      <footer>
        <details className="preview-details">
          <summary>About this preview</summary>
          <p>
            Phase 3.1 uses a local gateway and simulated translations. No text is sent to Google or
            NVIDIA. Start the backend with <code>pnpm dev:gateway</code>.
          </p>
          <p>
            {capabilities.speech
              ? "Speech is supported later."
              : `Speech unavailable for ${target?.name ?? "this language"}.`}
          </p>
        </details>
        <span className="app-version">v{version}</span>
      </footer>
    </main>
  );
}
