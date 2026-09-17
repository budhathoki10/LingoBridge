import {
  type CapabilityCatalogue,
  type ExplanationConsent,
  type ExplanationRegister,
  type ExplanationRequest,
  type ExplanationResult,
  MAX_EXPLANATION_SOURCE_CODE_POINTS,
  type OnlineConsent,
  type TranslationRequest,
  type TranslationResult,
  type WordUnderstandingRequest,
  type WordUnderstandingResult,
} from "@lingobridge/contracts";
import {
  catalogueToPreviewLanguages,
  getPreviewLanguage,
  type PreviewLanguage,
} from "../lib/capabilities";
import {
  isCurrentCapabilityCatalogue,
  loadCachedCapabilityCatalogue,
  saveCachedCapabilityCatalogue,
} from "../lib/capability-cache";
import { acceptExplanationConsent, loadExplanationConsent } from "../lib/explanation-consent";
import { createBridgeGatewayClient, GATEWAY_BRIDGE_PORT } from "../lib/gateway-bridge";
import { ensurePanelFont } from "../lib/panel-font";
import { GatewayClientError } from "../lib/gateway-client";
import { acceptOnlineProviderConsent, loadOnlineProviderConsent } from "../lib/online-consent";
import {
  DEFAULT_POPUP_PREFERENCES,
  loadPopupPreferences,
  type PopupPreferences,
  replaceAvailableFavourites,
  savePopupPreferences,
  toggleFavouriteLanguage,
} from "../lib/popup-preferences";
import { pickSpeechVoice, rangeStillMatches, replaceRange } from "../lib/result-actions";
import {
  loadSavedPhrases,
  removeSavedPhrase,
  type SavedPhrase,
  savePhrase,
  saveSavedPhrases,
} from "../lib/saved-phrases";
import { saveWord } from "../lib/saved-words";
import {
  isClickableWord,
  tokenizeWords,
  wordUnderstandingCacheKey,
} from "../lib/word-understanding";
import {
  chooseSelectionTargetLanguage,
  resolveSelectionSource,
  supportedTargetsForSource,
} from "../lib/selection-language";
import {
  computeAnchoredPosition,
  detectSensitiveSelection,
  evaluateSelection,
  loadSelectionMagicSettings,
  parseSelectionMagicMessage,
  SELECTION_MAGIC_EXPIRY_MS,
  SELECTION_MAGIC_STABILITY_MS,
  type SensitiveSelectionKind,
  selectionFingerprint,
} from "../lib/selection-magic";

// Page origins are never allowed by the gateway, and Chrome gives a content-script fetch the
// page's origin. Every gateway call therefore goes through the background worker, which runs on
// the extension origin the gateway trusts. One port per call: the answer comes back as a plain
// message, and disconnecting cancels the call.
const gatewayPorts = new Map<string, Browser.runtime.Port>();

const EXTENSION_UPDATED_MESSAGE = "LingoBridge was updated. Reload this page to keep translating.";

/**
 * Reloading or updating the extension leaves this script running in already-open tabs, cut off
 * from the new background worker. Chrome signals that by clearing the runtime id.
 */
function extensionContextInvalidated(): boolean {
  try {
    return !browser.runtime?.id;
  } catch {
    return true;
  }
}

const gatewayClient = createBridgeGatewayClient({
  abort(message) {
    gatewayPorts.get(message.id)?.disconnect();
    gatewayPorts.delete(message.id);
  },
  send(message) {
    return new Promise((resolve, reject) => {
      if (extensionContextInvalidated()) {
        reject(new GatewayClientError("network-unavailable", EXTENSION_UPDATED_MESSAGE, false));
        return;
      }
      let port: Browser.runtime.Port;
      try {
        port = browser.runtime.connect({ name: GATEWAY_BRIDGE_PORT });
      } catch {
        reject(new Error("The LingoBridge background worker could not be reached."));
        return;
      }
      gatewayPorts.set(message.id, port);
      let settled = false;
      port.onMessage.addListener((response) => {
        settled = true;
        gatewayPorts.delete(message.id);
        resolve(response);
        port.disconnect();
      });
      port.onDisconnect.addListener(() => {
        gatewayPorts.delete(message.id);
        if (!settled) reject(new Error("The LingoBridge background worker closed the connection."));
      });
      port.postMessage(message);
    });
  },
});

const HOST_TAG = "lingobridge-selection-root";
const HOST_MARKER = "data-lingobridge-selection-root";
const FAKE_CONSENT: OnlineConsent = {
  acceptedAt: "2026-09-07T00:00:00.000Z",
  google: true,
  googleBackup: true,
  myMemory: true,
  nvidia: true,
  nvidiaBackup: true,
  version: "phase-3.1-fake-gateway",
};

const FAKE_EXPLANATION_CONSENT: ExplanationConsent = {
  acceptedAt: "2026-09-15T00:00:00.000Z",
  nvidia: true,
  version: "fake-gateway",
};

const REGISTER_LABELS: Record<ExplanationRegister, string> = {
  casual: "Casual",
  formal: "Formal",
  neutral: "Neutral",
  slang: "Slang",
};

function providerLabel(provider: TranslationResult["provider"]): string {
  if (provider === "mymemory") return "MyMemory";
  if (provider === "nvidia") return "NVIDIA";
  if (provider === "google") return "Google";
  return "On-device";
}

type ExplanationState = "idle" | "consent" | "loading" | "error" | "ready";
type WordState = "idle" | "consent" | "loading" | "error" | "ready";

interface CapturedSelection {
  editable: boolean;
  fingerprint: string;
  getRect: () => DOMRect;
  /**
   * Writes the translation over the captured range, or refuses. Present only for editable
   * selections. It re-checks the range at call time: the page may have rewritten the field since
   * capture, and offsets that no longer hold the translated text must not be overwritten.
   */
  replace?: (translation: string) => boolean;
  text: string;
}

type SurfaceState =
  | "consent"
  | "error"
  | "icon"
  | "loading"
  | "unsupported-pair"
  | "needs-target"
  | "preparing"
  | "ready"
  | "sensitive"
  | "success";

interface TranslationContext {
  catalogue: CapabilityCatalogue;
  consent: OnlineConsent | null;
  favouriteLanguageCodes: string[];
  gatewayMode: "fake" | "live";
  languages: PreviewLanguage[];
  requestText: string;
  romanizedNepali: boolean;
  sourceAssumed: boolean;
  sourceLanguage: string;
  targetLanguage: string;
}

interface InstalledController {
  destroy(): void;
  translate(text?: string): void;
}

declare global {
  interface Window {
    __lingobridgeSelectionController?: InstalledController;
  }
}

