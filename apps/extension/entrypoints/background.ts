import {
  GATEWAY_BRIDGE_PORT,
  type GatewayBridgeRequest,
  type GatewayBridgeResponse,
  parseGatewayBridgeRequest,
  toGatewayBridgeFailure,
} from "../lib/gateway-bridge";
import { gatewayClient } from "../lib/gateway-client";
import { GATEWAY_ORIGIN } from "../lib/gateway-config";
import {
  buildSelectionRegistration,
  grantsWebpageAccess,
  loadSelectionMagicSettings,
  parseSelectionMagicMessage,
  saveSelectionMagicSettings,
  SELECTION_MAGIC_CONTENT_SCRIPT_ID,
  type SelectionMagicMessage,
  selectionRegistrationMatches,
} from "../lib/selection-magic";

const CONTENT_SCRIPT_FILE = "/content-scripts/selection.js";
const CONTEXT_MENU_ID = "lingobridge-translate-selection";
const TRANSLATE_COMMAND = "translate-selection";

async function broadcast(message: SelectionMagicMessage): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.flatMap((tab) =>
      typeof tab.id === "number"
        ? [browser.tabs.sendMessage(tab.id, message).catch(() => undefined)]
        : [],
    ),
  );
}

function tabMatchesRegistration(
  url: string | undefined,
  registration: { excludeMatches: string[]; matches: string[] },
): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const exactPattern = `${parsed.origin}/*`;
  const broadPattern = `${parsed.protocol}//*/*`;
  return (
    (registration.matches.includes(exactPattern) || registration.matches.includes(broadPattern)) &&
    !registration.excludeMatches.includes(exactPattern)
  );
}

async function activateCurrentTabs(registration: {
  excludeMatches: string[];
  matches: string[];
}): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.flatMap((tab) => {
      const tabId = tab.id;
      if (typeof tabId !== "number" || !tabMatchesRegistration(tab.url, registration)) return [];
      // Injecting over a live content script makes WXT invalidate the running one, which destroys
      // an open panel mid-translation. Ping first and inject only when nothing answers.
      return [
        ensureSelectionScript(tabId)
          .then(() =>
            browser.tabs.sendMessage(tabId, {
              type: "lingobridge:selection-magic:reconcile",
            }),
          )
          .catch(() => undefined),
      ];
    }),
  );
}

export async function reconcileSelectionContentScript(): Promise<void> {
  const [settings, permissions, registrations] = await Promise.all([
    loadSelectionMagicSettings(),
    browser.permissions.getAll(),
    browser.scripting.getRegisteredContentScripts({ ids: [SELECTION_MAGIC_CONTENT_SCRIPT_ID] }),
  ]);
  const desired = buildSelectionRegistration(settings, permissions.origins ?? []);
  const registered = registrations[0];

  if (!desired) {
    if (registered) {
      await broadcast({ type: "lingobridge:selection-magic:disable" });
      await browser.scripting.unregisterContentScripts({
        ids: [SELECTION_MAGIC_CONTENT_SCRIPT_ID],
      });
    }
    return;
  }

  const definition: Browser.scripting.RegisteredContentScript = {
    allFrames: true,
    excludeMatches: desired.excludeMatches,
    id: SELECTION_MAGIC_CONTENT_SCRIPT_ID,
    js: [CONTENT_SCRIPT_FILE],
    matches: desired.matches,
    persistAcrossSessions: true,
    runAt: "document_idle",
    world: "ISOLATED",
  };

  if (registered) {
    // The worker restarts on every wake, including the gateway call behind an open panel. Sending
    // `disable` when nothing changed tears that panel down mid-translation, so re-register only
    // when the matches actually differ.
    if (selectionRegistrationMatches(registered, desired)) return;
    await broadcast({ type: "lingobridge:selection-magic:disable" });
    await browser.scripting.updateContentScripts([definition]);
    await activateCurrentTabs(desired);
    return;
  }

  await browser.scripting.registerContentScripts([definition]);
  await activateCurrentTabs(desired);
}

async function ensureSelectionScript(tabId: number, frameId?: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(
      tabId,
      { type: "lingobridge:selection-magic:ping" },
      frameId === undefined ? undefined : { frameId },
    );
    return;
  } catch {
    await browser.scripting.executeScript({
      files: [CONTENT_SCRIPT_FILE],
      target: {
        frameIds: frameId === undefined ? undefined : [frameId],
        tabId,
      },
      world: "ISOLATED",
    });
  }
}

async function translateInTab(tabId: number, text?: string, frameId?: number): Promise<void> {
  await ensureSelectionScript(tabId, frameId);
  await browser.tabs.sendMessage(
    tabId,
    { text, type: "lingobridge:selection-magic:translate" },
    frameId === undefined ? undefined : { frameId },
  );
}

