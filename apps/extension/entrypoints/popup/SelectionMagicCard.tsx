import { useCallback, useEffect, useState } from "react";
import { GATEWAY_ORIGIN } from "../../lib/gateway-config";
import {
  ALL_SITE_PATTERNS,
  DEFAULT_SELECTION_MAGIC_SETTINGS,
  isPageMatchPattern,
  loadSelectionMagicSettings,
  originToMatchPattern,
  pageOriginFromUrl,
  saveSelectionMagicSettings,
  type SelectionMagicSettings,
} from "../../lib/selection-magic";
import { SparkIcon } from "./Icons";

type CardState =
  | { kind: "loading" }
  | {
      allSitesGranted: boolean;
      currentOrigin: string | null;
      currentSiteGranted: boolean;
      settings: SelectionMagicSettings;
      kind: "ready";
    }
  | { kind: "error"; message: string };

async function notifyBackground(): Promise<void> {
  await browser.runtime.sendMessage({ type: "lingobridge:selection-magic:reconcile" });
}

async function getCurrentOrigin(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return pageOriginFromUrl(tab?.url);
}

async function readState(): Promise<Extract<CardState, { kind: "ready" }>> {
  const [settings, permissions, currentOrigin] = await Promise.all([
    loadSelectionMagicSettings(),
    browser.permissions.getAll(),
    getCurrentOrigin(),
  ]);
  const origins = permissions.origins ?? [];
  const currentPattern = currentOrigin ? originToMatchPattern(currentOrigin) : null;
  return {
    allSitesGranted: ALL_SITE_PATTERNS.every((pattern) => origins.includes(pattern)),
    currentOrigin,
    currentSiteGranted: Boolean(
      currentPattern &&
        (origins.includes(currentPattern) ||
          origins.includes(
            new URL(currentOrigin as string).protocol === "http:"
              ? ALL_SITE_PATTERNS[0]
              : ALL_SITE_PATTERNS[1],
          )),
    ),
    kind: "ready",
    settings,
  };
}

export function SelectionMagicCard() {
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await readState());
    } catch {
      setState({ kind: "error", message: "Selection access could not be checked." });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function apply(action: () => Promise<void>, errorMessage: string): Promise<void> {
    setBusy(true);
    try {
      await action();
      await notifyBackground();
      await refresh();
    } catch {
      setState({ kind: "error", message: errorMessage });
    } finally {
      setBusy(false);
    }
  }

  function enableCurrentSite(): void {
    if (state.kind !== "ready" || !state.currentOrigin) return;
    const pattern = originToMatchPattern(state.currentOrigin);
    if (!pattern) return;
    void apply(async () => {
      const granted = await browser.permissions.request({ origins: [pattern] });
      if (!granted) throw new Error("Permission denied");
      await saveSelectionMagicSettings({
        disabledOrigins: state.settings.disabledOrigins.filter(
          (origin) => origin !== state.currentOrigin,
        ),
        enabled: true,
      });
    }, "Chrome did not grant access to this site. Popup translation still works.");
  }

  function enableAllSites(): void {
    if (state.kind !== "ready") return;
    void apply(async () => {
      const granted = await browser.permissions.request({ origins: [...ALL_SITE_PATTERNS] });
      if (!granted) throw new Error("Permission denied");
      await saveSelectionMagicSettings({
        disabledOrigins: state.settings.disabledOrigins,
        enabled: true,
      });
    }, "Chrome did not grant access to all sites. You can enable one site instead.");
  }

  function disableCurrentSite(): void {
    if (state.kind !== "ready" || !state.currentOrigin) return;
    void apply(
      () =>
        saveSelectionMagicSettings({
          disabledOrigins: [...state.settings.disabledOrigins, state.currentOrigin as string],
          enabled: state.settings.enabled,
        }).then(() => undefined),
      "This site could not be disabled.",
    );
  }

  function turnOff(): void {
    if (state.kind !== "ready") return;
    void apply(async () => {
      await saveSelectionMagicSettings(DEFAULT_SELECTION_MAGIC_SETTINGS);
      const permissions = await browser.permissions.getAll();
      const gatewayPattern = originToMatchPattern(GATEWAY_ORIGIN);
      const removable = (permissions.origins ?? []).filter(
        (pattern) => isPageMatchPattern(pattern) && pattern !== gatewayPattern,
      );
      if (removable.length > 0) {
        await browser.permissions.remove({ origins: removable });
      }
    }, "Selection Magic could not be turned off completely.");
  }

  if (state.kind === "loading") {
    return (
      <section aria-busy="true" className="selection-magic-card">
        <span className="selection-magic-card__icon">
          <SparkIcon />
        </span>
        <div>
          <strong>Selection Magic</strong>
          <p>Checking site access…</p>
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="selection-magic-card selection-magic-card--error">
        <span className="selection-magic-card__icon">
          <SparkIcon />
        </span>
        <div>
          <strong>Selection Magic</strong>
          <p>{state.message}</p>
        </div>
        <button disabled={busy} onClick={() => void refresh()} type="button">
          Retry
        </button>
      </section>
    );
  }

  const currentDisabled = Boolean(
    state.currentOrigin && state.settings.disabledOrigins.includes(state.currentOrigin),
  );
  const readyHere = state.settings.enabled && state.currentSiteGranted && !currentDisabled;

  return (
    <section className="selection-magic-card">
      <span className="selection-magic-card__icon">
        <SparkIcon />
      </span>
      <div className="selection-magic-card__copy">
        <strong>Selection Magic</strong>
        <p>
          {!state.currentOrigin
            ? "Unavailable on this Chrome page."
            : readyHere
              ? "Ready here — select text, then click the magic icon."
              : "Show a magic icon beside selected webpage text."}
        </p>
      </div>
      {state.currentOrigin ? (
        <div className="selection-magic-card__actions">
          {readyHere ? (
            <button disabled={busy} onClick={disableCurrentSite} type="button">
              Disable here
            </button>
          ) : (
            <button disabled={busy} onClick={enableCurrentSite} type="button">
              {currentDisabled ? "Enable here" : "Enable this site"}
            </button>
          )}
          {!state.allSitesGranted ? (
            <button
              className="selection-magic-card__quiet"
              disabled={busy}
              onClick={enableAllSites}
              type="button"
            >
              All sites
            </button>
          ) : null}
          {state.settings.enabled ? (
            <button
              className="selection-magic-card__quiet"
              disabled={busy}
              onClick={turnOff}
              type="button"
            >
              Turn off
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
