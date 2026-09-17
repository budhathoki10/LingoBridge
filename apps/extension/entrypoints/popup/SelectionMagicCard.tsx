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

/**
 * Compact site-access row. It is the only surface that asks Chrome for webpage access, and it keeps
 * the per-site disable and global turn-off (with permission revocation) that ADR-002 requires.
 * Chrome's own pages cannot be granted, so the row is hidden there.
 */
export function SelectionMagicCard() {
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await readState());
    } catch {
      setState({ kind: "error", message: "Site access could not be checked." });
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
    }, "Chrome didn’t grant access to this site.");
  }

  function disableCurrentSite(): void {
    if (state.kind !== "ready" || !state.currentOrigin) return;
    void apply(
      () =>
        saveSelectionMagicSettings({
          disabledOrigins: [...state.settings.disabledOrigins, state.currentOrigin as string],
          enabled: state.settings.enabled,
        }).then(() => undefined),
      "This site couldn’t be disabled.",
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
    }, "Selection Magic couldn’t be turned off completely.");
  }

  if (state.kind === "loading") return null;

  if (state.kind === "error") {
    return (
      <section className="card card--danger site-access site-access--error">
        <span aria-hidden="true" className="site-access__icon site-access__icon--off">
          <SparkIcon size={18} />
        </span>
        <p className="site-access__label" role="alert">
          {state.message}
        </p>
        <button className="btn" disabled={busy} onClick={() => void refresh()} type="button">
          Retry
        </button>
      </section>
    );
  }

  if (!state.currentOrigin) return null;

  const currentDisabled = state.settings.disabledOrigins.includes(state.currentOrigin);
  const readyHere = state.settings.enabled && state.currentSiteGranted && !currentDisabled;

  return (
    <section aria-label="Selection Magic" className="card site-access">
      <span
        aria-hidden="true"
        className={`site-access__icon${readyHere ? "" : " site-access__icon--off"}`}
      >
        <SparkIcon size={18} />
      </span>
      <p className="site-access__label">
        <strong>Selection Magic</strong>
        <span>{readyHere ? "On for this site" : "Off for this site"}</span>
      </p>
      {readyHere ? (
        <button className="btn" disabled={busy} onClick={disableCurrentSite} type="button">
          Disable here
        </button>
      ) : (
        <button
          className="btn btn--primary"
          disabled={busy}
          onClick={enableCurrentSite}
          type="button"
        >
          Enable here
        </button>
      )}
      {state.settings.enabled ? (
        <div className="site-access__footer">
          <button className="btn btn--link" disabled={busy} onClick={turnOff} type="button">
            Turn off everywhere
          </button>
        </div>
      ) : null}
    </section>
  );
}
