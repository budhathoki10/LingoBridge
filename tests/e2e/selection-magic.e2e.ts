import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  type Request,
  test,
  type Worker,
} from "@playwright/test";

const testsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.resolve(testsDirectory, "../apps/extension/.output/chrome-mv3");
const fixtureUrl = "http://127.0.0.1:8787/v1/health";
const hostSelector = "lingobridge-selection-root";

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function configureSelectionMagic(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      lingobridgeSelectionMagic: { disabledOrigins: [], enabled: true },
      phase2PopupPreferences: {
        favouriteLanguageCodes: ["ne", "en"],
        recentLanguageCodes: [],
        targetLanguage: "ne",
      },
    });
  });
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const registrations = await chrome.scripting.getRegisteredContentScripts();
        return registrations.some(
          (registration) => registration.id === "lingobridge-selection-magic",
        );
      }),
    )
    .toBe(true);
}

/**
 * Counts gateway translation calls. A page-scoped counter must stay at zero: Chrome gives a
 * content-script fetch the page's origin, which the gateway rejects, so the background worker
 * has to make the call instead.
 */
function countTranslateRequests(target: BrowserContext | Page): { value: number } {
  const counter = { value: 0 };
  target.on("request", (request: Request) => {
    if (request.url().endsWith("/v1/translate")) counter.value += 1;
  });
  return counter;
}

async function setAndSelect(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    document.body.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.id = "selection-fixture";
    paragraph.textContent = value;
    document.body.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    paragraph.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, text);
}

async function clickClosedShadowHost(page: Page): Promise<void> {
  const box = await page.locator(hostSelector).boundingBox();
  if (!box) throw new Error("Selection Magic host is not visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

interface ShadowNode {
  attributes?: string[];
  children?: ShadowNode[];
  nodeId: number;
  nodeName: string;
  shadowRoots?: ShadowNode[];
}

function findShadowControl(node: ShadowNode, tag: string, label: string): ShadowNode | null {
  const attributes = node.attributes ?? [];
  const labelIndex = attributes.indexOf("aria-label");
  const ariaLabel = labelIndex >= 0 ? attributes[labelIndex + 1] : null;
  if (node.nodeName.toLowerCase() === tag && ariaLabel === label) return node;
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const found = findShadowControl(child, tag, label);
    if (found) return found;
  }
  return null;
}

async function operateClosedShadowControl(
  page: Page,
  tag: string,
  label: string,
  action: "click" | { select: string },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const node = findShadowControl(root, tag, label);
    if (!node) throw new Error(`Could not find ${label} in the translation panel.`);
    if (action === "click") {
      const { object } = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId });
      await cdp.send("Runtime.callFunctionOn", {
        functionDeclaration: "function() { this.scrollIntoView({ block: 'center' }); }",
        objectId: object.objectId,
      });
      const { model } = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId });
      const quad = model.border;
      const center = (indexes: number[]) =>
        indexes.reduce((sum, index) => {
          const coordinate = quad[index];
          if (coordinate === undefined) throw new Error("The control has no screen position.");
          return sum + coordinate;
        }, 0) / 4;
      await page.mouse.click(center([0, 2, 4, 6]), center([1, 3, 5, 7]));
    } else {
      const { object } = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId });
      await cdp.send("Runtime.callFunctionOn", {
        functionDeclaration:
          "function(value) { this.value = value; this.dispatchEvent(new Event('change', { bubbles: true })); }",
        objectId: object.objectId,
        arguments: [{ value: action.select }],
      });
    }
  } finally {
    await cdp.detach();
  }
}

async function localLanguagePreferences(worker: Worker): Promise<{
  favouriteLanguageCodes: string[];
  targetLanguage: string;
}> {
  return worker.evaluate(async () => {
    const stored = await chrome.storage.local.get("phase2PopupPreferences");
    return stored.phase2PopupPreferences as {
      favouriteLanguageCodes: string[];
      targetLanguage: string;
    };
  });
}

