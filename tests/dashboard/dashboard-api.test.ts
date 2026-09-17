import {
  AUTH_POLICY,
  approveExtensionConnection,
  createCodeChallenge,
  createCodeVerifier,
  exchangeExtensionToken,
  parseConnectionRequest,
} from "@lingobridge/auth";
import { syncResponseSchema } from "@lingobridge/contracts/account";
import {
  findUserByIdentity,
  getPhraseRecord,
  runSync,
  upsertSavedWord,
} from "@lingobridge/database";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, isProtectedPath, proxy } from "../../apps/dashboard/src/proxy";
import { loadDashboardConfig } from "../../apps/dashboard/src/server/config";
import {
  handleDeleteAccount,
  handleDeletePhrases,
  handleExport,
  handleRevokeExtension,
  handleUpdateNote,
  handleUpdatePreferences,
} from "../../apps/dashboard/src/server/handlers/dashboard-api";
import {
  handleExtensionToken,
  handleSync,
} from "../../apps/dashboard/src/server/handlers/extension-api";
import {
  createTestDashboard,
  DASHBOARD_ORIGIN,
  EXTENSION_ID,
  phrase,
  REDIRECT_URI,
  signInThroughHandlers,
  type TestDashboard,
} from "../support/account-fixtures";

let dashboard: TestDashboard;

beforeEach(async () => {
  dashboard = await createTestDashboard();
});

afterEach(async () => {
  await dashboard.database.close();
});

