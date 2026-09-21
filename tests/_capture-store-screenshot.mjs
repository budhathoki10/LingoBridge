/**
 * Captures a real, working screenshot of Selection Magic for the Chrome Web
 * Store listing. Reuses the exact interaction and selectors already proven by
 * tests/e2e/selection-magic.e2e.ts against the packaged extension in
 * apps/extension/.output/chrome-mv3 — this is the same build that ships, so
 * the screenshot matches what a real install looks like, not a mockup.
 *
 * It loads a realistic article-style fixture page (rather than the e2e
 * suite's blank JSON fixture), on an origin already in the extension's
 * host_permissions, so no optional-permission grant flow is needed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const extensionPath = resolve(import.meta.dirname, "../apps/extension/.output/chrome-mv3");
// Already in host_permissions (see manifest.json), so Selection Magic can register
// a content script here without an optional-permission grant.
const fixtureOrigin = "https://lingobridge-gateway-t9zx.onrender.com";
const outDir =
  "C:/Users/KUSHAL~1/AppData/Local/Temp/claude/c--Users-kushal-budhathoki-OneDrive-Documents-stuffs-chrome-extension/742292e0-6e62-469e-8421-f76aa3a11584/scratchpad/store-screenshot";

const hostSelector = "lingobridge-selection-root";

async function extensionWorker(context) {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function configureSelectionMagic(worker) {
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
}

function findShadowControl(node, tag, label) {
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

async function operateClosedShadowControl(page, tag, label, action) {
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
      const center = (indexes) => indexes.reduce((sum, index) => sum + quad[index], 0) / 4;
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

async function clickClosedShadowHost(page) {
  const box = await page.locator(hostSelector).boundingBox();
  if (!box) throw new Error("Selection Magic host is not visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

await mkdir(outDir, { recursive: true });

const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  viewport: { width: 1280, height: 800 },
});

try {
  const worker = await extensionWorker(context);
  await configureSelectionMagic(worker);

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(fixtureOrigin);

  // Replace the gateway's plain JSON body with a realistic article, so the
  // screenshot shows Selection Magic doing what it actually does: translating
  // a sentence on a normal page of English text.
  await page.evaluate(() => {
    document.body.replaceChildren();
    document.documentElement.style.margin = "0";
    document.body.style.cssText =
      "margin:0;min-height:100vh;background:#fbfbfa;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111110;";
    const wrap = document.createElement("div");
    wrap.style.cssText = "max-width:640px;margin:0 auto;padding:96px 32px 48px;";
    wrap.innerHTML = `
      <p style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b6b68;margin:0 0 12px;">Travel Notice</p>
      <h1 style="font-size:32px;line-height:1.25;margin:0 0 24px;font-weight:600;">Local transit changes for the coming week</h1>
      <p id="selection-fixture" style="font-size:18px;line-height:1.7;margin:0 0 20px;">
        Please arrive at the station at least twenty minutes before your scheduled departure, as
        boarding gates close five minutes prior to the listed time and late passengers cannot be
        accommodated on this route.
      </p>
      <p style="font-size:18px;line-height:1.7;margin:0;color:#3a3a38;">
        Staff at the information desk can help with rebooking if your original departure is missed.
      </p>
    `;
    document.body.append(wrap);
  });

  const fixture = page.locator("#selection-fixture");
  await fixture.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });

  const host = page.locator(hostSelector);
  await host.waitFor({ state: "visible" });
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-lingobridge-state") === "icon",
    hostSelector,
    { timeout: 10_000 },
  );

  await clickClosedShadowHost(page);
  await page.waitForFunction(
    (selector) =>
      ["ready", "consent"].includes(
        document.querySelector(selector)?.getAttribute("data-lingobridge-state") ?? "",
      ),
    hostSelector,
    { timeout: 10_000 },
  );

  await operateClosedShadowControl(page, "select", "Target language", { select: "ne" });
  const state = await host.getAttribute("data-lingobridge-state");
  if (state === "consent") {
    // Accepting consent starts translation immediately with the already-selected
    // target language — there is no separate "Translate" click in this path.
    await operateClosedShadowControl(page, "button", "Allow and translate", "click");
  } else {
    await operateClosedShadowControl(page, "button", "Translate into Nepali", "click");
  }
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-lingobridge-state") === "success",
    hostSelector,
    { timeout: 20_000 },
  );

  await page.waitForTimeout(300);
  const rawPath = resolve(outDir, "selection-magic-raw.png");
  await page.screenshot({ path: rawPath });
  await writeFile(resolve(outDir, "state.txt"), await host.getAttribute("data-lingobridge-state"));
  console.info("captured", rawPath);
} finally {
  await context.close();
}

// The Store requires a 24-bit PNG with no alpha channel. Chromium page
// screenshots over an opaque background already have none, but this makes it
// explicit and guarantees exactly 1280x800.
const source = resolve(outDir, "selection-magic-raw.png");
const finalPath = resolve(outDir, "screenshot-1-selection-magic.png");
await sharp(source)
  .resize(1280, 800, { fit: "cover" })
  .flatten({ background: "#ffffff" })
  .png()
  .toFile(finalPath);
const meta = await sharp(finalPath).metadata();
console.info("final:", finalPath, meta.width, "x", meta.height, "channels:", meta.channels);