test("favorite targets can be pinned and switched without sending any text", async ({
  browserName: _browserName,
}, testInfo) => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = await extensionWorker(context);
    await configureSelectionMagic(worker);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        phase2PopupPreferences: {
          favouriteLanguageCodes: ["fr", "en"],
          recentLanguageCodes: [],
          targetLanguage: "fr",
        },
      });
    });
    const translateRequests = countTranslateRequests(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 500 });
    await page.goto(fixtureUrl);
    await setAndSelect(page, "Hello, how are you?");
    await expect(page.locator(hostSelector)).toHaveAttribute("data-lingobridge-state", "icon");
    await clickClosedShadowHost(page);
    await expect
      .poll(() => page.locator(hostSelector).getAttribute("data-lingobridge-state"))
      .toMatch(/^(consent|ready)$/u);

    const beforePin = translateRequests.value;
    await operateClosedShadowControl(page, "button", "Remove French from favorites", "click");
    await expect
      .poll(async () => (await localLanguagePreferences(worker)).favouriteLanguageCodes)
      .toEqual(["en"]);
    await operateClosedShadowControl(page, "button", "Add French to favorites", "click");
    await expect
      .poll(async () => (await localLanguagePreferences(worker)).favouriteLanguageCodes)
      .toEqual(["fr", "en"]);
    expect(translateRequests.value).toBe(beforePin);

    await operateClosedShadowControl(page, "summary", "Manage favorite languages", "click");
    await operateClosedShadowControl(page, "input", "Favorite Hindi", "click");
    expect(await page.locator(hostSelector).getAttribute("data-lingobridge-state")).toMatch(
      /^(consent|ready)$/u,
    );
    await operateClosedShadowControl(page, "input", "Favorite Arabic", "click");
    await page.screenshot({ path: testInfo.outputPath("favorite-picker.png") });
    expect(translateRequests.value).toBe(beforePin);
    expect((await localLanguagePreferences(worker)).favouriteLanguageCodes).toEqual(["fr", "en"]);
    await operateClosedShadowControl(page, "button", "Save favorite languages", "click");
    await expect
      .poll(async () => (await localLanguagePreferences(worker)).favouriteLanguageCodes)
      .toEqual(expect.arrayContaining(["fr", "en", "hi", "ar"]));
    expect((await localLanguagePreferences(worker)).favouriteLanguageCodes).toHaveLength(4);
    expect((await localLanguagePreferences(worker)).targetLanguage).toBe("fr");
    expect(translateRequests.value).toBe(beforePin);

    await operateClosedShadowControl(page, "summary", "Manage favorite languages", "click");
    await operateClosedShadowControl(page, "input", "Favorite Hindi", "click");
    await operateClosedShadowControl(page, "input", "Favorite Arabic", "click");
    await operateClosedShadowControl(page, "button", "Save favorite languages", "click");
    await expect
      .poll(async () => (await localLanguagePreferences(worker)).favouriteLanguageCodes)
      .toEqual(expect.arrayContaining(["fr", "en"]));
    expect((await localLanguagePreferences(worker)).favouriteLanguageCodes).toHaveLength(2);
    expect(translateRequests.value).toBe(beforePin);

    await operateClosedShadowControl(page, "select", "Target language", { select: "hi" });
    await expect
      .poll(async () => (await localLanguagePreferences(worker)).targetLanguage)
      .toBe("hi");
    await expect
      .poll(() => page.locator(hostSelector).getAttribute("data-lingobridge-state"))
      .toMatch(/^(consent|ready)$/u);
    const beforeHindiPin = translateRequests.value;
    await operateClosedShadowControl(page, "button", "Add Hindi to favorites", "click");
    await expect
      .poll(async () => (await localLanguagePreferences(worker)).favouriteLanguageCodes)
      .toEqual(expect.arrayContaining(["hi", "fr", "en"]));
    expect((await localLanguagePreferences(worker)).favouriteLanguageCodes).toHaveLength(3);
    expect(translateRequests.value).toBe(beforeHindiPin);
    const bounds = await page.locator(hostSelector).boundingBox();
    expect(bounds).not.toBeNull();
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(312);
    await page.screenshot({ path: testInfo.outputPath("favorite-targets.png") });
    await operateClosedShadowControl(page, "button", "Use French", "click");
    await expect
      .poll(async () => (await localLanguagePreferences(worker)).targetLanguage)
      .toBe("fr");
    expect(translateRequests.value).toBe(beforePin);
    await page.setViewportSize({ width: 190, height: 500 });
    const narrowBounds = await page.locator(hostSelector).boundingBox();
    expect(narrowBounds).not.toBeNull();
    expect((narrowBounds?.x ?? 0) + (narrowBounds?.width ?? 0)).toBeLessThanOrEqual(182);
    await page.screenshot({ path: testInfo.outputPath("favorite-targets-narrow.png") });
    await operateClosedShadowControl(page, "summary", "Manage favorite languages", "click");
    await page.screenshot({ path: testInfo.outputPath("favorite-picker-narrow.png") });
  } finally {
    await context.close();
  }
});