function post(path: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`${DASHBOARD_ORIGIN}${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: DASHBOARD_ORIGIN, ...headers },
    method: "POST",
  });
}

async function userId(email: string): Promise<string> {
  const user = await findUserByIdentity(
    dashboard.database,
    `${DASHBOARD_ORIGIN}/dev-identity`,
    `dev-${await sha(email)}`,
  );
  if (!user) throw new Error("user missing");
  return user.id;
}

async function sha(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 32);
}

async function connectExtension(uid: string) {
  const verifier = createCodeVerifier();
  const parsed = parseConnectionRequest(
    new URLSearchParams({
      code_challenge: createCodeChallenge(verifier),
      code_challenge_method: "S256",
      device_label: "Chrome",
      redirect_uri: REDIRECT_URI,
      state: "t".repeat(43),
    }),
    dashboard.services.extensionAuth.allowedExtensionIds,
  );
  if (!parsed.ok) throw new Error(parsed.problem);
  const code =
    new URL(
      await approveExtensionConnection(dashboard.services.extensionAuth, uid, parsed.request),
    ).searchParams.get("code") ?? "";
  const tokens = await exchangeExtensionToken(dashboard.services.extensionAuth, {
    code,
    codeVerifier: verifier,
    grantType: "authorization_code",
    redirectUri: REDIRECT_URI,
  });
  if (!tokens.ok) throw new Error("exchange failed");
  return tokens.response;
}

describe("protected route boundary", () => {
  it("redirects signed-out visitors from every protected page to sign-in with a return path", () => {
    for (const path of [
      "/overview",
      "/phrases",
      "/preferences",
      "/extensions",
      "/privacy",
      "/admin",
      "/phrases?q=hi",
    ]) {
      const response = proxy(new NextRequest(`${DASHBOARD_ORIGIN}${path}`));
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get("Location") ?? "");
      expect(location.pathname).toBe("/sign-in");
      expect(location.searchParams.get("returnTo")).toBe(path);
    }
  });

  it("lets public pages through with a nonce-based CSP", () => {
    expect(isProtectedPath("/sign-in")).toBe(false);
    expect(isProtectedPath("/overviewer")).toBe(false);
    const response = proxy(new NextRequest(`${DASHBOARD_ORIGIN}/sign-in`));
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/u);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(buildContentSecurityPolicy("n", false)).not.toContain("unsafe");
  });

  it("rejects API calls without a valid session", async () => {
    const response = await handleExport(
      new Request(`${DASHBOARD_ORIGIN}/api/dashboard/export`),
      dashboard.services,
    );
    expect(response.status).toBe(401);
    const forged = await handleExport(
      new Request(`${DASHBOARD_ORIGIN}/api/dashboard/export`, {
        headers: { Cookie: "lingobridge_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      }),
      dashboard.services,
    );
    expect(forged.status).toBe(401);
  });
});

describe("dashboard mutations", () => {
  it("require same-origin requests and a session-bound CSRF token", async () => {
    const { cookies, csrfToken } = await signInThroughHandlers(dashboard, "mutate@example.test");
    const body = { baseRevision: 0, preferredTargetLanguage: "ne" };
    const call = (headers: Record<string, string>) =>
      handleUpdatePreferences(
        post("/api/dashboard/preferences", body, { Cookie: cookies, ...headers }),
        dashboard.services,
      );

    expect((await call({})).status).toBe(403);
    expect((await call({ "X-CSRF-Token": "forged" })).status).toBe(403);
    expect((await call({ Origin: "https://evil.test", "X-CSRF-Token": csrfToken })).status).toBe(
      403,
    );
    const other = await signInThroughHandlers(dashboard, "other@example.test");
    expect((await call({ "X-CSRF-Token": other.csrfToken })).status).toBe(403);

    const ok = await call({ "X-CSRF-Token": csrfToken });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      preferences: { preferredTargetLanguage: "ne", revision: 1 },
    });
  });

  it("reject unknown fields, so only allowlisted preferences can change", async () => {
    const { cookies, csrfToken } = await signInThroughHandlers(dashboard, "allowlist@example.test");
    const response = await handleUpdatePreferences(
      post(
        "/api/dashboard/preferences",
        { baseRevision: 0, siteAccess: ["<all_urls>"] },
        { Cookie: cookies, "X-CSRF-Token": csrfToken },
      ),
      dashboard.services,
    );
    expect(response.status).toBe(400);
  });

  it("scope phrase edits, deletion, session revocation, and export to the signed-in user", async () => {
    const alice = await signInThroughHandlers(dashboard, "alice@example.test");
    const bob = await signInThroughHandlers(dashboard, "bob@example.test");
    const aliceId = await userId("alice@example.test");
    const secret = phrase({ sourceText: "Alice only" });
    await runSync(
      dashboard.database,
      aliceId,
      {
        cursor: null,
        mutations: [
          {
            baseRevision: 0,
            kind: "upsert-phrase",
            mutationId: crypto.randomUUID(),
            phrase: secret,
          },
        ],
      },
      dashboard.clock.now(),
    );
    const aliceTokens = await connectExtension(aliceId);
    const bobHeaders = { Cookie: bob.cookies, "X-CSRF-Token": bob.csrfToken };

    const note = await handleUpdateNote(
      post(
        "/api/dashboard/phrases/note",
        { baseRevision: 1, note: "x", phraseId: secret.id },
        bobHeaders,
      ),
      dashboard.services,
    );
    expect(note.status).toBe(404);
    const deleted = await handleDeletePhrases(
      post("/api/dashboard/phrases/delete", { phraseIds: [secret.id] }, bobHeaders),
      dashboard.services,
    );
    expect(await deleted.json()).toEqual({ deleted: 0 });
    const revoked = await handleRevokeExtension(
      post("/api/dashboard/extensions/revoke", { sessionId: aliceTokens.sessionId }, bobHeaders),
      dashboard.services,
    );
    expect(revoked.status).toBe(404);
    const exported = await handleExport(
      new Request(`${DASHBOARD_ORIGIN}/api/dashboard/export?scope=account`, {
        headers: { Cookie: bob.cookies },
      }),
      dashboard.services,
    );
    expect(exported.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(exported.headers.get("Content-Disposition")).toContain("lingobridge-account-");
    expect(exported.headers.get("Content-Disposition")).toContain(".txt");
    const exportedText = await exported.text();
    expect(exportedText).toContain("LingoBridge Account Data");
    expect(exportedText).toContain("SAVED PHRASES (0)");
    expect(exportedText).not.toContain("Alice only");

    expect(await getPhraseRecord(dashboard.database, aliceId, secret.id)).toMatchObject({
      state: "live",
    });

    const own = await handleUpdateNote(
      post(
        "/api/dashboard/phrases/note",
        { baseRevision: 1, note: "mine", phraseId: secret.id },
        { Cookie: alice.cookies, "X-CSRF-Token": alice.csrfToken },
      ),
      dashboard.services,
    );
    expect(await own.json()).toMatchObject({ phrase: { note: "mine", revision: 2 } });
    const phraseExport = await handleExport(
      new Request(`${DASHBOARD_ORIGIN}/api/dashboard/export?scope=phrases`, {
        headers: { Cookie: alice.cookies },
      }),
      dashboard.services,
    );
    expect(phraseExport.headers.get("Content-Disposition")).toContain("lingobridge-phrases-");
    expect(phraseExport.headers.get("Content-Disposition")).toContain(".xlsx");
    expect(phraseExport.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const phraseWorkbook = new ExcelJS.Workbook();
    await phraseWorkbook.xlsx.load(await phraseExport.arrayBuffer());
    const phraseSheet = phraseWorkbook.getWorksheet("Saved phrases");
    expect(phraseSheet?.getRow(1).getCell(1).text).toBe("Source");
    expect(phraseSheet?.getRow(2).getCell(1).text).toBe("Alice only");
    expect(phraseSheet?.getRow(2).getCell(2).text).toBe(secret.translatedText);
    expect(phraseSheet?.rowCount).toBe(2); // header row plus the one live phrase; the note is not exported
    const phraseWorkbookText = JSON.stringify(phraseWorkbook.model);
    expect(phraseWorkbookText).not.toContain("mine");
    const stale = await handleUpdateNote(
      post(
        "/api/dashboard/phrases/note",
        { baseRevision: 1, note: "stale", phraseId: secret.id },
        { Cookie: alice.cookies, "X-CSRF-Token": alice.csrfToken },
      ),
      dashboard.services,
    );
    expect(stale.status).toBe(409);
  });

  it("exports vocabulary as a real Excel workbook, scoped to the signed-in user", async () => {
    const alice = await signInThroughHandlers(dashboard, "alice-vocab@example.test");
    const bob = await signInThroughHandlers(dashboard, "bob-vocab@example.test");
    const aliceId = await userId("alice-vocab@example.test");
    await upsertSavedWord(dashboard.database, aliceId, {
      contextMeaning: "It describes something very large here.",
      example: "The building was enormous.",
      id: crypto.randomUUID(),
      meaning: "Very large",
      partOfSpeech: "adjective",
      pronunciation: "ih-NOR-muhs",
      savedAt: dashboard.clock.now().toISOString(),
      sourceLanguage: "en",
      sourceText: "The building was enormous.",
      targetLanguage: "ne",
      translation: "विशाल",
      word: "enormous",
    });

    const bobExport = await handleExport(
      new Request(`${DASHBOARD_ORIGIN}/api/dashboard/export?scope=vocabulary`, {
        headers: { Cookie: bob.cookies },
      }),
      dashboard.services,
    );
    expect(bobExport.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const bobWorkbook = new ExcelJS.Workbook();
    await bobWorkbook.xlsx.load(await bobExport.arrayBuffer());
    expect(bobWorkbook.getWorksheet("Vocabulary")?.rowCount).toBe(1); // header row only

    const aliceExport = await handleExport(
      new Request(`${DASHBOARD_ORIGIN}/api/dashboard/export?scope=vocabulary`, {
        headers: { Cookie: alice.cookies },
      }),
      dashboard.services,
    );
    expect(aliceExport.headers.get("Content-Disposition")).toContain("lingobridge-vocabulary-");
    expect(aliceExport.headers.get("Content-Disposition")).toContain(".xlsx");
    const aliceWorkbook = new ExcelJS.Workbook();
    await aliceWorkbook.xlsx.load(await aliceExport.arrayBuffer());
    const sheet = aliceWorkbook.getWorksheet("Vocabulary");
    expect(sheet?.getRow(1).getCell(1).text).toBe("Word");
    const row = sheet?.getRow(2);
    expect(row?.getCell(1).text).toBe("enormous");
    expect(row?.getCell(2).text).toBe("विशाल");
    expect(row?.getCell(4).text).toBe("adjective");
  });

  it("delete an account only after recent authentication and revoke every session", async () => {
    const { cookies, csrfToken } = await signInThroughHandlers(dashboard, "leaving@example.test");
    const uid = await userId("leaving@example.test");
    const tokens = await connectExtension(uid);
    const headers = { Cookie: cookies, "X-CSRF-Token": csrfToken };

    const wrongPhrase = await handleDeleteAccount(
      post("/api/dashboard/account/delete", { confirmation: "yes" }, headers),
      dashboard.services,
    );
    expect(wrongPhrase.status).toBe(400);

    dashboard.clock.advance(AUTH_POLICY.recentAuthenticationMilliseconds + 1);
    const stale = await handleDeleteAccount(
      post("/api/dashboard/account/delete", { confirmation: "delete my account" }, headers),
      dashboard.services,
    );
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: "reauthentication-required" });

    const fresh = await signInThroughHandlers(dashboard, "leaving@example.test");
    const deleted = await handleDeleteAccount(
      post(
        "/api/dashboard/account/delete",
        { confirmation: "delete my account" },
        { Cookie: fresh.cookies, "X-CSRF-Token": fresh.csrfToken },
      ),
      dashboard.services,
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ receiptId: expect.any(String) });
    expect(deleted.headers.get("Set-Cookie")).toMatch(/Max-Age=0/u);

    const sync = await handleSync(
      post(
        DASHBOARD_ORIGIN_PATH,
        { cursor: null, mutations: [] },
        {
          Authorization: `Bearer ${tokens.accessToken}`,
          Origin: `chrome-extension://${EXTENSION_ID}`,
        },
      ),
      dashboard.services,
    );
    expect(sync.status).toBe(401);
    expect(await sync.json()).toMatchObject({ code: "session-revoked" });

    const afterExport = await handleExport(
      new Request(`${DASHBOARD_ORIGIN}/api/dashboard/export`, {
        headers: { Cookie: fresh.cookies },
      }),
      dashboard.services,
    );
    expect(afterExport.status).toBe(401);
  });
});

