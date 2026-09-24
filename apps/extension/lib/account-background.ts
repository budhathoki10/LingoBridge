import { EXTENSION_CONNECT_PATH } from "@lingobridge/contracts/account";
import {
  buildConnectUrl,
  createAccountClient,
  createPkcePair,
  parseAuthorizationRedirect,
  randomUrlSafe,
} from "./account-client";
import { indexedDbCredentialStore } from "./account-credentials";
import {
  ACCOUNT_STATUS_STORAGE_KEY,
  type AccountMessageResult,
  type AccountMessageType,
  normalizeAccountStatus,
} from "./account-status";
import { DASHBOARD_ORIGIN } from "./dashboard-config";
import { acceptOnlineProviderConsent } from "./online-consent";
import { SAVED_PHRASES_STORAGE_KEY } from "./saved-phrases";
import { createSyncService } from "./sync-service";

export const SYNC_ALARM = "lingobridge-sync-retry";
export const PERIODIC_SYNC_ALARM = "lingobridge-sync-periodic";

/** What one Connect click knows about Chrome's sign-in window, used to find it again on Retry. */
interface ConnectionWindow {
  /** Popup windows that already existed, so the sign-in window can be told apart from them. */
  baseline: Set<number> | null;
  redirectUri: string;
  /** Chrome's sign-in window, recorded when it opens. It keeps this id through Google's pages. */
  windowId: number | null;
}

let connectionAttempt: Promise<void> | null = null;
/** Bumped when an attempt is abandoned, so its late result cannot overwrite the new attempt. */
let connectionGeneration = 0;
let connectionWindow: ConnectionWindow | null = null;
let staleStatusCleared: Promise<void> = Promise.resolve();

function isConcurrentAuthFlow(error: unknown): boolean {
  return (
    error instanceof Error && /Only one web auth flow is allowed at a time\.?/iu.test(error.message)
  );
}

function belongsToThisConnection(window: Browser.windows.Window, redirectUri: string): boolean {
  if (window.type !== "popup" || typeof window.id !== "number") return false;
  return (window.tabs ?? []).some((tab) => {
    if (!tab.url) return false;
    try {
      const visible = new URL(tab.url);
      if (visible.origin !== DASHBOARD_ORIGIN) return false;
      const request =
        visible.pathname === "/sign-in" && visible.searchParams.get("returnTo")
          ? new URL(visible.searchParams.get("returnTo") ?? "", DASHBOARD_ORIGIN)
          : visible;
      return (
        request.origin === DASHBOARD_ORIGIN &&
        request.pathname === EXTENSION_CONNECT_PATH &&
        request.searchParams.get("redirect_uri") === redirectUri
      );
    } catch {
      return false;
    }
  });
}

/** A reloaded worker can lose its Promise while Chrome still owns its old auth popup. */
async function closeOrphanedConnectionWindow(redirectUri: string): Promise<boolean> {
  const windows = await browser.windows
    .getAll({ populate: true, windowTypes: ["popup"] })
    .catch(() => []);
  const matches = windows.filter((window) => belongsToThisConnection(window, redirectUri));
  if (matches.length !== 1 || typeof matches[0]?.id !== "number") return false;
  return browser.windows.remove(matches[0].id).then(
    () => true,
    () => false,
  );
}

export function dashboardConnectionPending(): boolean {
  return connectionAttempt !== null;
}

/**
 * Finds this attempt's sign-in window: first by the id recorded when it opened, then by the
 * dashboard page it shows, then as the only popup that opened since Connect. Counting popups alone
 * failed whenever another extension or app had a popup open.
 */
async function findConnectionWindow(
  attempt: ConnectionWindow,
): Promise<Browser.windows.Window | null> {
  const windows = await browser.windows
    .getAll({ populate: true, windowTypes: ["popup"] })
    .catch(() => []);
  const recorded = windows.find((window) => window.id === attempt.windowId);
  if (recorded) return recorded;
  const showingConnect = windows.filter((window) =>
    belongsToThisConnection(window, attempt.redirectUri),
  );
  if (showingConnect.length === 1) return showingConnect[0] ?? null;
  const opened = windows.filter(
    (window) => typeof window.id === "number" && !attempt.baseline?.has(window.id),
  );
  return attempt.baseline && opened.length === 1 ? (opened[0] ?? null) : null;
}

/**
 * Retry brings the sign-in window forward. When that window no longer exists the old attempt can
 * never finish, so Retry abandons it and opens a fresh window instead of leaving the user stuck.
 */