test("select -> magic icon -> click -> preferred-language translation", async ({
  browserName: _browserName,
}, testInfo) => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = await extensionWorker(context);
    await configureSelectionMagic(worker);
    const registered = await worker.evaluate(async () =>
      chrome.scripting.getRegisteredContentScripts(),
    );
    expect(registered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lingobridge-selection-magic",
          matches: expect.arrayContaining(["http://127.0.0.1:8787/*"]),
        }),
      ]),
    );

    const translationRequests = countTranslateRequests(context);
    const page = await context.newPage();
    await page.setViewportSize({ height: 500, width: 320 });
    const pageTranslationRequests = countTranslateRequests(page);
    await page.goto(fixtureUrl);
    await setAndSelect(page, "Hello, how are you?");

    const host = page.locator(hostSelector);
    await expect(host).toHaveAttribute("data-lingobridge-state", "icon");
    expect(translationRequests.value).toBe(0);
    const iconBounds = await host.boundingBox();
    expect(iconBounds).not.toBeNull();
    expect(iconBounds?.x).toBeGreaterThanOrEqual(8);
    expect(iconBounds?.y).toBeGreaterThanOrEqual(8);

    await clickClosedShadowHost(page);
    await expect(host).toHaveAttribute("data-lingobridge-state", "ready");
    expect(translationRequests.value).toBe(0);
    await operateClosedShadowControl(page, "select", "Target language", { select: "hi" });
    await expect(host).toHaveAttribute("data-lingobridge-state", "ready");
    await operateClosedShadowControl(page, "select", "Target language", { select: "ne" });
    expect(translationRequests.value).toBe(0);
    await operateClosedShadowControl(page, "button", "Translate into Nepali", "click");
    await expect(host).toHaveAttribute("data-lingobridge-state", "success");
    await expect(host).toHaveAttribute("data-lingobridge-target", "ne");
    await expect(host).toHaveAttribute("data-lingobridge-provider", "google");
    expect(translationRequests.value).toBe(1);
    expect(pageTranslationRequests.value).toBe(0);
    const panelBounds = await host.boundingBox();
    expect(panelBounds).not.toBeNull();
    expect((panelBounds?.x ?? 0) + (panelBounds?.width ?? 0)).toBeLessThanOrEqual(312);
    expect((panelBounds?.y ?? 0) + (panelBounds?.height ?? 0)).toBeLessThanOrEqual(492);
    await page.screenshot({ path: testInfo.outputPath("selection-success.png") });

    await page.keyboard.press("Escape");
    await expect(host).toHaveCount(0);

    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = `
        lingobridge-selection-root { display: none !important; position: static !important; }
        lingobridge-selection-root * { all: unset !important; }
      `;
      document.head.append(style);
      document.body.style.minHeight = "1800px";
      window.scrollTo(0, 900);
    });
    await setAndSelect(
      page,
      `A long paragraph ${"with preserved words and punctuation. ".repeat(45)}`,
    );
    await expect(host).toHaveAttribute("data-lingobridge-state", "icon");
    await clickClosedShadowHost(page);
    await expect(host).toHaveAttribute("data-lingobridge-state", "ready");
    await operateClosedShadowControl(page, "button", "Translate into Nepali", "click");
    await expect(host).toHaveAttribute("data-lingobridge-state", "success");
    const longPanelBounds = await host.boundingBox();
    expect(longPanelBounds).not.toBeNull();
    expect(longPanelBounds?.x).toBeGreaterThanOrEqual(8);
    expect(longPanelBounds?.y).toBeGreaterThanOrEqual(8);
    expect((longPanelBounds?.x ?? 0) + (longPanelBounds?.width ?? 0)).toBeLessThanOrEqual(312);
    expect((longPanelBounds?.y ?? 0) + (longPanelBounds?.height ?? 0)).toBeLessThanOrEqual(492);
    expect(translationRequests.value).toBe(2);
    expect(pageTranslationRequests.value).toBe(0);
  } finally {
    await context.close();
  }
});