const DASHBOARD_ORIGIN_PATH = "/api/v1/sync";

describe("extension API", () => {
  it("accepts calls only from allowlisted extension origins", async () => {
    const response = await handleExtensionToken(
      post(
        "/api/v1/extension/token",
        { grantType: "refresh_token", refreshToken: "r".repeat(43) },
        { Origin: "https://evil.test" },
      ),
      dashboard.services,
    );
    expect(response.status).toBe(403);
  });

  it("syncs through the bearer token and never accepts a user id from the client", async () => {
    await signInThroughHandlers(dashboard, "sync-api@example.test");
    const uid = await userId("sync-api@example.test");
    const tokens = await connectExtension(uid);
    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      Origin: `chrome-extension://${EXTENSION_ID}`,
    };

    const withUserId = await handleSync(
      post("/api/v1/sync", { cursor: null, mutations: [], userId: "someone-else" }, headers),
      dashboard.services,
    );
    expect(withUserId.status).toBe(400);

    const content = phrase();
    const response = await handleSync(
      post(
        "/api/v1/sync",
        {
          cursor: null,
          mutations: [
            {
              baseRevision: 0,
              kind: "upsert-phrase",
              mutationId: crypto.randomUUID(),
              phrase: content,
            },
          ],
        },
        headers,
      ),
      dashboard.services,
    );
    expect(response.status).toBe(200);
    expect(syncResponseSchema.parse(await response.json()).results[0]?.status).toBe("applied");
    expect(await getPhraseRecord(dashboard.database, uid, content.id)).toMatchObject({
      state: "live",
    });

    const noToken = await handleSync(
      post("/api/v1/sync", { cursor: null, mutations: [] }, { Origin: headers.Origin }),
      dashboard.services,
    );
    expect(noToken.status).toBe(401);
  });

  it("bounds request bodies and reports expired access tokens distinctly", async () => {
    await signInThroughHandlers(dashboard, "bounds@example.test");
    const tokens = await connectExtension(await userId("bounds@example.test"));
    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      Origin: `chrome-extension://${EXTENSION_ID}`,
    };

    const huge = await handleSync(
      post(
        "/api/v1/sync",
        { cursor: null, mutations: [], padding: "x".repeat(300 * 1_024) },
        headers,
      ),
      dashboard.services,
    );
    expect(huge.status).toBe(413);

    dashboard.clock.advance(AUTH_POLICY.extensionAccessTokenMilliseconds + 1);
    const expired = await handleSync(
      post("/api/v1/sync", { cursor: null, mutations: [] }, headers),
      dashboard.services,
    );
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ code: "session-expired", retryable: true });
  });
});

