import {
  type CapabilityCatalogue,
  MAX_TRANSLATION_CODE_POINTS,
  MAX_TRANSLATION_UTF8_BYTES,
  type OnlineConsent,
  type TranslationRequest,
  type TranslationResult,
  translationTextSchema,
} from "@lingobridge/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_LANGUAGE_CODE,
  catalogueToPreviewLanguages,
  getPreviewDirectionCapabilities,
  getPreviewLanguage,
  inferPreviewLanguage,
  PREVIEW_LANGUAGES,
} from "../../lib/capabilities";
import {
  loadCachedCapabilityCatalogue,
  markCapabilityCatalogueStale,
  saveCachedCapabilityCatalogue,
} from "../../lib/capability-cache";
import { GatewayClientError, gatewayClient } from "../../lib/gateway-client";
import { LatestRequestRunner } from "../../lib/latest-request";
import {
  acceptOnlineProviderConsent,
  loadOnlineProviderConsent,
  revokeOnlineProviderConsent,
} from "../../lib/online-consent";
import {
  addRecentLanguage,
  DEFAULT_POPUP_PREFERENCES,
  loadPopupPreferences,
  savePopupPreferences,
} from "../../lib/popup-preferences";
import { CheckIcon, CloseIcon, SparkIcon, SwapIcon } from "./Icons";
import { LanguagePicker } from "./LanguagePicker";

type TranslationView =
  | { kind: "cancelled" }
  | { kind: "error"; message: string; retryable: boolean }
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: TranslationResult };