export async function focusDashboardConnection(): Promise<AccountMessageResult> {
  const attempt = connectionWindow;
  if (!attempt) {
    return {
      message: "The connection window is still opening or finishing. Try again shortly.",
      ok: false,
    };
  }

  const window = await findConnectionWindow(attempt);
  if (!window || typeof window.id !== "number") {
    connectionGeneration += 1;
    connectionAttempt = null;
    connectionWindow = null;
    startDashboardConnection();
    return { message: null, ok: true };
  }
  await browser.windows.update(
    window.id,
    window.state === "minimized" ? { focused: true, state: "normal" } : { focused: true },
  );
  return { message: null, ok: true };
}

async function updateConnectionStatus(
  connection: "connecting" | "disconnected",
  error: string | null,
) {
  const stored = await browser.storage.local.get(ACCOUNT_STATUS_STORAGE_KEY);
  const current = normalizeAccountStatus(stored[ACCOUNT_STATUS_STORAGE_KEY]);
  await browser.storage.local.set({
    [ACCOUNT_STATUS_STORAGE_KEY]: {
      ...current,
      connection,
      lastError: error,
    },
  });
}

/**
 * A worker that starts fresh has no attempt in flight, so a stored "connecting" status is left
 * over from a worker Chrome stopped mid-connection. Without this the popup kept asking the user to
 * finish in a sign-in window that no longer belonged to anything.
 */
export function clearStaleConnectionStatus(): Promise<void> {
  staleStatusCleared = (async () => {
    const stored = await browser.storage.local.get(ACCOUNT_STATUS_STORAGE_KEY);
    const current = normalizeAccountStatus(stored[ACCOUNT_STATUS_STORAGE_KEY]);
    if (current.connection === "connecting" && !connectionAttempt) {
      await updateConnectionStatus("disconnected", null);
    }
  })().catch(() => undefined);
  return staleStatusCleared;
}

/** The popup can close when Chrome opens the identity window; the worker owns the whole attempt. */
export function startDashboardConnection(): void {
  if (connectionAttempt) return;
  const generation = ++connectionGeneration;
  const current = () => generation === connectionGeneration;
  connectionAttempt = (async () => {
    // The startup cleanup must not overwrite the "connecting" status written below.
    await staleStatusCleared;
    await updateConnectionStatus("connecting", null);
    const result = await connectDashboard();
    if (!result.ok && current()) {
      await updateConnectionStatus("disconnected", result.message);
    }
  })()
    .catch(async () => {
      if (!current()) return;
      await updateConnectionStatus(
        "disconnected",
        "The connection couldn’t be completed. Try again.",
      ).catch(() => undefined);
    })
    .finally(() => {
      if (current()) connectionAttempt = null;
    });
}

export const accountClient = createAccountClient({
  credentials: indexedDbCredentialStore,
  dashboardOrigin: DASHBOARD_ORIGIN,
});

export const syncService = createSyncService({
  client: accountClient,
  hasCredentials: async () => (await indexedDbCredentialStore.load()) !== null,
  newId: () => crypto.randomUUID(),
  now: () => new Date(),
  scheduleAt: async (when) => {
    await browser.alarms.clear(SYNC_ALARM);
    if (when)
      browser.alarms.create(SYNC_ALARM, { when: Math.max(Date.now() + 1_000, when.getTime()) });
  },
  storage: {
    get: (keys) => browser.storage.local.get(keys),
    set: (items) => browser.storage.local.set(items),
  },
});

async function deviceLabel(): Promise<string> {
  const names: Record<string, string> = {
    android: "Android",
    cros: "ChromeOS",
    linux: "Linux",
    mac: "macOS",
    win: "Windows",
  };
  try {
    const { os } = await browser.runtime.getPlatformInfo();
    return `Chrome on ${names[os] ?? "desktop"}`;
  } catch {
    return "Chrome";
  }
}

/**
 * Starts only from an explicit click in the popup. Chrome opens the dashboard's consent page in
 * its identity window; the code comes back to the extension's chromiumapp.org redirect, and is
 * exchanged with the PKCE verifier, which never left this worker.
 */