describe("configuration", () => {
  it("refuses development shortcuts in production", () => {
    const production = {
      DATABASE_URL: "mongodb+srv://cluster.example.mongodb.net",
      LINGOBRIDGE_ALLOWED_EXTENSION_IDS: EXTENSION_ID,
      LINGOBRIDGE_DASHBOARD_ORIGIN: "https://dashboard.example",
      LINGOBRIDGE_SESSION_SECRET: "x".repeat(40),
      NODE_ENV: "production",
      OIDC_CLIENT_ID: "client",
      OIDC_CLIENT_SECRET: "server-only-client-secret",
      OIDC_ISSUER: "https://issuer.example",
    };
    expect(loadDashboardConfig(production).authMode).toBe("oidc");
    expect(() =>
      loadDashboardConfig({ ...production, LINGOBRIDGE_AUTH_MODE: "development" }),
    ).toThrow();
    expect(() => loadDashboardConfig({ ...production, DATABASE_URL: "" })).toThrow();
    expect(() =>
      loadDashboardConfig({ ...production, DATABASE_URL: "postgres://db.example/lingobridge" }),
    ).toThrow();
    expect(() => loadDashboardConfig({ ...production, LINGOBRIDGE_SESSION_SECRET: "" })).toThrow();
    expect(() => loadDashboardConfig({ ...production, OIDC_CLIENT_SECRET: "" })).toThrow();
    expect(() => loadDashboardConfig({ ...production, OIDC_CLIENT_ID: "" })).toThrow();
    expect(loadDashboardConfig({ ...production, OIDC_ISSUER: "" }).oidc).toMatchObject({
      issuer: "https://accounts.google.com",
      providerName: "Google",
    });
    expect(() =>
      loadDashboardConfig({ ...production, LINGOBRIDGE_ALLOWED_EXTENSION_IDS: "*" }),
    ).toThrow();
    expect(() =>
      loadDashboardConfig({
        ...production,
        LINGOBRIDGE_DASHBOARD_ORIGIN: "http://dashboard.example",
      }),
    ).toThrow();
    expect(loadDashboardConfig(production).secureCookies).toBe(true);
  });
});
