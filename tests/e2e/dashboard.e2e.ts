import { createHash, randomBytes } from "node:crypto";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const DASHBOARD = "http://127.0.0.1:3000";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const REDIRECT_URI = `https://${EXTENSION_ID}.chromiumapp.org/lingobridge`;
const PROTECTED_PAGES = [
  "/overview",
  "/phrases",
  "/preferences",
  "/extensions",
  "/privacy",
] as const;
const WIDTHS = [320, 375, 414, 768, 1024, 1280, 1440, 1920] as const;

test.describe.configure({ mode: "serial" });

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

async function signIn(page: Page, email: string, returnTo = "/overview") {
  await page.goto(`${DASHBOARD}${returnTo}`);
  await expect(page).toHaveURL(
    new RegExp(
      `/sign-in\\?returnTo=${encodeURIComponent(returnTo).replace(/[/?]/gu, "\\$&")}`,
      "u",
    ),
  );
  await page.getByRole("link", { name: /Continue with development sign-in/u }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill("Asha Gurung");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(`${DASHBOARD}${returnTo}`);
}

/** Runs the real consent page, captures Chrome's redirect, and exchanges the code like the extension does. */
async function connectExtension(page: Page, request: APIRequestContext) {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(32));

  const params = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: "S256",
    device_label: "Chrome on Windows",
    redirect_uri: REDIRECT_URI,
    state,
  });
  await page.goto(`${DASHBOARD}/extension/connect?${params}`);
  await expect(page.getByRole("heading", { name: "Connect Chrome on Windows?" })).toBeVisible();
  // Chrome's identity API intercepts this redirect in the real extension; here the request is
  // observed and the navigation is left to fail harmlessly.
  const redirect = page.waitForRequest((candidate) =>
    candidate.url().includes(".chromiumapp.org/"),
  );
  await page.getByRole("button", { name: "Connect extension" }).click();
  const returned = new URL((await redirect).url());
  expect(returned.searchParams.get("state")).toBe(state);
  const exchange = await request.post(`${DASHBOARD}/api/v1/extension/token`, {
    data: {
      code: returned.searchParams.get("code"),
      codeVerifier: verifier,
      grantType: "authorization_code",
      redirectUri: REDIRECT_URI,
    },
    headers: { Origin: EXTENSION_ORIGIN },
  });
  expect(exchange.status()).toBe(200);
  return (await exchange.json()) as { accessToken: string; sessionId: string };
}

async function sync(request: APIRequestContext, accessToken: string, mutations: unknown[] = []) {
  return request.post(`${DASHBOARD}/api/v1/sync`, {
    data: { cursor: null, mutations },
    headers: { Authorization: `Bearer ${accessToken}`, Origin: EXTENSION_ORIGIN },
  });
}

function upsert(id: string, sourceText: string, translatedText: string, savedAt: string) {
  return {
    baseRevision: 0,
    kind: "upsert-phrase",
    mutationId: crypto.randomUUID(),
    phrase: {
      id,
      note: null,
      provider: "nvidia",
      savedAt,
      sourceLanguage: "en",
      sourceText,
      targetLanguage: "ne",
      translatedText,
    },
  };
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${label} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
}

test("signed-out visitors cannot open protected pages", async ({ page, request }) => {
  for (const path of [...PROTECTED_PAGES, "/admin"]) {
    const response = await request.get(`${DASHBOARD}${path}`, { maxRedirects: 0 });
    expect(response.status(), path).toBe(303);
    expect(response.headers().location).toContain(`/sign-in?returnTo=${encodeURIComponent(path)}`);
  }

  // A forged cookie passes the edge check but fails the database-backed session check.
  await page
    .context()
    .addCookies([{ name: "lingobridge_session", url: DASHBOARD, value: "a".repeat(43) }]);
  await page.goto(`${DASHBOARD}/phrases`);
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/u);
  await page.context().clearCookies();

  const api = await request.post(`${DASHBOARD}/api/dashboard/preferences`, {
    data: { baseRevision: 0, preferredTargetLanguage: "ne" },
    headers: { Origin: DASHBOARD },
  });
  expect(api.status()).toBe(401);
});