async function enableAfterWebpageGrant(origins: readonly string[]): Promise<void> {
  if (!grantsWebpageAccess(origins, GATEWAY_ORIGIN)) return;
  const settings = await loadSelectionMagicSettings();
  if (settings.enabled) return;
  await saveSelectionMagicSettings({ ...settings, enabled: true });
}

async function runGatewayBridgeRequest(
  request: GatewayBridgeRequest,
  controller: AbortController,
): Promise<GatewayBridgeResponse> {
  try {
    if (request.operation === "capabilities") {
      return { data: await gatewayClient.getCapabilities(controller.signal), ok: true };
    }
    if (request.operation === "inspect-service") {
      return { data: await gatewayClient.inspectService(controller.signal), ok: true };
    }
    if (!request.request) {
      return {
        aborted: false,
        error: {
          code: "invalid-request",
          message: "The translation request did not match the shared contract.",
          retryable: false,
        },
        ok: false,
      };
    }
    return { data: await gatewayClient.translate(request.request, controller.signal), ok: true };
  } catch (error) {
    if (controller.signal.aborted) return { aborted: true, ok: false };
    return { aborted: false, error: toGatewayBridgeFailure(error), ok: false };
  }
}

/**
 * The content script reaches the gateway through here. Chrome gives a content-script fetch the
 * page's origin, which the gateway rejects, so the call has to be made from the extension origin.
 * A port carries it rather than sendMessage: the reply arrives as a plain message, with no
 * dependence on how a given Chrome build treats a listener's return value, and a disconnected
 * port cancels the request.
 */
function serveGatewayBridgePort(port: Browser.runtime.Port): void {
  if (port.sender?.id !== browser.runtime.id) {
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  let answered = false;
  port.onDisconnect.addListener(() => {
    if (!answered) controller.abort();
  });
  port.onMessage.addListener((message) => {
    const request = parseGatewayBridgeRequest(message);
    if (!request) {
      answered = true;
      port.postMessage({
        aborted: false,
        error: {
          code: "invalid-request",
          message: "The translation request did not match the shared contract.",
          retryable: false,
        },
        ok: false,
      } satisfies GatewayBridgeResponse);
      port.disconnect();
      return;
    }
    void runGatewayBridgeRequest(request, controller).then((response) => {
      answered = true;
      try {
        port.postMessage(response);
        port.disconnect();
      } catch {
        // The page went away while the gateway was answering.
      }
    });
  });
}

function createContextMenu(): void {
  browser.contextMenus.create(
    {
      contexts: ["selection"],
      id: CONTEXT_MENU_ID,
      title: "Translate selection with LingoBridge",
    },
    () => void browser.runtime.lastError,
  );
}

export default defineBackground(() => {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === GATEWAY_BRIDGE_PORT) serveGatewayBridgePort(port);
  });

  createContextMenu();
  void reconcileSelectionContentScript().catch(() => undefined);

  browser.runtime.onInstalled.addListener(() => {
    createContextMenu();
    void reconcileSelectionContentScript().catch(() => undefined);
  });

  browser.runtime.onStartup.addListener(() => {
    void reconcileSelectionContentScript().catch(() => undefined);
  });

  // Chrome can close the popup while its own permission prompt is open, which used to leave the
  // grant in place and the stored flag off. Turning it on here keeps the two together no matter
  // where the user granted access from.
  browser.permissions.onAdded.addListener((permissions) => {
    void enableAfterWebpageGrant(permissions.origins ?? [])
      .catch(() => undefined)
      .then(() => reconcileSelectionContentScript())
      .catch(() => undefined);
  });

  browser.permissions.onRemoved.addListener(() => {
    void reconcileSelectionContentScript().catch(() => undefined);
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.lingobridgeSelectionMagic) {
      void reconcileSelectionContentScript().catch(() => undefined);
    }
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || typeof tab?.id !== "number") return;
    void translateInTab(tab.id, info.selectionText, info.frameId).catch(() => undefined);
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== TRANSLATE_COMMAND) return;
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => (typeof tab?.id === "number" ? translateInTab(tab.id) : Promise.resolve()))
      .catch(() => undefined);
  });

  // Chrome never resolves sendMessage with a promise returned from a listener. Every answer has
  // to go through sendResponse, with `return true` holding the channel open until it arrives.
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return undefined;

    const parsed = parseSelectionMagicMessage(message);
    if (parsed?.type !== "lingobridge:selection-magic:reconcile") return undefined;
    reconcileSelectionContentScript().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  });
});