export async function connectDashboard(): Promise<AccountMessageResult> {
  const redirectUri = browser.identity.getRedirectURL("lingobridge");
  const state = randomUrlSafe(32);
  const pkce = await createPkcePair();
  const url = buildConnectUrl({
    challenge: pkce.challenge,
    dashboardOrigin: DASHBOARD_ORIGIN,
    deviceLabel: await deviceLabel(),
    redirectUri,
    state,
  });

  let responseUrl: string | undefined;
  const attempt: ConnectionWindow = {
    baseline: await browser.windows
      .getAll({ windowTypes: ["normal", "popup"] })
      .then(
        (windows) =>
          new Set(
            windows.map((window) => window.id).filter((id): id is number => typeof id === "number"),
          ),
      )
      .catch(() => null),
    redirectUri,
    windowId: null,
  };
  connectionWindow = attempt;
  let identityWindowAppeared = false;
  const onWindowCreated = (window: Browser.windows.Window) => {
    if (
      window.type !== "popup" ||
      typeof window.id !== "number" ||
      attempt.baseline?.has(window.id)
    )
      return;
    identityWindowAppeared = true;
    attempt.windowId ??= window.id;
    // Chrome can create the identity popup behind the active browser window. Surface it as soon
    // as it exists; the toolbar popup itself will close when the focus moves.
    void browser.windows.update(window.id, { focused: true }).catch(() => undefined);
  };
  browser.windows.onCreated.addListener(onWindowCreated);
  try {
    try {
      responseUrl = await browser.identity.launchWebAuthFlow({ interactive: true, url });
    } catch (error) {
      if (!isConcurrentAuthFlow(error) || !(await closeOrphanedConnectionWindow(redirectUri))) {
        throw error;
      }
      // Removing the old window ends Chrome's previous flow. Give that callback a turn to release
      // Chrome's single auth slot before opening a fresh window with this attempt's PKCE state.
      await new Promise((resolve) => setTimeout(resolve, 100));
      responseUrl = await browser.identity.launchWebAuthFlow({ interactive: true, url });
    }
  } catch (error) {
    if (isConcurrentAuthFlow(error)) {
      return {
        message:
          "An earlier Chrome sign-in is still active. Close its window, or fully exit and reopen Chrome, then connect again.",
        ok: false,
      };
    }
    // Chrome's rejection text can distinguish a blocked popup from a cancelled flow. Store only
    // short plain text; never persist a URL, query string, or authorization value.
    const reported = error instanceof Error ? error.message.trim() : "";
    const safeReason = /^[A-Za-z0-9 ,.'():!/-]{1,120}$/u.test(reported) ? reported : null;
    const summary = identityWindowAppeared
      ? "Chrome ended the sign-in flow before it finished."
      : "Chrome could not open the sign-in window.";
    return {
      message: safeReason ? `${summary} Chrome reported: ${safeReason}` : `${summary} Try again.`,
      ok: false,
    };
  } finally {
    browser.windows.onCreated.removeListener(onWindowCreated);
    if (connectionWindow === attempt) connectionWindow = null;
  }

  const redirect = parseAuthorizationRedirect(responseUrl, redirectUri, state);
  if (redirect.kind === "denied") return { message: "Connection cancelled.", ok: false };
  if (redirect.kind === "invalid")
    return { message: "The dashboard response couldn’t be verified. Try again.", ok: false };

  try {
    const tokens = await accountClient.exchangeCode({
      code: redirect.code,
      codeVerifier: pkce.verifier,
      redirectUri,
    });
    await syncService.markConnected(tokens.account);
    if (redirect.onlineConsentAccepted) {
      // The signed-in approval page showed this exact disclosure version. A storage failure keeps
      // the existing first-translation consent fallback instead of weakening the send boundary.
      await acceptOnlineProviderConsent().catch(() => undefined);
    }
    browser.alarms.create(PERIODIC_SYNC_ALARM, { periodInMinutes: 15 });
    void syncService.run();
    return { message: null, ok: true };
  } catch {
    return { message: "The connection couldn’t be completed. Try again.", ok: false };
  }
}

export async function handleAccountMessage(
  type: Exclude<AccountMessageType, "lingobridge:account:connect">,
): Promise<AccountMessageResult> {
  switch (type) {
    case "lingobridge:account:sync-now": {
      const outcome = await syncService.run();
      return outcome === "synced"
        ? { message: null, ok: true }
        : {
            message:
              outcome === "revoked"
                ? "This extension was disconnected."
                : "Sync didn’t finish. It will retry.",
            ok: false,
          };
    }
    case "lingobridge:account:disconnect":
      await accountClient.disconnect();
      await browser.alarms.clear(PERIODIC_SYNC_ALARM);
      await syncService.markDisconnected();
      return { message: null, ok: true };
    case "lingobridge:account:keep-local":
      await indexedDbCredentialStore.clear();
      await browser.alarms.clear(PERIODIC_SYNC_ALARM);
      await syncService.markDisconnected();
      return { message: null, ok: true };
    case "lingobridge:account:delete-local":
      await indexedDbCredentialStore.clear();
      await browser.alarms.clear(PERIODIC_SYNC_ALARM);
      await browser.storage.local.set({ [SAVED_PHRASES_STORAGE_KEY]: [] });
      await syncService.markDisconnected();
      return { message: null, ok: true };
  }
}