test("sign-in, connection, sync, editing, revocation, and deletion work end to end", async ({
  page,
  request,
}) => {
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/iu.test(message.text())) cspViolations.push(message.text());
  });

  await signIn(page, "admin@example.test", "/phrases");
  await expect(page.getByRole("heading", { name: "No saved phrases yet" })).toBeVisible();
  const headers = (await page.request.get(`${DASHBOARD}/overview`)).headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");

  const tokens = await connectExtension(page, request);
  const longText =
    "Please bring your passport, visa, and the signed employment contract to the embassy. "
      .repeat(6)
      .trim();
  const pushed = await sync(request, tokens.accessToken, [
    upsert("p-morning", "Good morning", "शुभ प्रभात", "2026-09-14T09:00:00.000Z"),
    upsert("p-thanks", "Thank you very much", "धेरै धन्यवाद", "2026-09-13T09:00:00.000Z"),
    upsert(
      "p-long",
      longText,
      "कृपया आफ्नो राहदानी, भिसा र हस्ताक्षर गरिएको रोजगार सम्झौता दूतावासमा ल्याउनुहोस्।",
      "2026-09-12T09:00:00.000Z",
    ),
  ]);
  expect(pushed.status()).toBe(200);

  await page.goto(`${DASHBOARD}/phrases`);
  await expect(page.getByText("शुभ प्रभात")).toBeVisible();
  await expect(page.getByText("1–3 of 3 phrases")).toBeVisible();

  // URL-backed search. Keyboard shortcuts attach after hydration.
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search source and translated text")).toBeFocused();
  await page.keyboard.type("thank");
  await expect(page).toHaveURL(/q=thank/u);
  await expect(page.getByText("धेरै धन्यवाद")).toBeVisible();
  await expect(page.getByText("शुभ प्रभात")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByText("शुभ प्रभात")).toBeVisible();

  // Inline note editing with Enter to save.
  const morningRow = page.locator(".row", { hasText: "Good morning" });
  await morningRow.hover();
  await morningRow.getByRole("button", { name: "Add note" }).click();
  await page.keyboard.type("Say before noon");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Note saved")).toBeVisible();
  await expect(morningRow.getByRole("button", { name: "Say before noon" })).toBeVisible();

  // The extension receives the dashboard edit on its next sync.
  const pulled = await sync(request, tokens.accessToken);
  expect(JSON.stringify(await pulled.json())).toContain("Say before noon");

  // Undoable delete: Undo restores the row and nothing is deleted.
  const thanksRow = page.locator(".row", { hasText: "Thank you very much" });
  await thanksRow.hover();
  await thanksRow.getByRole("button", { name: /Delete “Thank you very much”/u }).click();
  await expect(page.getByText("Thank you very much")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Thank you very much")).toBeVisible();

  // Responsive layouts on every page.
  for (const width of WIDTHS) {
    await page.setViewportSize({ height: width < 768 ? 800 : 900, width });
    for (const path of [...PROTECTED_PAGES, "/admin"]) {
      await page.goto(`${DASHBOARD}${path}`);
      await expect(page.locator("h1")).toBeVisible();
      await expectNoHorizontalOverflow(page, `${path} at ${width}px`);
      if (width >= 1024) {
        await expect(page.locator(".sidebar")).toBeVisible();
        await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
      } else {
        await expect(page.locator(".sidebar")).toBeHidden();
        await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
      }
    }
  }
  // Landscape phone.
  await page.setViewportSize({ height: 375, width: 812 });
  await page.goto(`${DASHBOARD}/phrases`);
  await expectNoHorizontalOverflow(page, "/phrases landscape");

  // Drawer navigation by keyboard at phone width.
  await page.setViewportSize({ height: 800, width: 375 });
  await page.goto(`${DASHBOARD}/overview`);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await drawer.getByRole("link", { name: "Connected extensions" }).click();
  await expect(page).toHaveURL(`${DASHBOARD}/extensions`);
  await expect(drawer).toBeHidden();

  // Command palette.
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto(`${DASHBOARD}/overview`);
  await page.keyboard.press("Control+K");
  await page.keyboard.type("privacy");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${DASHBOARD}/privacy`);

  // Admin view shows aggregates only.
  await page.goto(`${DASHBOARD}/admin`);
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  const adminText = await page.locator("main").innerText();
  expect(adminText).not.toContain("शुभ प्रभात");
  expect(adminText).not.toContain("Good morning");

  // Revocation refuses the extension's next request.
  await page.goto(`${DASHBOARD}/extensions`);
  await expect(page.getByText("Chrome on Windows")).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke connection" }).click();
  await expect(page.getByText("Disconnected Chrome on Windows")).toBeVisible();
  const refused = await sync(request, tokens.accessToken);
  expect(refused.status()).toBe(401);
  expect(await refused.json()).toMatchObject({ code: "session-revoked" });

  // Account deletion right after sign-in (recent authentication) issues a receipt.
  await page.goto(`${DASHBOARD}/privacy`);
  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your LingoBridge account?" });
  await dialog.getByLabel(/Type delete my account to confirm/u).fill("delete my account");
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/account-deleted\?receipt=/u);
  await expect(page.getByRole("heading", { name: "Your account was deleted" })).toBeVisible();

  await page.goto(`${DASHBOARD}/overview`);
  await expect(page).toHaveURL(/\/sign-in/u);
  expect(cspViolations).toEqual([]);
});

test("a regular user cannot open the admin view", async ({ page }) => {
  await signIn(page, "regular@example.test");
  // The protected shell streams before the role check, so the not-found view arrives with a 200.
  // What matters is that no operations data renders and the navigation offers no admin link.
  await page.goto(`${DASHBOARD}/admin`);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Operations" })).toHaveCount(0);
  expect(await page.locator("main main").count()).toBe(0);
});