const SURFACE_CSS = `
  :host {
    all: initial;
    color-scheme: light;
    contain: layout style;
    font-family: "LingoBridge Roboto", Roboto, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  /* The host element is reset with an inline "all: initial !important", which also clears a font
     set on :host, so the font is applied to the surface itself. */
  .magic, .panel { font-family: "LingoBridge Roboto", Roboto, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  button, input, select { color: inherit; font: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .58; }
  button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid rgba(35, 99, 235, .3); outline-offset: 2px; }
  .magic {
    display: grid; width: 38px; height: 38px; padding: 0; place-items: center;
    border: 1px solid rgba(255,255,255,.78); border-radius: 10px;
    color: #fff; background: #2363eb; box-shadow: 0 8px 24px rgba(20, 31, 54, .24);
    transition: transform 120ms ease, background 120ms ease;
    animation: pop-in 140ms ease;
  }
  .magic:hover { background: #1d4ed8; transform: translateY(-1px); }
  .magic:active { transform: translateY(0); }
  .magic svg { width: 21px; height: 21px; }
  .panel {
    width: min(380px, calc(100vw - 16px)); max-height: min(520px, calc(100vh - 16px));
    overflow: auto; border: 1px solid #d4d7da; border-radius: 12px; color: #18202a;
    background: #fbfaf7; box-shadow: 0 18px 48px rgba(20, 31, 54, .22);
    animation: panel-in 140ms ease;
  }
  @keyframes pop-in { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }
  @keyframes panel-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border-bottom: 1px solid #e1e1de; background: #fff; }
  .brand { display: flex; min-width: 0; align-items: center; gap: 8px; }
  .mark { display: grid; width: 27px; height: 27px; flex: none; place-items: center; border-radius: 7px; color: #fff; background: #2363eb; }
  .mark svg { width: 16px; height: 16px; }
  .brand-copy { display: grid; min-width: 0; gap: 1px; }
  .brand strong { font-size: 12px; line-height: 1.2; letter-spacing: -.01em; }
  .brand span { overflow: hidden; color: #6a727b; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .close { display: grid; width: 30px; height: 30px; flex: none; padding: 0; place-items: center; border: 1px solid transparent; border-radius: 7px; color: #626b74; background: transparent; }
  .close:hover { border-color: #d7d9db; background: #f5f5f3; }
  .close svg { width: 17px; height: 17px; }
  .body { display: grid; gap: 11px; padding: 12px; }
  .language-row { display: grid; grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr); align-items: end; gap: 8px; }
  .target-field { display: grid; min-width: 0; gap: 4px; }
  .target-control { display: grid; grid-template-columns: minmax(0, 1fr) 34px; gap: 5px; }
  .favorite-toggle { display: grid; width: 34px; height: 38px; padding: 0; place-items: center; border: 1px solid #cfd2d5; border-radius: 7px; color: #6b7480; background: #fff; font-size: 21px; line-height: 1; }
  .favorite-toggle[aria-pressed="true"] { color: #a66b00; border-color: #e0c47c; background: #fffaf0; }
  .favorite-toggle:hover { border-color: #969da4; }
  .favorites { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
  .favorites[hidden] { display: none; }
  .favorites-label { margin-right: 2px; color: #707981; font-size: 10px; font-weight: 650; }
  .favorites button { min-height: 27px; padding: 4px 7px; border: 1px solid #cfd2d5; border-radius: 6px; color: #394450; background: #fff; font-size: 11px; font-weight: 600; }
  .favorites button:hover { border-color: #2363eb; color: #1d4ed8; }
  .favorites button[aria-pressed="true"] { border-color: #b9ccef; color: #174fbd; background: #edf3ff; }
  .favorite-picker { border: 1px solid #dedfdd; border-radius: 8px; background: #fff; }
  .favorite-picker[hidden] { display: none; }
  .favorite-picker summary { padding: 8px 10px; color: #1d4ed8; cursor: pointer; font-size: 11px; font-weight: 700; }
  .favorite-picker__body { display: grid; gap: 8px; padding: 0 10px 10px; }
  .favorite-picker__search { width: 100%; min-height: 34px; padding: 6px 9px; border: 1px solid #cfd2d5; border-radius: 7px; background: #fff; font-size: 12px; }
  .favorite-picker__list { display: grid; gap: 2px; max-height: 170px; overflow: auto; }
  .favorite-picker__item { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 4px 2px; color: #394450; cursor: pointer; font-size: 11px; font-weight: 600; text-transform: none; letter-spacing: normal; }
  .favorite-picker__item[hidden] { display: none; }
  .favorite-picker__item input { width: 15px; height: 15px; margin: 0; accent-color: #2363eb; }
  .favorite-picker__footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .favorite-picker__count { color: #66707a; font-size: 10px; }
  .favorite-picker__save { min-height: 31px; padding: 5px 9px; border: 1px solid #2363eb; border-radius: 7px; color: #fff; background: #2363eb; font-size: 11px; font-weight: 700; }
  label { display: grid; min-width: 0; gap: 4px; color: #66707a; font-size: 10px; font-weight: 650; text-transform: uppercase; letter-spacing: .02em; }
  .source-language { display: flex; min-width: 0; height: 38px; align-items: center; overflow: hidden; padding: 0 9px; border: 1px solid #d8dadd; border-radius: 7px; background: #f1f2f0; color: #3c454f; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  select {
    width: 100%; min-width: 0; height: 38px; padding: 0 26px 0 9px;
    border: 1px solid #cfd2d5; border-radius: 7px; background: #fff
      url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%234e5862" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')
      no-repeat right 7px center / 15px;
    color: #18202a; font-size: 12px; font-weight: 600; appearance: none; -webkit-appearance: none;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  select:hover { border-color: #969da4; }
  select:focus-visible { border-color: #2363eb; }
  select:disabled { background-color: #f1f2f0; color: #8b939c; cursor: not-allowed; }
  .arrow { display: flex; align-self: center; justify-content: center; margin-bottom: 9px; color: #8b9299; }
  .arrow svg { width: 15px; height: 15px; }
  .source, .result { margin: 0; padding: 10px 11px; border: 1px solid #dedfdd; border-radius: 8px; background: #fff; font-size: 13px; line-height: 1.52; overflow-wrap: anywhere; white-space: pre-wrap; }
  .source { max-height: 112px; overflow: auto; color: #4d5660; }
  .source__word { margin: 0; padding: 0; border: 0; border-radius: 3px; color: inherit; background: transparent; font: inherit; line-height: inherit; cursor: pointer; }
  .source__word:hover, .source__word:focus-visible { color: #174fbd; background: #edf3ff; outline: 2px solid transparent; }
  .source__word[aria-pressed="true"] { color: #174fbd; background: #dfeaff; }
  .result { min-height: 70px; color: #19212b; }
  .status { display: flex; align-items: flex-start; gap: 8px; margin: 0; color: #606a74; font-size: 11px; line-height: 1.45; }
  .dot { width: 7px; height: 7px; flex: none; margin-top: 4px; border-radius: 50%; background: #2363eb; }
  .status--error { color: #9f261d; }
  .status--error .dot { background: #b42318; }
  .status--warning { color: #7a5100; }
  .status--warning .dot { background: #b77900; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
  .actions button, .link-button { min-height: 34px; padding: 7px 11px; border: 1px solid #2363eb; border-radius: 7px; color: #fff; background: #2363eb; font-size: 11px; font-weight: 700; transition: background 120ms ease, border-color 120ms ease, transform 80ms ease; }
  .actions button:hover { background: #1d4ed8; }
  .actions button:active { transform: translateY(1px); }
  .actions button:disabled:hover { background: #2363eb; transform: none; }
  .actions .secondary { border-color: #c7cacf; color: #4e5862; background: #fff; }
  .actions .secondary:hover { border-color: #969da4; background: #f8f8f6; }
  .actions .secondary:disabled:hover { border-color: #c7cacf; background: #fff; }
  .privacy { color: #51627a; font-size: 10px; line-height: 1.45; }
  .privacy a { color: #1d4ed8; }
  .meta { display: flex; flex-wrap: wrap; gap: 5px; color: #707981; font-size: 10px; }
  .explain { display: grid; gap: 8px; padding: 10px 11px; border: 1px solid #d9e3f7; border-radius: 8px; background: #f5f8ff; }
  .explain--error { border-color: #efc6c0; background: #fff7f6; }
  .explain__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .explain__title { color: #1f3f86; font-size: 11px; font-weight: 700; letter-spacing: .01em; }
  .explain__badge { padding: 1px 7px; border: 1px solid #c9d6f2; border-radius: 999px; color: #34518f; background: #fff; font-size: 10px; font-weight: 650; }
  .explain p { margin: 0; overflow-wrap: anywhere; }
  .explain__meaning { color: #19212b; font-size: 13px; line-height: 1.5; }
  .explain__note { color: #4d5660; font-size: 11px; line-height: 1.45; }
  .explain__examples { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .explain__examples li { padding: 6px 8px; border-radius: 6px; background: #fff; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
  .explain__status { display: flex; align-items: center; gap: 8px; color: #405070; font-size: 11px; }
  .explain__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
  .explain__actions button { min-height: 30px; padding: 5px 10px; border: 1px solid #2363eb; border-radius: 7px; color: #fff; background: #2363eb; font-size: 11px; font-weight: 700; }
  .explain__actions button:hover { background: #1d4ed8; }
  .explain__actions .secondary { border-color: #c7cacf; color: #4e5862; background: #fff; }
  .explain__actions .secondary:hover { border-color: #969da4; background: #f8f8f6; }
  .word-panel { display: grid; gap: 8px; padding: 10px 11px; border: 1px solid #cddbf7; border-radius: 8px; background: #f7f9fe; }
  .word-panel--error { border-color: #efc6c0; background: #fff7f6; }
  .word-panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .word-panel__title { color: #173f91; font-size: 13px; font-weight: 750; }
  .word-panel__close { width: 28px; height: 28px; padding: 0; border: 0; color: #67717c; background: transparent; font-size: 18px; }
  .word-panel dl { display: grid; gap: 7px; margin: 0; }
  .word-panel dt { color: #66707a; font-size: 10px; font-weight: 700; text-transform: uppercase; }
  .word-panel dd { margin: 1px 0 0; color: #252d36; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
  .spinner { width: 14px; height: 14px; flex: none; border: 2px solid #cbd7ef; border-top-color: #2363eb; border-radius: 50%; animation: spin .75s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .magic { transition: none; } .spinner { animation-duration: 1.5s; } }
  @media (max-width: 280px) { .language-row { grid-template-columns: 1fr; } .arrow { display: none; } .actions { justify-content: stretch; } .actions button { flex: 1; } .favorite-picker__footer { display: grid; } .favorite-picker__save { width: 100%; } }
`;

function sparkSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M12 3.8c.7 3.1 2.1 4.5 5.2 5.2-3.1.7-4.5 2.1-5.2 5.2C11.3 11.1 9.9 9.7 6.8 9 9.9 8.3 11.3 6.9 12 3.8Z",
  );
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "1.7");
  svg.append(path);
  return svg;
}

function arrowSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 12h13m0 0-5-5m5 5-5 5");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "1.8");
  svg.append(path);
  return svg;
}

function closeSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m7 7 10 10M17 7 7 17");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-width", "1.8");
  svg.append(path);
  return svg;
}

function elementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function isExtensionOwned(element: Element | null): boolean {
  return Boolean(element?.closest(`[${HOST_MARKER}]`));
}

function isVisiblyHidden(element: Element | null): boolean {
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number(style.opacity) === 0
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function usableRect(rect: DOMRect): DOMRect {
  if (rect.width > 0 || rect.height > 0) return rect;
  return new DOMRect(rect.left, rect.top, 1, 18);
}

/**
 * Writes into a form field without ever letting the page treat it as a submission. No key events
 * are synthesized and no submit is dispatched: `insertText` is preferred because it keeps the
 * field's own undo history and notifies frameworks the way typing does, and the manual path still
 * only sets the value and raises `input`.
 */
function writeIntoField(
  field: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  translation: string,
): boolean {
  if (field.disabled || field.readOnly || !field.isConnected) return false;
  if (!rangeStillMatches(field.value, start, end, field.value.slice(start, end))) return false;

  field.focus({ preventScroll: true });
  field.setSelectionRange(start, end);
  if (document.execCommand("insertText", false, translation)) return true;

  const prototype = field instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement;
  const setValue = Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set;
  const next = replaceRange(field.value, start, end, translation);
  if (setValue) setValue.call(field, next);
  else field.value = next;
  field.setSelectionRange(start, start + translation.length);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function captureSelection(
  lastFingerprint: string | null,
  providedText?: string,
): CapturedSelection | null {
  const active = document.activeElement;
  const supportedPage = location.protocol === "http:" || location.protocol === "https:";

  if (
    (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
    (active.selectionStart ?? 0) !== (active.selectionEnd ?? 0)
  ) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    const text = providedText ?? active.value.slice(start, end);
    const rect = usableRect(active.getBoundingClientRect());
    const fingerprint = selectionFingerprint(text, rect);
    const eligibility = evaluateSelection({
      collapsed: providedText === undefined && start === end,
      duplicate: providedText === undefined && fingerprint === lastFingerprint,
      extensionOwned: isExtensionOwned(active),
      hidden: active.type === "hidden" || isVisiblyHidden(active),
      password: active instanceof HTMLInputElement && active.type === "password",
      supportedPage,
      text,
    });
    if (!eligibility.eligible) return null;
    const field = active;
    const captured = eligibility.text;
    return {
      editable: true,
      fingerprint,
      getRect: () => usableRect(field.getBoundingClientRect()),
      replace: (translation) =>
        rangeStillMatches(field.value, start, end, captured) &&
        writeIntoField(field, start, end, translation),
      text: captured,
    };
  }

  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const text = providedText ?? selection?.toString() ?? "";
  const element = elementFromNode(range?.commonAncestorContainer ?? null);
  const initialRect = range
    ? usableRect(range.getBoundingClientRect())
    : new DOMRect(
        Math.max(8, window.innerWidth / 2 - 1),
        Math.max(8, window.innerHeight / 2 - 1),
        2,
        2,
      );
  const fingerprint = selectionFingerprint(text, initialRect);
  const eligibility = evaluateSelection({
    collapsed: providedText === undefined && (!selection || selection.isCollapsed || !range),
    duplicate: providedText === undefined && fingerprint === lastFingerprint,
    extensionOwned: isExtensionOwned(element),
    hidden: isVisiblyHidden(element),
    password: element instanceof HTMLInputElement && element.type === "password",
    supportedPage,
    text,
  });
  if (!eligibility.eligible) return null;
  const host = element?.closest("[contenteditable='true']");
  const captured = eligibility.text;
  return {
    editable: Boolean(host),
    fingerprint,
    getRect: () => {
      if (!range?.commonAncestorContainer.isConnected) return initialRect;
      return usableRect(range.getBoundingClientRect());
    },
    replace:
      host && range
        ? (translation) => {
            // The same guard as a form field: the range must still be connected and still hold
            // exactly the text that was translated.
            if (!range.commonAncestorContainer.isConnected) return false;
            if (range.toString() !== captured) return false;
            const live = window.getSelection();
            if (!live) return false;
            live.removeAllRanges();
            live.addRange(range);
            if (document.execCommand("insertText", false, translation)) return true;
            range.deleteContents();
            range.insertNode(document.createTextNode(translation));
            host.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
          }
        : undefined,
    text: captured,
  };
}

function sensitiveMessage(kind: SensitiveSelectionKind): string {
  const names: Record<SensitiveSelectionKind, string> = {
    health: "health or medical information",
    identity: "an identity number",
    "one-time-code": "a one-time or verification code",
    password: "a password or passcode",
    "payment-card": "a payment-card number",
    secret: "a private key or API secret",
  };
  return `This selection may contain ${names[kind]}. It has not been sent. Continue only if you intend to process it online.`;
}

function option(select: HTMLSelectElement, value: string, label: string): void {
  const entry = document.createElement("option");
  entry.value = value;
  entry.textContent = label;
  select.append(entry);
}

function createController(): InstalledController {
  let activeSelection: CapturedSelection | null = null;
  let observerEnabled = false;
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let state: SurfaceState | null = null;
  let context: TranslationContext | null = null;
  let result: TranslationResult | null = null;
  let errorMessage = "";
  let errorRetryable = false;
  let sensitiveKind: SensitiveSelectionKind | null = null;
  let savedPhraseId: string | null = null;
  let savePending = false;
  let copyFeedback: "copied" | "failed" | null = null;
  let copyFeedbackTimer: number | null = null;
  let speaking = false;
  let voicesRequested = false;
  let replaceFeedback: "stale" | null = null;
  let explanation: ExplanationResult | null = null;
  let explanationState: ExplanationState = "idle";
  let explanationError = "";
  let explanationRetryable = false;
  let explanationController: AbortController | null = null;
  let explanationSequence = 0;
  let wordResult: WordUnderstandingResult | null = null;
  let wordState: WordState = "idle";
  let wordError = "";
  let wordRetryable = false;
  let selectedWord = "";
  let wordController: AbortController | null = null;
  let wordSequence = 0;
  let wordSavePending = false;
  let wordSaved = false;
  const wordCache = new Map<string, WordUnderstandingResult>();
  let lastFingerprint: string | null = null;
  let stabilityTimer: number | null = null;
  let expiryTimer: number | null = null;
  let positionFrame: number | null = null;
  let requestController: AbortController | null = null;
  let requestSequence = 0;
  let preferenceWrite: Promise<void> = Promise.resolve();

  function setHostPosition(width: number, height: number): void {
    if (!host || !activeSelection) return;
    const position = computeAnchoredPosition({
      anchor: activeSelection.getRect(),
      height,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      width,
    });
    host.style.setProperty("left", `${position.left}px`, "important");
    host.style.setProperty("top", `${position.top}px`, "important");
  }

  function reposition(): void {
    if (!host || positionFrame !== null) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = null;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      setHostPosition(Math.max(rect.width, state === "icon" ? 38 : 300), Math.max(rect.height, 38));
    });
  }

  function ensureHost(): ShadowRoot {
    if (host && shadow) return shadow;
    ensurePanelFont();
    host = document.createElement(HOST_TAG);
    host.setAttribute(HOST_MARKER, "");
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("margin", "0", "important");
    host.style.setProperty("padding", "0", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);
    return shadow;
  }

  function clearTimers(): void {
    if (stabilityTimer !== null) window.clearTimeout(stabilityTimer);
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    if (positionFrame !== null) cancelAnimationFrame(positionFrame);
    if (copyFeedbackTimer !== null) window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = null;
    stabilityTimer = null;
    expiryTimer = null;
    positionFrame = null;
  }

  function close(): void {
    requestSequence += 1;
    requestController?.abort();
    requestController = null;
    clearTimers();
    host?.remove();
    host = null;
    shadow = null;
    state = null;
    context = null;
    result = null;
    sensitiveKind = null;
    savedPhraseId = null;
    savePending = false;
    copyFeedback = null;
    replaceFeedback = null;
    resetExplanation();
    resetWordUnderstanding();
    stopSpeaking();
    activeSelection = null;
  }

  function setExpiry(): void {
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    expiryTimer = window.setTimeout(close, SELECTION_MAGIC_EXPIRY_MS);
  }

  function renderBase(content: HTMLElement): void {
    const root = ensureHost();
    root.replaceChildren();
    const style = document.createElement("style");
    style.textContent = SURFACE_CSS;
    root.append(style, content);
    host?.setAttribute("data-lingobridge-state", state ?? "closed");
    queueMicrotask(reposition);
  }

  function renderIcon(): void {
    state = "icon";
    const button = document.createElement("button");
    button.className = "magic";
    button.type = "button";
    button.title = "Translate selected text";
    button.setAttribute("aria-label", "Translate selected text with LingoBridge");
    button.append(sparkSvg());
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => void activate());
    renderBase(button);
    setHostPosition(38, 38);
  }

  function createPanel(): {
    actions: HTMLDivElement;
    body: HTMLDivElement;
    favoriteToggle: HTMLButtonElement;
    favorites: HTMLDivElement;
    favoritePicker: HTMLDetailsElement;
    sourceName: HTMLSpanElement;
    status: HTMLParagraphElement;
    targetSelect: HTMLSelectElement;
  } {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("aria-label", "LingoBridge translation");
    const head = document.createElement("header");
    head.className = "head";
    const brand = document.createElement("div");
    brand.className = "brand";
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.append(sparkSvg());
    const brandCopy = document.createElement("span");
    brandCopy.className = "brand-copy";
    const title = document.createElement("strong");
    title.textContent = "LingoBridge";
    const subtitle = document.createElement("span");
    subtitle.textContent = "Selected text translation";
    brandCopy.append(title, subtitle);
    brand.append(mark, brandCopy);
    const closeButton = document.createElement("button");
    closeButton.className = "close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close LingoBridge");
    closeButton.append(closeSvg());
    closeButton.addEventListener("pointerdown", (event) => event.preventDefault());
    closeButton.addEventListener("click", close);
    head.append(brand, closeButton);

    const body = document.createElement("div");
    body.className = "body";
    const languageRow = document.createElement("div");
    languageRow.className = "language-row";
    const sourceLabel = document.createElement("label");
    sourceLabel.append("From");
    const sourceName = document.createElement("span");
    sourceName.className = "source-language";
    sourceLabel.append(sourceName);
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.append(arrowSvg());
    const targetField = document.createElement("div");
    targetField.className = "target-field";
    const targetLabel = document.createElement("label");
    targetLabel.htmlFor = "lingobridge-target-language";
    targetLabel.textContent = "To";
    const targetControl = document.createElement("div");
    targetControl.className = "target-control";
    const targetSelect = document.createElement("select");
    targetSelect.id = "lingobridge-target-language";
    targetSelect.setAttribute("aria-label", "Target language");
    const favoriteToggle = document.createElement("button");
    favoriteToggle.className = "favorite-toggle";
    favoriteToggle.type = "button";
    favoriteToggle.textContent = "☆";
    targetControl.append(targetSelect, favoriteToggle);
    targetField.append(targetLabel, targetControl);
    languageRow.append(sourceLabel, arrow, targetField);

    const favorites = document.createElement("div");
    favorites.className = "favorites";
    favorites.setAttribute("aria-label", "Favorite target languages");
    const favoritePicker = document.createElement("details");
    favoritePicker.className = "favorite-picker";
    favoritePicker.setAttribute("aria-label", "Choose favorite languages");

    const source = document.createElement("p");
    source.className = "source";
    source.dir = "auto";
    renderInteractiveSource(source);
    const status = document.createElement("p");
    status.className = "status";
    status.setAttribute("aria-live", "polite");
    const actions = document.createElement("div");
    actions.className = "actions";
    body.append(languageRow, favorites, favoritePicker, source, status, actions);
    panel.append(head, body);
    renderBase(panel);
    return {
      actions,
      body,
      favoriteToggle,
      favorites,
      favoritePicker,
      sourceName,
      status,
      targetSelect,
    };
  }

  function sourceLanguageName(): string {
    if (!context) return "";
    if (context.romanizedNepali) return "Romanized Nepali";
    return (
      getPreviewLanguage(context.sourceLanguage, context.languages)?.name ?? context.sourceLanguage
    );
  }

  function isTranslatablePair(): boolean {
    if (!context) return false;
    if (context.sourceLanguage === context.targetLanguage) return false;
    return supportedTargetsForSource(context.catalogue, context.sourceLanguage).includes(
      context.targetLanguage,
    );
  }

  function fillLanguageControls(
    sourceName: HTMLSpanElement,
    targetSelect: HTMLSelectElement,
    favoriteToggle: HTMLButtonElement,
    favorites: HTMLDivElement,
    favoritePicker: HTMLDetailsElement,
  ): void {
    if (!context) return;
    const name = sourceLanguageName();
    sourceName.textContent = context.sourceAssumed ? `${name} (assumed)` : name;
    const targets = new Set(supportedTargetsForSource(context.catalogue, context.sourceLanguage));
    for (const language of context.languages) {
      if (targets.has(language.code)) option(targetSelect, language.code, language.name);
    }
    targetSelect.value = context.targetLanguage;
    targetSelect.addEventListener("change", () => chooseTarget(targetSelect.value));

    const selectedName =
      getPreviewLanguage(context.targetLanguage, context.languages)?.name ?? context.targetLanguage;
    const pinned = context.favouriteLanguageCodes.includes(context.targetLanguage);
    favoriteToggle.textContent = pinned ? "★" : "☆";
    favoriteToggle.setAttribute("aria-pressed", String(pinned));
    favoriteToggle.setAttribute(
      "aria-label",
      `${pinned ? "Remove" : "Add"} ${selectedName} ${pinned ? "from" : "to"} favorites`,
    );
    favoriteToggle.title = pinned ? "Remove from favorites" : "Add to favorites";
    favoriteToggle.addEventListener("pointerdown", (event) => event.preventDefault());
    favoriteToggle.addEventListener("click", () => {
      if (!context) return;
      const code = context.targetLanguage;
      context.favouriteLanguageCodes = toggleFavouriteLanguage(
        context.favouriteLanguageCodes,
        code,
      );
      void persistPreferenceChange((preferences) => ({
        ...preferences,
        favouriteLanguageCodes: toggleFavouriteLanguage(preferences.favouriteLanguageCodes, code),
      }));
      renderPanel();
    });

    const compatibleFavorites = context.favouriteLanguageCodes.filter((code) => targets.has(code));
    favorites.hidden = compatibleFavorites.length === 0;
    if (compatibleFavorites.length > 0) {
      const label = document.createElement("span");
      label.className = "favorites-label";
      label.textContent = "Favorites";
      favorites.append(label);
    }
    for (const code of compatibleFavorites) {
      const name = getPreviewLanguage(code, context.languages)?.name ?? code;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.setAttribute("aria-label", `Use ${name}`);
      button.setAttribute("aria-pressed", String(code === context.targetLanguage));
      button.disabled = state === "loading" || state === "preparing";
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        if (context?.targetLanguage !== code) chooseTarget(code);
      });
      favorites.append(button);
    }
    fillFavoritePicker(favoritePicker, targets);
  }

  /**
   * Choosing a language only records the choice. Translating is a separate click, so switching
   * from the default language to the one the reader wants never sends a translation nobody reads.
   */
  function chooseTarget(code: string): void {
    if (!context) return;
    context.targetLanguage = code;
    void savePreferredTarget(code);
    if (state !== "consent") {
      requestSequence += 1;
      requestController?.abort();
      requestController = null;
      stopSpeaking();
      result = null;
      savedPhraseId = null;
      copyFeedback = null;
      replaceFeedback = null;
      resetExplanation();
      resetWordUnderstanding();
      state = isTranslatablePair() ? "ready" : "unsupported-pair";
    }
    renderPanel();
  }

  function fillFavoritePicker(picker: HTMLDetailsElement, targets: Set<string>): void {
    if (!context) return;
    const available = context.languages.filter((language) => targets.has(language.code));
    const availableCodes = available.map((language) => language.code);
    const selected = new Set(context.favouriteLanguageCodes.filter((code) => targets.has(code)));
    const unavailableCount = context.favouriteLanguageCodes.filter(
      (code) => !targets.has(code),
    ).length;
    const summary = document.createElement("summary");
    summary.textContent = "Manage favorites";
    summary.setAttribute("aria-label", "Manage favorite languages");
    const body = document.createElement("div");
    body.className = "favorite-picker__body";
    const search = document.createElement("input");
    search.className = "favorite-picker__search";
    search.type = "search";
    search.placeholder = "Search languages";
    search.setAttribute("aria-label", "Search favorite languages");
    const list = document.createElement("div");
    list.className = "favorite-picker__list";
    const checkboxes: HTMLInputElement[] = [];
    for (const language of available) {
      const row = document.createElement("label");
      row.className = "favorite-picker__item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = language.code;
      checkbox.checked = selected.has(language.code);
      checkbox.setAttribute("aria-label", `Favorite ${language.name}`);
      row.append(checkbox, document.createTextNode(language.name));
      list.append(row);
      checkboxes.push(checkbox);
    }
    const footer = document.createElement("div");
    footer.className = "favorite-picker__footer";
    const count = document.createElement("span");
    count.className = "favorite-picker__count";
    const save = document.createElement("button");
    save.className = "favorite-picker__save";
    save.type = "button";
    save.textContent = "Save favorites";
    save.setAttribute("aria-label", "Save favorite languages");
    save.addEventListener("pointerdown", (event) => event.preventDefault());
    function refreshChecklist(): void {
      const total = unavailableCount + selected.size;
      count.textContent = `${total} of 12 favorites selected`;
      for (const checkbox of checkboxes) checkbox.disabled = total >= 12 && !checkbox.checked;
    }
    for (const checkbox of checkboxes) {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(checkbox.value);
        else selected.delete(checkbox.value);
        refreshChecklist();
      });
    }
    search.addEventListener("input", () => {
      const query = search.value.trim().toLocaleLowerCase();
      for (const row of list.children) {
        if (row instanceof HTMLElement)
          row.hidden = !row.textContent?.toLocaleLowerCase().includes(query);
      }
    });
    save.addEventListener("click", () => {
      if (!context) return;
      const choices = [...selected];
      context.favouriteLanguageCodes = replaceAvailableFavourites(
        context.favouriteLanguageCodes,
        availableCodes,
        choices,
      );
      void persistPreferenceChange((preferences) => ({
        ...preferences,
        favouriteLanguageCodes: replaceAvailableFavourites(
          preferences.favouriteLanguageCodes,
          availableCodes,
          choices,
        ),
      }));
      renderPanel();
    });
    footer.append(count, save);
    body.append(search, list, footer);
    picker.append(summary, body);
    refreshChecklist();
  }

  function statusContent(
    status: HTMLParagraphElement,
    message: string,
    mode: "error" | "normal" | "warning" = "normal",
  ): void {
    status.className = mode === "normal" ? "status" : `status status--${mode}`;
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = message;
    status.replaceChildren(dot, text);
  }

  function actionButton(label: string, action: () => void, secondary = false): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (secondary) button.className = "secondary";
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", action);
    return button;
  }

  function renderPanel(): void {
    const {
      actions,
      body,
      favoriteToggle,
      favorites,
      favoritePicker,
      sourceName,
      status,
      targetSelect,
    } = createPanel();
    fillLanguageControls(sourceName, targetSelect, favoriteToggle, favorites, favoritePicker);
    const languageControlsReady = Boolean(context);
    targetSelect.disabled = !languageControlsReady || state === "loading" || state === "preparing";
    favoriteToggle.disabled = targetSelect.disabled;
    favoritePicker.hidden = targetSelect.disabled;

    if (state === "preparing") {
      statusContent(status, "Preparing your preferred language…");
      status.prepend(Object.assign(document.createElement("span"), { className: "spinner" }));
      return;
    }

    if (state === "sensitive" && sensitiveKind) {
      statusContent(status, sensitiveMessage(sensitiveKind), "warning");
      actions.append(
        actionButton("Cancel", close, true),
        actionButton("Translate anyway", () => void prepareTranslation(true, true)),
      );
      return;
    }

    if (state === "consent") {
      statusContent(
        status,
        "Online translation is off. The selected text has not been sent.",
        "warning",
      );
      const privacy = document.createElement("p");
      privacy.className = "privacy";
      privacy.append(
        "Online mode sends only this selected text to MyMemory first, with NVIDIA as a backup for supported languages. ",
      );
      const link = document.createElement("a");
      link.href = browser.runtime.getURL("/privacy.html");
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Privacy details";
      privacy.append(link);
      body.insertBefore(privacy, actions);
      actions.append(
        actionButton("Cancel", close, true),
        actionButton("Allow and translate", () => void acceptConsentAndTranslate()),
      );
      return;
    }

    if (state === "unsupported-pair") {
      statusContent(
        status,
        `${sourceLanguageName()} cannot be translated into that language. Choose another target.`,
        "warning",
      );
      targetSelect.disabled = false;
      return;
    }

    if (state === "needs-target") {
      statusContent(
        status,
        "The selected text is already in the target language. Choose another target.",
        "warning",
      );
      targetSelect.disabled = false;
      return;
    }

    if (state === "ready") {
      const targetName =
        getPreviewLanguage(context?.targetLanguage ?? "", context?.languages)?.name ??
        context?.targetLanguage;
      statusContent(status, `Choose a language, then translate into ${targetName}.`);
      const translate = actionButton("Translate", () => void runTranslation());
      translate.setAttribute("aria-label", `Translate into ${targetName}`);
      actions.append(translate);
      return;
    }

    if (state === "loading") {
      statusContent(status, "Translating only the text you selected…");
      status.prepend(Object.assign(document.createElement("span"), { className: "spinner" }));
      actions.append(
        actionButton(
          "Stop",
          () => {
            requestSequence += 1;
            requestController?.abort();
            requestController = null;
            state = "error";
            errorMessage = "Translation stopped. Your selected text was not saved.";
            errorRetryable = true;
            renderPanel();
          },
          true,
        ),
      );
      return;
    }

    if (state === "success" && result) {
      host?.setAttribute("data-lingobridge-provider", result.provider);
      host?.setAttribute("data-lingobridge-target", result.targetLanguage);
      const translation = document.createElement("p");
      translation.className = "result";
      translation.dir =
        getPreviewLanguage(result.targetLanguage, context?.languages)?.textDirection ?? "auto";
      translation.lang = result.targetLanguage;
      translation.textContent = result.translatedText;
      body.insertBefore(translation, status);
      const sourceName = result.detectedSourceLanguage
        ? (getPreviewLanguage(result.detectedSourceLanguage, context?.languages)?.name ??
          result.detectedSourceLanguage)
        : "Unknown source";
      statusContent(
        status,
        `${sourceName} → ${getPreviewLanguage(result.targetLanguage, context?.languages)?.name ?? result.targetLanguage}`,
      );
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent =
        context?.gatewayMode === "live"
          ? `Online via ${providerLabel(result.provider)}`
          : `Simulated ${providerLabel(result.provider)} route`;
      body.insertBefore(meta, actions);
      if (context?.romanizedNepali) {
        const note = document.createElement("p");
        note.className = "privacy";
        note.textContent = "Romanized Nepali was converted to Nepali script before translation.";
        body.insertBefore(note, actions);
      }

      if (replaceFeedback === "stale") {
        statusContent(status, "That text changed on the page, so nothing was replaced.", "warning");
      }

      if (explanationState !== "idle") body.insertBefore(renderExplanation(), actions);
      if (wordState !== "idle") body.insertBefore(renderWordUnderstanding(), actions);

      if (explanationState === "idle") {
        actions.append(actionButton("Explain", () => void requestExplanation(), true));
      }

      actions.append(
        actionButton(
          copyFeedback === "copied" ? "Copied" : copyFeedback === "failed" ? "Copy failed" : "Copy",
          copyTranslation,
          true,
        ),
      );

      // Listen appears only when the browser really has a voice for this language. The catalogue
      // carries no speech data, so asking it would hide the action everywhere.
      if (pickSpeechVoice(availableVoices(), result.targetLanguage)) {
        actions.append(actionButton(speaking ? "Stop" : "Listen", toggleSpeaking, true));
      }

      if (activeSelection?.replace) {
        actions.append(actionButton("Replace", replaceSelection, true));
      }

      // Saving happens only here, on a deliberate click. Showing or closing a result never stores
      // it, which is the promise in docs/02-requirements.md.
      const saved = savedPhraseId !== null;
      const save = actionButton(
        saved ? "Saved" : "Save phrase",
        () => void togglePhraseSaved(),
        true,
      );
      save.disabled = savePending;
      save.setAttribute("aria-pressed", saved ? "true" : "false");
      actions.append(save);
      return;
    }

    if (state === "error") {
      // A retry cannot reach a replaced background worker; only a page reload loads the new script.
      if (extensionContextInvalidated()) {
        statusContent(status, EXTENSION_UPDATED_MESSAGE, "error");
        actions.append(actionButton("Reload page", () => window.location.reload()));
        return;
      }
      statusContent(status, errorMessage, "error");
      if (errorRetryable) actions.append(actionButton("Retry", () => void runTranslation()));
    }
  }

  function renderInteractiveSource(source: HTMLParagraphElement): void {
    const text = activeSelection?.text ?? "";
    if (state !== "success" || !result) {
      source.textContent = text;
      return;
    }
    source.setAttribute("aria-label", "Original text. Choose a word to understand it.");
    for (const token of tokenizeWords(text, context?.sourceLanguage)) {
      if (!token.isWord || !isClickableWord(token.text, context?.sourceLanguage)) {
        source.append(document.createTextNode(token.text));
        continue;
      }
      const button = document.createElement("button");
      button.className = "source__word";
      button.type = "button";
      button.textContent = token.text;
      button.setAttribute("aria-label", `Understand ${token.text}`);
      button.setAttribute("aria-pressed", String(selectedWord === token.text));
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => void requestWordUnderstanding(token.text));
      source.append(button);
    }
  }

  function resetWordUnderstanding(): void {
    wordSequence += 1;
    wordController?.abort();
    wordController = null;
    wordResult = null;
    wordState = "idle";
    wordError = "";
    wordRetryable = false;
    selectedWord = "";
    wordSavePending = false;
    wordSaved = false;
  }

  function renderWordUnderstanding(): HTMLElement {
    const panel = document.createElement("section");
    panel.className = wordState === "error" ? "word-panel word-panel--error" : "word-panel";
    panel.setAttribute("aria-label", "Word understanding");
    panel.setAttribute("aria-live", "polite");
    const head = document.createElement("div");
    head.className = "word-panel__head";
    const title = document.createElement("strong");
    title.className = "word-panel__title";
    title.textContent = selectedWord || "Word understanding";
    const dismiss = document.createElement("button");
    dismiss.className = "word-panel__close";
    dismiss.type = "button";
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", "Close word understanding");
    dismiss.addEventListener("click", () => {
      resetWordUnderstanding();
      renderPanel();
    });
    head.append(title, dismiss);
    panel.append(head);

    if (wordState === "consent") {
      const note = document.createElement("p");
      note.className = "explain__note";
      note.textContent =
        "Word understanding sends this word, the selected sentence, and its translation to NVIDIA Nemotron, or to an OpenRouter model if NVIDIA can’t answer. Nothing is saved unless you choose Save word.";
      const buttons = document.createElement("div");
      buttons.className = "explain__actions";
      buttons.append(
        actionButton(
          "Not now",
          () => {
            resetWordUnderstanding();
            renderPanel();
          },
          true,
        ),
        actionButton("Allow and understand", () => void acceptConsentAndUnderstandWord()),
      );
      panel.append(note, buttons);
      return panel;
    }
    if (wordState === "loading") {
      const loading = document.createElement("p");
      loading.className = "explain__status";
      loading.append(
        Object.assign(document.createElement("span"), { className: "spinner" }),
        `Understanding “${selectedWord}”…`,
      );
      panel.append(loading);
      return panel;
    }
    if (wordState === "error") {
      const error = document.createElement("p");
      error.className = "explain__note";
      error.setAttribute("role", "alert");
      error.textContent = wordError;
      panel.append(error);
      if (wordRetryable) {
        const buttons = document.createElement("div");
        buttons.className = "explain__actions";
        buttons.append(actionButton("Try again", () => void runWordUnderstanding(), true));
        panel.append(buttons);
      }
      return panel;
    }
    if (!wordResult) return panel;
    // "Part of speech" is always in English (a standard grammar term), unlike every other field.
    const fields: Array<[string, string | null, "en" | "target"]> = [
      ["Translation", wordResult.translation, "target"],
      ["Meaning", wordResult.meaning, "target"],
      ["Part of speech", wordResult.partOfSpeech, "en"],
      ["In this context", wordResult.contextMeaning, "target"],
      ["Example", wordResult.example, "target"],
      ["Pronunciation", wordResult.pronunciation, "target"],
    ];
    const list = document.createElement("dl");
    for (const [label, value, language] of fields) {
      if (!value) continue;
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      if (language === "en") {
        detail.lang = "en";
        detail.dir = "ltr";
      } else if (result) {
        detail.lang = result.targetLanguage;
        detail.dir =
          getPreviewLanguage(result.targetLanguage, context?.languages)?.textDirection ?? "auto";
      }
      detail.textContent = value;
      wrapper.append(term, detail);
      list.append(wrapper);
    }
    const buttons = document.createElement("div");
    buttons.className = "explain__actions";
    const save = actionButton(wordSaved ? "Saved" : "Save word", () => void saveCurrentWord());
    save.disabled = wordSavePending || wordSaved;
    buttons.append(save);
    panel.append(list, buttons);
    return panel;
  }

  async function requestWordUnderstanding(word: string): Promise<void> {
    if (!context || !result || !activeSelection) return;
    const normalizedWord = word.trim();
    if (wordState === "loading" && selectedWord === normalizedWord) return;
    selectedWord = normalizedWord;
    wordResult = null;
    wordSaved = false;
    const key = wordUnderstandingCacheKey({
      sourceLanguage: context.sourceLanguage,
      sourceText: activeSelection.text.trim(),
      targetLanguage: result.targetLanguage,
      word: selectedWord,
    });
    const cached = wordCache.get(key);
    if (cached) {
      wordResult = cached;
      wordState = "ready";
      renderPanel();
      return;
    }
    if (context.gatewayMode === "live" && !(await loadExplanationConsent().catch(() => null))) {
      wordState = "consent";
      renderPanel();
      return;
    }
    await runWordUnderstanding();
  }

  async function acceptConsentAndUnderstandWord(): Promise<void> {
    try {
      await acceptExplanationConsent();
    } catch {
      wordState = "error";
      wordError = "Word understanding could not save your consent. Try again.";
      wordRetryable = true;
      renderPanel();
      return;
    }
    await runWordUnderstanding();
  }

  async function runWordUnderstanding(): Promise<void> {
    if (!context || !result || !activeSelection || !selectedWord) return;
    const sequence = ++wordSequence;
    wordController?.abort();
    wordController = new AbortController();
    wordState = "loading";
    wordError = "";
    renderPanel();
    const request: WordUnderstandingRequest = {
      consent:
        context.gatewayMode === "fake"
          ? FAKE_EXPLANATION_CONSENT
          : ((await loadExplanationConsent()) as ExplanationConsent),
      operation: "understand-word",
      requestId: crypto.randomUUID(),
      sourceLanguage: context.sourceLanguage,
      sourceText: activeSelection.text.trim(),
      targetLanguage: result.targetLanguage,
      translatedText: result.translatedText,
      word: selectedWord,
    };
    try {
      const understood = await gatewayClient.understandWord(request, wordController.signal);
      if (sequence !== wordSequence) return;
      wordResult = understood;
      wordCache.set(
        wordUnderstandingCacheKey({
          sourceLanguage: request.sourceLanguage,
          sourceText: request.sourceText,
          targetLanguage: request.targetLanguage,
          word: request.word,
        }),
        understood,
      );
      wordState = "ready";
    } catch (error) {
      if (sequence !== wordSequence || error instanceof DOMException) return;
      wordState = "error";
      wordError = "Couldn’t understand this word right now.";
      wordRetryable = !(error instanceof GatewayClientError) || error.retryable;
    } finally {
      if (sequence === wordSequence) wordController = null;
    }
    renderPanel();
  }

  async function saveCurrentWord(): Promise<void> {
    if (!wordResult || !context || !result || !activeSelection || wordSavePending) return;
    wordSavePending = true;
    renderPanel();
    try {
      const savedWord = {
        contextMeaning: wordResult.contextMeaning,
        example: wordResult.example,
        id: crypto.randomUUID(),
        meaning: wordResult.meaning,
        partOfSpeech: wordResult.partOfSpeech,
        pronunciation: wordResult.pronunciation,
        savedAt: new Date().toISOString(),
        sourceLanguage: context.sourceLanguage,
        sourceText: activeSelection.text.trim(),
        targetLanguage: result.targetLanguage,
        translation: wordResult.translation,
        word: wordResult.word,
      };
      await saveWord(savedWord);
      void browser.runtime.sendMessage({ type: "lingobridge:vocabulary:save", word: savedWord });
      wordSaved = true;
    } catch {
      wordState = "error";
      wordError = "This word could not be saved. Try again.";
      wordRetryable = false;
    } finally {
      wordSavePending = false;
      renderPanel();
    }
  }

  function resetExplanation(): void {
    explanationSequence += 1;
    explanationController?.abort();
    explanationController = null;
    explanation = null;
    explanationState = "idle";
    explanationError = "";
    explanationRetryable = false;
  }

  /** Explanations cover words, phrases, and paragraphs; longer selections are told why not. */
  function canExplain(): boolean {
    return (
      Boolean(activeSelection) &&
      Array.from(activeSelection?.text.trim() ?? "").length <= MAX_EXPLANATION_SOURCE_CODE_POINTS
    );
  }

  function renderExplanation(): HTMLElement {
    const card = document.createElement("section");
    card.className = explanationState === "error" ? "explain explain--error" : "explain";
    card.setAttribute("aria-label", "Explanation");
    card.setAttribute("aria-live", "polite");

    const head = document.createElement("div");
    head.className = "explain__head";
    const title = document.createElement("span");
    title.className = "explain__title";
    title.textContent = "In simple words";
    head.append(title);
    card.append(head);

    if (explanationState === "consent") {
      const note = document.createElement("p");
      note.className = "explain__note";
      note.append(
        "Explain sends this selected text and its translation to NVIDIA’s Nemotron model, or to an OpenRouter model if NVIDIA can’t answer, to write a short explanation. Nothing is saved. ",
      );
      const link = document.createElement("a");
      link.href = browser.runtime.getURL("/privacy.html");
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Privacy details";
      note.append(link);
      const buttons = document.createElement("div");
      buttons.className = "explain__actions";
      buttons.append(
        actionButton(
          "Not now",
          () => {
            resetExplanation();
            renderPanel();
          },
          true,
        ),
        actionButton("Allow and explain", () => void acceptConsentAndExplain()),
      );
      card.append(note, buttons);
      return card;
    }

    if (explanationState === "loading") {
      const status = document.createElement("p");
      status.className = "explain__status";
      status.append(
        Object.assign(document.createElement("span"), { className: "spinner" }),
        "Explaining in simple words…",
      );
      card.append(status);
      return card;
    }

    if (explanationState === "error") {
      const message = document.createElement("p");
      message.className = "explain__note";
      message.setAttribute("role", "alert");
      message.textContent = explanationError;
      card.append(message);
      if (explanationRetryable) {
        const buttons = document.createElement("div");
        buttons.className = "explain__actions";
        buttons.append(actionButton("Try again", () => void runExplanation(), true));
        card.append(buttons);
      }
      return card;
    }

    if (!explanation || !result) return card;
    const badge = document.createElement("span");
    badge.className = "explain__badge";
    badge.textContent = REGISTER_LABELS[explanation.register];
    head.append(badge);

    const targetDirection =
      getPreviewLanguage(result.targetLanguage, context?.languages)?.textDirection ?? "auto";
    const meaning = document.createElement("p");
    meaning.className = "explain__meaning";
    meaning.lang = result.targetLanguage;
    meaning.dir = targetDirection;
    meaning.textContent = explanation.meaning;
    card.append(meaning);

    if (explanation.usageNote) {
      const note = document.createElement("p");
      note.className = "explain__note";
      note.lang = result.targetLanguage;
      note.dir = targetDirection;
      note.textContent = explanation.usageNote;
      card.append(note);
    }

    const examples = document.createElement("ul");
    examples.className = "explain__examples";
    examples.setAttribute("aria-label", "Examples");
    // The whole explanation reads in the translated language, so only the example's translation shows.
    for (const example of explanation.examples) {
      const item = document.createElement("li");
      item.lang = result.targetLanguage;
      item.dir = targetDirection;
      item.textContent = example.translation;
      examples.append(item);
    }
    card.append(examples);
    return card;
  }

  async function requestExplanation(): Promise<void> {
    if (!context || !result) return;
    // The button stays visible for long selections so the limit is explained, not hidden.
    if (!canExplain()) {
      explanationState = "error";
      explanationError = `Explain works on up to ${MAX_EXPLANATION_SOURCE_CODE_POINTS.toLocaleString()} characters. Select a shorter part of the text to explain it.`;
      explanationRetryable = false;
      renderPanel();
      return;
    }
    if (context.gatewayMode === "live") {
      const consent = await loadExplanationConsent().catch(() => null);
      if (!consent) {
        explanationState = "consent";
        renderPanel();
        return;
      }
    }
    await runExplanation();
  }

  async function acceptConsentAndExplain(): Promise<void> {
    try {
      await acceptExplanationConsent();
    } catch {
      explanationState = "error";
      explanationError = "Permission could not be saved. Nothing was sent.";
      explanationRetryable = false;
      renderPanel();
      return;
    }
    await runExplanation();
  }

  async function runExplanation(): Promise<void> {
    if (!activeSelection || !context || !result) return;
    const consent =
      context.gatewayMode === "live"
        ? await loadExplanationConsent().catch(() => null)
        : FAKE_EXPLANATION_CONSENT;
    if (!consent) {
      explanationState = "consent";
      renderPanel();
      return;
    }

    explanationSequence += 1;
    const sequence = explanationSequence;
    explanationController?.abort();
    explanationController = new AbortController();
    explanationState = "loading";
    renderPanel();

    const request: ExplanationRequest = {
      consent,
      operation: "explain",
      requestId: crypto.randomUUID(),
      sourceLanguage: result.detectedSourceLanguage ?? context.sourceLanguage,
      sourceText: activeSelection.text.trim(),
      targetLanguage: result.targetLanguage,
      translatedText: result.translatedText,
    };
    try {
      const explained = await gatewayClient.explain(request, explanationController.signal);
      if (sequence !== explanationSequence) return;
      explanation = explained;
      explanationState = "ready";
    } catch (error) {
      if (sequence !== explanationSequence) return;
      explanationState = "error";
      explanationError =
        error instanceof GatewayClientError
          ? error.message
          : "The explanation could not be loaded. Your translation is unchanged.";
      explanationRetryable = error instanceof GatewayClientError ? error.retryable : true;
    } finally {
      if (sequence === explanationSequence) explanationController = null;
    }
    if (state !== "success") return;
    renderPanel();
    // The panel scrolls; bring the answer into view instead of leaving it below the fold.
    shadow?.querySelector(".explain")?.scrollIntoView({ block: "nearest" });
  }

  function availableVoices(): SpeechSynthesisVoice[] {
    if (typeof speechSynthesis === "undefined") return [];
    const voices = speechSynthesis.getVoices();
    // The list is often empty until the engine warms up. Ask once, and redraw when it arrives so
    // Listen can appear without the user reopening the panel.
    if (voices.length === 0 && !voicesRequested) {
      voicesRequested = true;
      speechSynthesis.addEventListener(
        "voiceschanged",
        () => {
          if (state === "success") renderPanel();
        },
        { once: true },
      );
    }
    return voices;
  }

  function stopSpeaking(): void {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    speaking = false;
  }

  function toggleSpeaking(): void {
    if (!result) return;
    if (speaking) {
      stopSpeaking();
      renderPanel();
      return;
    }
    const voice = pickSpeechVoice(availableVoices(), result.targetLanguage);
    if (!voice) return;
    const utterance = new SpeechSynthesisUtterance(result.translatedText);
    utterance.lang = result.targetLanguage;
    utterance.voice = voice;
    utterance.addEventListener("end", () => {
      speaking = false;
      if (state === "success") renderPanel();
    });
    utterance.addEventListener("error", () => {
      speaking = false;
      if (state === "success") renderPanel();
    });
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    speaking = true;
    renderPanel();
  }

  function showCopyFeedback(outcome: "copied" | "failed"): void {
    copyFeedback = outcome;
    if (copyFeedbackTimer !== null) window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = window.setTimeout(() => {
      copyFeedbackTimer = null;
      copyFeedback = null;
      if (state === "success") renderPanel();
    }, 1_600);
    renderPanel();
  }

  /**
   * The fallback textarea lives inside the panel's own shadow root, so copying never adds a node
   * to the page or disturbs what the page has selected.
   */
  function copyThroughSurface(text: string): boolean {
    if (!shadow) return false;
    const carrier = document.createElement("textarea");
    carrier.setAttribute("aria-hidden", "true");
    carrier.style.setProperty("position", "absolute");
    carrier.style.setProperty("opacity", "0");
    carrier.value = text;
    shadow.append(carrier);
    carrier.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    carrier.remove();
    return copied;
  }

  function copyTranslation(): void {
    if (!result) return;
    const text = result.translatedText;
    void navigator.clipboard?.writeText(text).then(
      () => showCopyFeedback("copied"),
      () => showCopyFeedback(copyThroughSurface(text) ? "copied" : "failed"),
    );
  }

  function replaceSelection(): void {
    if (!activeSelection?.replace || !result) return;
    if (activeSelection.replace(result.translatedText)) {
      stopSpeaking();
      close();
      return;
    }
    replaceFeedback = "stale";
    renderPanel();
  }

  async function togglePhraseSaved(): Promise<void> {
    if (!activeSelection || !result || !context || savePending) return;
    savePending = true;
    renderPanel();
    const removingId = savedPhraseId;
    try {
      if (removingId) {
        await saveSavedPhrases(removeSavedPhrase(await loadSavedPhrases(), removingId));
        savedPhraseId = null;
      } else {
        const record: SavedPhrase = {
          id: crypto.randomUUID(),
          provider: result.provider,
          savedAt: new Date().toISOString(),
          sourceLanguage: result.detectedSourceLanguage ?? context.sourceLanguage,
          sourceText: activeSelection.text,
          targetLanguage: result.targetLanguage,
          translatedText: result.translatedText,
        };
        await savePhrase(record);
        savedPhraseId = record.id;
      }
    } catch {
      // Storage refused the write. The button simply returns to its previous state.
    } finally {
      savePending = false;
      renderPanel();
    }
  }

  function persistPreferenceChange(
    change: (preferences: PopupPreferences) => PopupPreferences,
  ): Promise<void> {
    const next = preferenceWrite
      .catch(() => undefined)
      .then(async () => {
        const preferences = await loadPopupPreferences().catch(() => DEFAULT_POPUP_PREFERENCES);
        await savePopupPreferences(change(preferences));
      });
    preferenceWrite = next;
    return next.catch(() => undefined);
  }

  async function savePreferredTarget(targetLanguage: string): Promise<void> {
    await persistPreferenceChange((preferences) => ({ ...preferences, targetLanguage }));
  }

  async function loadContext(): Promise<TranslationContext> {
    const [preferences, consent, storedCatalogue, service] = await Promise.all([
      loadPopupPreferences().catch(() => DEFAULT_POPUP_PREFERENCES),
      loadOnlineProviderConsent().catch(() => null),
      loadCachedCapabilityCatalogue().catch(() => null),
      gatewayClient.inspectService(),
    ]);
    let catalogue =
      storedCatalogue &&
      ((service.version.translationMode === "live" && storedCatalogue.source !== "fake") ||
        (service.version.translationMode === "fake" && storedCatalogue.source === "fake"))
        ? storedCatalogue
        : null;
    try {
      const fetchedCatalogue = await gatewayClient.getCapabilities();
      if (!isCurrentCapabilityCatalogue(fetchedCatalogue)) {
        throw new Error("The gateway is serving an outdated language catalogue.");
      }
      catalogue = fetchedCatalogue;
      await saveCachedCapabilityCatalogue(fetchedCatalogue).catch(() => undefined);
    } catch {
      if (!catalogue) throw new Error("Language availability could not be loaded.");
    }
    const languages = catalogueToPreviewLanguages(catalogue);
    const source = resolveSelectionSource(activeSelection?.text ?? "", catalogue);
    const targetLanguage = chooseSelectionTargetLanguage(
      catalogue,
      preferences.targetLanguage,
      source.code,
    );
    return {
      catalogue,
      consent,
      favouriteLanguageCodes: preferences.favouriteLanguageCodes,
      gatewayMode: service.version.translationMode,
      languages,
      requestText: source.romanizedNepali?.text ?? activeSelection?.text ?? "",
      romanizedNepali: Boolean(source.romanizedNepali),
      sourceAssumed: source.assumed,
      sourceLanguage: source.code,
      targetLanguage,
    };
  }

  /** Loads languages and checks the pair. Only `translateNow` callers have already asked to translate. */
  async function prepareTranslation(
    sensitiveConfirmed: boolean,
    translateNow = false,
  ): Promise<void> {
    if (!activeSelection) return;
    if (!sensitiveConfirmed) {
      sensitiveKind = detectSensitiveSelection(activeSelection.text);
      if (sensitiveKind) {
        state = "sensitive";
        renderPanel();
        return;
      }
    }
    state = "preparing";
    renderPanel();
    try {
      context = await loadContext();
      await savePreferredTarget(context.targetLanguage);
      if (context.gatewayMode === "live" && !context.consent) {
        state = "consent";
        renderPanel();
        return;
      }
      if (!isTranslatablePair()) {
        state = "unsupported-pair";
        renderPanel();
        return;
      }
      if (translateNow) {
        await runTranslation();
        return;
      }
      state = "ready";
      renderPanel();
    } catch (error) {
      state = "error";
      errorMessage = error instanceof Error ? error.message : "Translation could not be prepared.";
      errorRetryable = true;
      renderPanel();
    }
  }

  async function acceptConsentAndTranslate(): Promise<void> {
    if (!context) return;
    try {
      context.consent = await acceptOnlineProviderConsent();
      await runTranslation();
    } catch {
      state = "error";
      errorMessage = "Online consent could not be saved. The selected text was not sent.";
      errorRetryable = false;
      renderPanel();
    }
  }

  async function runTranslation(): Promise<void> {
    if (!activeSelection || !context) return;
    if (context.gatewayMode === "live" && !context.consent) {
      state = "consent";
      renderPanel();
      return;
    }
    if (!isTranslatablePair()) {
      state = "unsupported-pair";
      renderPanel();
      return;
    }
    requestSequence += 1;
    const sequence = requestSequence;
    requestController?.abort();
    requestController = new AbortController();
    savedPhraseId = null;
    copyFeedback = null;
    replaceFeedback = null;
    resetExplanation();
    resetWordUnderstanding();
    state = "loading";
    renderPanel();
    const request: TranslationRequest = {
      consent: context.gatewayMode === "live" ? (context.consent as OnlineConsent) : FAKE_CONSENT,
      operation: "translate",
      requestId: crypto.randomUUID(),
      sourceLanguage: context.sourceLanguage,
      targetLanguage: context.targetLanguage,
      text: context.requestText,
    };
    try {
      const translated = await gatewayClient.translate(request, requestController.signal);
      if (sequence !== requestSequence) return;
      result = translated;
      if (translated.detectedSourceLanguage) {
        context.sourceLanguage = translated.detectedSourceLanguage;
        context.sourceAssumed = false;
      }
      if (translated.detectedSourceLanguage === translated.targetLanguage) {
        result = null;
        state = "needs-target";
        renderPanel();
        return;
      }
      state = "success";
      renderPanel();
    } catch (error) {
      if (sequence !== requestSequence) return;
      state = "error";
      errorMessage =
        error instanceof GatewayClientError
          ? error.message
          : error instanceof DOMException && error.name === "AbortError"
            ? "Translation stopped. Your selected text was not saved."
            : "Translation failed. Your selected text is still on the page.";
      errorRetryable =
        error instanceof GatewayClientError ? error.retryable : !(error instanceof DOMException);
      renderPanel();
    } finally {
      if (sequence === requestSequence) requestController = null;
    }
  }

  async function activate(): Promise<void> {
    if (!activeSelection || state !== "icon") return;
    state = "preparing";
    renderPanel();
    await prepareTranslation(false);
  }

  function acceptSelection(selection: CapturedSelection, openImmediately: boolean): void {
    close();
    activeSelection = selection;
    lastFingerprint = selection.fingerprint;
    setExpiry();
    if (openImmediately) {
      state = "preparing";
      renderPanel();
      void prepareTranslation(false);
    } else {
      renderIcon();
    }
  }

  function inspectSelection(providedText?: string, openImmediately = false): void {
    const selection = captureSelection(lastFingerprint, providedText);
    if (!selection) {
      if (providedText === undefined && state === "icon") close();
      return;
    }
    acceptSelection(selection, openImmediately);
  }

  function scheduleInspection(): void {
    if (!observerEnabled) return;
    if (stabilityTimer !== null) window.clearTimeout(stabilityTimer);
    stabilityTimer = window.setTimeout(() => {
      stabilityTimer = null;
      inspectSelection();
    }, SELECTION_MAGIC_STABILITY_MS);
  }

  function eventInsideSurface(event: Event): boolean {
    return event.composedPath().includes(host as EventTarget);
  }

  function onPointerDown(event: PointerEvent): void {
    if (host && eventInsideSurface(event)) return;
    if (state !== null) close();
  }

  function onPointerUp(event: PointerEvent): void {
    if (host && eventInsideSurface(event)) return;
    scheduleInspection();
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (host && eventInsideSurface(event)) return;
    scheduleInspection();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }

  function enableObserver(): void {
    if (observerEnabled) return;
    observerEnabled = true;
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
  }

  function disableObserver(): void {
    observerEnabled = false;
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    close();
  }

  const messageListener = (
    message: unknown,
    sender: Browser.runtime.MessageSender,
    sendResponse: (response: { ok: boolean }) => void,
  ) => {
    if (sender.id !== browser.runtime.id) return undefined;
    const parsed = parseSelectionMagicMessage(message);
    if (!parsed) return undefined;
    if (parsed.type === "lingobridge:selection-magic:ping") {
      sendResponse({ ok: true });
      return undefined;
    }
    if (parsed.type === "lingobridge:selection-magic:disable") {
      disableObserver();
      sendResponse({ ok: true });
      return undefined;
    }
    if (parsed.type === "lingobridge:selection-magic:translate") {
      inspectSelection(parsed.text, true);
      sendResponse({ ok: true });
      return undefined;
    }
    if (parsed.type === "lingobridge:selection-magic:reconcile") {
      loadSelectionMagicSettings().then(
        (settings) => {
          if (settings.enabled && !settings.disabledOrigins.includes(location.origin)) {
            enableObserver();
          } else {
            disableObserver();
          }
          sendResponse({ ok: true });
        },
        () => sendResponse({ ok: false }),
      );
      return true;
    }
    return undefined;
  };
  browser.runtime.onMessage.addListener(messageListener);

  void loadSelectionMagicSettings()
    .then((settings) => {
      if (settings.enabled && !settings.disabledOrigins.includes(location.origin)) enableObserver();
    })
    .catch(() => undefined);

  return {
    destroy() {
      disableObserver();
      browser.runtime.onMessage.removeListener(messageListener);
      window.__lingobridgeSelectionController = undefined;
    },
    translate(text) {
      inspectSelection(text, true);
    },
  };
}

export default defineContentScript({
  registration: "runtime",
  runAt: "document_idle",
  noScriptStartedPostMessage: true,
  main(ctx) {
    if (window.__lingobridgeSelectionController) return;
    const controller = createController();
    window.__lingobridgeSelectionController = controller;
    ctx.onInvalidated(() => controller.destroy());
  },
});