type GatewayState = "checking" | "ready" | "unavailable";
type GatewayMode = "fake" | "live";

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
  const [gatewayMode, setGatewayMode] = useState<GatewayMode | null>(null);
  const [catalogue, setCatalogue] = useState<CapabilityCatalogue | null>(null);
  const [onlineConsent, setOnlineConsent] = useState<OnlineConsent | null>(null);
  const [consentReady, setConsentReady] = useState(false);
  const [favouriteCodes, setFavouriteCodes] = useState(
    DEFAULT_POPUP_PREFERENCES.favouriteLanguageCodes,
  );
  const [recentCodes, setRecentCodes] = useState(DEFAULT_POPUP_PREFERENCES.recentLanguageCodes);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const languages = useMemo(
    () => (catalogue ? catalogueToPreviewLanguages(catalogue) : [...PREVIEW_LANGUAGES]),
    [catalogue],
  );
  const target = getPreviewLanguage(targetLanguage, languages);
  const capabilities = getPreviewDirectionCapabilities(
    sourceLanguage,
    targetLanguage,
    catalogue,
    languages,
  );
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
    let active = true;
    void loadOnlineProviderConsent()
      .then((consent) => {
        if (active) setOnlineConsent(consent);
      })
      .finally(() => {
        if (active) setConsentReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      let cached: CapabilityCatalogue | null = null;
      try {
        cached = await loadCachedCapabilityCatalogue();
        if (!controller.signal.aborted && cached) {
          setCatalogue(markCapabilityCatalogueStale(cached));
        }
      } catch {
        cached = null;
      }

      try {
        const service = await gatewayClient.inspectService(controller.signal);
        if (controller.signal.aborted) return;
        const cacheMatchesMode =
          !cached ||
          (service.version.translationMode === "live" && cached.source !== "fake") ||
          (service.version.translationMode === "fake" && cached.source === "fake");
        if (!cacheMatchesMode) {
          cached = null;
          setCatalogue(null);
        }
        setGatewayMode(service.version.translationMode);
        setGatewayState("ready");

        try {
          const current = await gatewayClient.getCapabilities(controller.signal);
          if (controller.signal.aborted) return;
          setCatalogue(current);
          void saveCachedCapabilityCatalogue(current).catch(() => undefined);
        } catch {
          if (!controller.signal.aborted && cached) {
            setCatalogue(markCapabilityCatalogueStale(cached));
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setGatewayState("unavailable");
          if (cached) setCatalogue(markCapabilityCatalogueStale(cached));
        }
      }
    })();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!catalogue || target) return;
    const fallbackTarget =
      catalogue.languages.find((language) => language.code === "en" && language.googleTarget) ??
      catalogue.languages.find((language) => language.googleTarget) ??
      catalogue.languages.find((language) =>
        catalogue.directions.some(
          (direction) => direction.targetLanguage === language.code && direction.nvidia,
        ),
      );
    if (fallbackTarget) setTargetLanguage(fallbackTarget.code);
  }, [catalogue, target]);

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

    if (gatewayMode === "live" && !onlineConsent) {
      setView({
        kind: "error",
        message: "Allow Online translation before sending text to the selected provider.",
        retryable: false,
      });
      return;
    }

    void runTranslation({
      consent:
        gatewayMode === "live" && onlineConsent
          ? onlineConsent
          : {
              acceptedAt: new Date().toISOString(),
              google: true,
              googleBackup: true,
              nvidia: true,
              version: "phase-3.1-fake-gateway",
            },
      operation: "translate",
      requestId: crypto.randomUUID(),
      sourceLanguage,
      targetLanguage,
      text,
    });
  }

  async function handleAcceptOnlineTranslation() {
    try {
      const consent = await acceptOnlineProviderConsent();
      setOnlineConsent(consent);
      if (view.kind === "error") setView({ kind: "idle" });
    } catch {
      setView({
        kind: "error",
        message: "Online consent could not be saved. Try again before translating.",
        retryable: false,
      });
    }
  }

  async function handleRevokeOnlineTranslation() {
    requestRunner.current.cancel();
    try {
      await revokeOnlineProviderConsent();
      setOnlineConsent(null);
      setView({ kind: "idle" });
    } catch {
      setView({
        kind: "error",
        message: "Online consent could not be changed. Try again.",
        retryable: false,
      });
    }
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
    return getPreviewLanguage(view.result.detectedSourceLanguage, languages)?.name ?? "Unknown";
  }, [languages, view]);

  return (
    <main className="popup-shell">
      <header className="app-header">
        <div className="brand">
          <img src="/icon/32.png" alt="" width="30" height="30" />
          <div>
            <strong>LingoBridge</strong>
            <span>Translate without leaving the page</span>
          </div>
        </div>
        <span className="preview-badge">Phase 4</span>
      </header>

      <section aria-labelledby="translator-title" className="translator">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Translator</p>
            <h1 id="translator-title">Understand what you’re reading</h1>
          </div>
          <span className="local-note">
            <span
              aria-hidden="true"
              className={`local-note__dot local-note__dot--${gatewayState}`}
            />
            {gatewayState === "ready"
              ? gatewayMode === "live"
                ? "NVIDIA gateway ready"
                : "Fake gateway ready"
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
            languages={languages}
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
            languages={languages}
          />
        </div>

        <div aria-live="polite" className="capability-note">
          <CheckIcon />
          <span>Local gateway only</span>
          <span aria-hidden="true">·</span>
          <span>
            {capabilities.speech
              ? "Speech is supported later"
              : `Speech unavailable for ${target?.name ?? "this language"}`}
          </span>
          {catalogue?.freshness === "stale" ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Language list is cached</span>
            </>
          ) : null}
        </div>

        {gatewayMode === "live" && consentReady ? (
          <div className="online-consent">
            {onlineConsent ? (
              <>
                <p>Online translation is allowed for text you choose.</p>
                <button onClick={() => void handleRevokeOnlineTranslation()} type="button">
                  Turn off
                </button>
              </>
            ) : (
              <>
                <p>
                  Online mode sends only the text you choose to NVIDIA first. Google is used only as
                  a backup when configured. LingoBridge does not save it.
                </p>
                <div>
                  <a href="/privacy.html" target="_blank" rel="noopener">
                    Privacy details
                  </a>
                  <button onClick={() => void handleAcceptOnlineTranslation()} type="button">
                    Allow Online translation
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

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
            <span id="source-help">Ctrl + Enter to translate</span>
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
            <>
              <SparkIcon /> Translate
            </>
          )}
        </button>

        <section
          aria-busy={view.kind === "loading"}
          aria-live="polite"
          className={`result-panel result-panel--${view.kind}`}
        >
          {view.kind === "idle" ? (
            <div className="result-empty">
              <SparkIcon />
              <div>
                <h2>Your gateway translation will appear here</h2>
                <p>Start the gateway, then try “Hello, how are you?” with Nepali.</p>
              </div>
            </div>
          ) : null}

          {view.kind === "loading" ? (
            <div className="result-loading">
              <div aria-hidden="true" className="spinner" />
              <div>
                <h2>Calling the local gateway</h2>
                <p>The deterministic adapter makes no Google or NVIDIA request.</p>
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
                <span>{gatewayMode === "live" ? view.result.provider : "Fake adapter"}</span>
              </div>
              <p
                className="translated-text"
                dir={
                  getPreviewLanguage(view.result.targetLanguage, languages)?.textDirection ?? "ltr"
                }
                lang={view.result.targetLanguage}
              >
                {view.result.translatedText}
              </p>
              <p className="result-meta">
                {gatewayMode === "live"
                  ? `Detected ${detectedLanguageName} · Online via ${view.result.provider}`
                  : `Detected ${detectedLanguageName} · Simulated ${view.result.provider} route · no external provider call`}
                {view.result.warnings.some((warning) => warning.code === "capability-stale")
                  ? " · Language availability is cached"
                  : ""}
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
        <span>
          {gatewayMode === "live"
            ? "Online gateway · NVIDIA primary"
            : "Local gateway · fake adapter only"}
        </span>
        <span>v{version}</span>
      </footer>
    </main>
  );
}
