import { type BrowserContext, chromium, expect, test, type Worker } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.resolve(testsDirectory, "../apps/extension/.output/chrome-mv3");

const seeded = [
  {
    id: "phrase-morning",
    provider: "nvidia",
    savedAt: "2026-09-12T09:00:00.000Z",
    sourceLanguage: "en",
    sourceText: "Good morning",
    targetLanguage: "ne",
    translatedText: "शुभ प्रभात",
  },
  {
    id: "phrase-thanks",
    provider: "nvidia",
    savedAt: "2026-09-11T09:00:00.000Z",
    sourceLanguage: "en",
    sourceText: "Thank you very much",
    targetLanguage: "ne",
    translatedText: "धेरै धन्यवाद",
  },
];

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function storedPhrases(worker: Worker): Promise<{ id: string }[]> {
  return worker.evaluate(async () => {
    const stored = await chrome.storage.local.get("lingobridgeSavedPhrases");
    return (stored.lingobridgeSavedPhrases ?? []) as { id: string }[];
  });
}

test("saved phrases can be searched, deleted one at a time, and cleared", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async (phrases) => {
      await chrome.storage.local.set({ lingobridgeSavedPhrases: phrases });
    }, seeded);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    const list = page.locator(".phrase");
    await expect(list).toHaveCount(2);
    await expect(page.getByText("शुभ प्रभात")).toBeVisible();

    // search narrows without touching what is stored
    await page.getByLabel("Search saved phrases").fill("thank");
    await expect(list).toHaveCount(1);
    await expect(page.getByText("धेरै धन्यवाद")).toBeVisible();
    expect(await storedPhrases(worker)).toHaveLength(2);

    await page.getByLabel("Search saved phrases").fill("");
    await expect(list).toHaveCount(2);

    // delete-one removes exactly the intended record
    await page.getByRole("button", { name: "Delete saved phrase Good morning" }).click();
    await expect(list).toHaveCount(1);
    await expect
      .poll(async () => (await storedPhrases(worker)).map((phrase) => phrase.id))
      .toEqual(["phrase-thanks"]);

    // delete-all is confirmed, not immediate
    await page.getByRole("button", { name: "Delete all" }).click();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(await storedPhrases(worker)).toHaveLength(1);

    await page.getByRole("button", { name: "Delete all" }).click();
    await expect(page.getByText("Nothing saved yet.")).toBeVisible();
    await expect.poll(async () => (await storedPhrases(worker)).length).toBe(0);
  } finally {
    await context.close();
  }
});

test("an empty store shows guidance and offers no destructive action", async () => {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(page.getByText("Nothing saved yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete all" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export" })).toHaveCount(0);
    expect(await storedPhrases(worker)).toHaveLength(0);
  } finally {
    await context.close();
  }
});
