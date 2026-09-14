import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "@playwright/test";

const testsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.resolve(testsDirectory, "../apps/extension/.output/chrome-mv3");

test("the popup receives an account-action reply from the background worker", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    // An extension-owned popup opened as a tab has sender.tab; it must still get a reply.
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const response = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: "lingobridge:account:sync-now" }),
    );
    expect(response).toEqual({ message: "Sync didn’t finish. It will retry.", ok: false });
  } finally {
    await context.close();
  }
});

test("Connect acknowledges the popup and Retry refocuses Chrome identity", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await popup.getByRole("button", { name: "Connect dashboard" }).click();
    await expect(popup.getByRole("button", { name: "Retry connection" })).toBeVisible();
    await expect(
      popup.getByText("Finish in the Chrome sign-in window.", { exact: false }),
    ).toBeVisible();
    await expect(popup.getByText("The extension didn’t respond. Try again.")).toHaveCount(0);

    const isConnectionWindow = (url: string) =>
      url.includes("/extension/connect") || url.includes("returnTo=%2Fextension%2Fconnect");
    await expect
      .poll(() => context.pages().some((page) => isConnectionWindow(page.url())))
      .toBe(true);
    const identityWindow = context.pages().find((page) => isConnectionWindow(page.url()));
    if (!identityWindow) throw new Error("Chrome did not open the dashboard connection window.");
    const identityWindowId = await popup.evaluate(async () => {
      const windows = await chrome.windows.getAll();
      return windows.find((window) => window.type === "popup")?.id;
    });
    if (typeof identityWindowId !== "number") {
      throw new Error("Chrome did not expose the identity popup window.");
    }
    await popup.evaluate(
      (id) => chrome.windows.update(id, { state: "minimized" }),
      identityWindowId,
    );
    await popup.getByRole("button", { name: "Retry connection" }).click();
    await expect
      .poll(() =>
        popup.evaluate(async (id) => (await chrome.windows.get(id)).state, identityWindowId),
      )
      .toBe("normal");
    await expect(popup.getByText("The extension didn’t respond. Try again.")).toHaveCount(0);
    await popup.close();
    await identityWindow.close();

    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(
      reopened.getByText("Chrome ended the sign-in flow before it finished.", { exact: false }),
    ).toBeVisible();
    await expect(reopened.getByRole("button", { name: "Connect dashboard" })).toBeEnabled();
  } finally {
    await context.close();
  }
});

test("Connect from Chrome's actual action popup opens an identity window", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const dashboard = await context.newPage();
    await dashboard.goto("http://127.0.0.1:3000/sign-in");
    const cdp = await context.newCDPSession(dashboard);
    await worker.evaluate(() => chrome.action.openPopup());
    const targets = await cdp.send("Target.getTargets");
    const target = targets.targetInfos.find(
      (item) => item.type === "page" && item.url === `chrome-extension://${extensionId}/popup.html`,
    );
    expect(target).toBeDefined();
    if (!target) return;
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const reply = new Promise<string>((resolve) => {
      cdp.on("Target.receivedMessageFromTarget", (event) => {
        if (event.sessionId === sessionId) resolve(event.message);
      });
    });
    await cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          returnByValue: true,
          expression:
            "(() => { const button = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Connect dashboard')); button?.click(); return { found: !!button, buttons: [...document.querySelectorAll('button')].map((button) => button.textContent) }; })()",
        },
      }),
    });
    const result = await reply;
    expect(JSON.parse(result).result?.result?.value?.found).toBe(true);
    await expect
      .poll(() =>
        worker.evaluate(
          async () => (await chrome.windows.getAll({ windowTypes: ["popup"] })).length > 0,
        ),
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});

test("a rejected Chrome identity launch reports that no window opened", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(() => {
      chrome.identity.launchWebAuthFlow = (() => {
        throw new Error("Cannot create a new window");
      }) as typeof chrome.identity.launchWebAuthFlow;
    });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole("button", { name: "Connect dashboard" }).click();
    await expect(
      popup.getByText(
        "Chrome could not open the sign-in window. Chrome reported: Cannot create a new window",
      ),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("Connect replaces an orphaned Chrome identity flow for this extension", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const oldUrl = new URL("http://127.0.0.1:3000/extension/connect");
    oldUrl.searchParams.set("redirect_uri", `https://${extensionId}.chromiumapp.org/lingobridge`);
    oldUrl.searchParams.set("code_challenge", "A".repeat(43));
    oldUrl.searchParams.set("code_challenge_method", "S256");
    oldUrl.searchParams.set("state", "B".repeat(43));
    oldUrl.searchParams.set("device_label", "Chrome");
    await worker.evaluate((url) => {
      void chrome.identity.launchWebAuthFlow({ interactive: true, url }).catch(() => undefined);
    }, oldUrl.toString());
    await expect
      .poll(() =>
        worker.evaluate(
          async () => (await chrome.windows.getAll({ windowTypes: ["popup"] })).length,
        ),
      )
      .toBe(1);
    const [oldWindow] = await worker.evaluate(() =>
      chrome.windows.getAll({ windowTypes: ["popup"] }),
    );
    expect(oldWindow?.id).toBeDefined();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole("button", { name: "Connect dashboard" }).click();
    await expect
      .poll(() =>
        worker.evaluate(async (oldWindowId) => {
          const windows = await chrome.windows.getAll({ windowTypes: ["popup"] });
          return windows.length === 1 && windows[0]?.id !== oldWindowId ? windows[0]?.id : null;
        }, oldWindow?.id),
      )
      .not.toBeNull();
    await expect(
      popup.getByText("Finish in the Chrome sign-in window.", { exact: false }),
    ).toBeVisible();
    await expect(
      popup.getByText("An earlier Chrome sign-in is still active.", { exact: false }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
