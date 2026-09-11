import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
  type Worker,
} from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
    await expect(host).toHaveAttribute("data-lingobridge-state", "loading");
    await page.evaluate(() => {
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await setAndSelect(page, "Thank you");
    await expect(host).toHaveAttribute("data-lingobridge-state", "icon");
    await page.waitForTimeout(300);
    await expect(host).toHaveAttribute("data-lingobridge-state", "icon");
    await clickClosedShadowHost(page);
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
    const selectionCard = page.locator(".selection-magic-card");
    await expect(selectionCard).toContainText("Unavailable on this Chrome page.");
    const narrowLayout = await page.evaluate(() => ({
      cardWidth:
        document.querySelector(".selection-magic-card")?.getBoundingClientRect().width ?? 0,
      copyWidth:
        document.querySelector(".selection-magic-card__copy")?.getBoundingClientRect().width ?? 0,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(narrowLayout.scrollWidth).toBeLessThanOrEqual(narrowLayout.innerWidth);
    expect(narrowLayout.cardWidth).toBeGreaterThanOrEqual(168);
    expect(narrowLayout.copyWidth).toBeGreaterThanOrEqual(108);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath("popup-200-percent.png") });
  } finally {
    await context.close();
  }
});