test("a new selection cancels the previous request and replaces the surface", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = await extensionWorker(context);
    await configureSelectionMagic(worker);
    const page = await context.newPage();
    await page.goto(fixtureUrl);
    await setAndSelect(page, "The first selection will be cancelled.");
    const host = page.locator(hostSelector);
    await expect(host).toHaveAttribute("data-lingobridge-state", "icon");
    await clickClosedShadowHost(page);
    await expect(host).toHaveAttribute("data-lingobridge-state", "ready");
    await operateClosedShadowControl(page, "button", "Translate into Nepali", "click");
    await expect(host).toHaveAttribute("data-lingobridge-state", "loading");
    await page.evaluate(() => {
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await setAndSelect(page, "Thank you");
    await expect(host).toHaveAttribute("data-lingobridge-state", "icon");
    await page.waitForTimeout(300);
    await expect(host).toHaveAttribute("data-lingobridge-state", "icon");
    await clickClosedShadowHost(page);
    await expect(host).toHaveAttribute("data-lingobridge-state", "ready");
    await operateClosedShadowControl(page, "button", "Translate into Nepali", "click");
    await expect(host).toHaveAttribute("data-lingobridge-state", "success");
  } finally {
    await context.close();
  }
});

test("forbidden and sensitive selections never send silently", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = await extensionWorker(context);
    await configureSelectionMagic(worker);
    const translationRequests = countTranslateRequests(context);
    const page = await context.newPage();
    await page.goto(fixtureUrl);

    await page.evaluate(() => {
      document.body.replaceChildren();
      const password = document.createElement("input");
      password.type = "password";
      password.value = "never-capture-this";
      document.body.append(password);
      password.focus();
      password.setSelectionRange(0, password.value.length);
      password.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.waitForTimeout(260);
    await expect(page.locator(hostSelector)).toHaveCount(0);

    await setAndSelect(page, "Your verification code is 492810");
    const host = page.locator(hostSelector);
    await expect(host).toHaveAttribute("data-lingobridge-state", "icon");
    await clickClosedShadowHost(page);
    await expect(host).toHaveAttribute("data-lingobridge-state", "sensitive");
    expect(translationRequests.value).toBe(0);

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        lingobridgeSelectionMagic: {
          disabledOrigins: ["http://127.0.0.1:8787"],
          enabled: true,
        },
      });
    });
    await expect(host).toHaveCount(0);
    await setAndSelect(page, "This should not show an icon.");
    await page.waitForTimeout(260);
    await expect(page.locator(hostSelector)).toHaveCount(0);
    expect(translationRequests.value).toBe(0);
  } finally {
    await context.close();
  }
});

test("popup remains usable at its 200-percent-zoom width without webpage permission", async ({
  browserName: _browserName,
}, testInfo) => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    const registrations = await worker.evaluate(async () =>
      chrome.scripting.getRegisteredContentScripts(),
    );
    expect(registrations).toEqual([]);

    const page = await context.newPage();
    await page.setViewportSize({ height: 500, width: 190 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    // Chrome's own pages cannot be granted, so the popup shows only the brand and dashboard card.
    await expect(page.getByRole("button", { name: "Connect dashboard" })).toBeVisible();
    await expect(page.locator(".site-access")).toHaveCount(0);
    await expect(page.getByText("Saved phrases")).toHaveCount(0);
    const narrowLayout = await page.evaluate(() => ({
      cardWidth: document.querySelector(".account-card")?.getBoundingClientRect().width ?? 0,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(narrowLayout.scrollWidth).toBeLessThanOrEqual(narrowLayout.innerWidth);
    expect(narrowLayout.cardWidth).toBeGreaterThanOrEqual(160);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath("popup-200-percent.png") });
  } finally {
    await context.close();
  }
});
