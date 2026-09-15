import {
  AUTH_POLICY,
  approveExtensionConnection,
  authenticateExtensionBearer,
  createCodeChallenge,
  createCodeVerifier,
  exchangeExtensionToken,
  hashToken,
  parseConnectionRequest,
  parseExtensionRedirectUri,
} from "@lingobridge/auth";
import { revokeExtensionSession } from "@lingobridge/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleConnectDecision } from "../../apps/dashboard/src/server/handlers/extension-api";
import {
  createTestDashboard,
  createUser,
  DASHBOARD_ORIGIN,
  EXTENSION_ID,
  OTHER_EXTENSION_ID,
  REDIRECT_URI,
  signInThroughHandlers,
  type TestDashboard,
} from "../support/account-fixtures";

let dashboard: TestDashboard;
const allow = { has: (id: string) => id === EXTENSION_ID };

beforeEach(async () => {
  dashboard = await createTestDashboard();
});

afterEach(async () => {
  await dashboard.database.close();
});

function connectionParams(verifier: string, overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    code_challenge: createCodeChallenge(verifier),
    code_challenge_method: "S256",
    device_label: "Chrome on Windows",
    redirect_uri: REDIRECT_URI,
    state: "s".repeat(43),
    ...overrides,
  });
}

async function deleteAllUsers() {
  for (const name of ["users", "preferences", "extensionAuthorizationCodes"]) {
    await dashboard.database.db.collection(name).deleteMany({});
  }
}

async function issueCode(verifier = createCodeVerifier()) {
  const user = await createUser(dashboard.database, "ext@example.test", dashboard.clock.now());
  const parsed = parseConnectionRequest(
    connectionParams(verifier),
    dashboard.services.extensionAuth.allowedExtensionIds,
  );
  if (!parsed.ok) throw new Error(parsed.problem);
  const location = new URL(
    await approveExtensionConnection(dashboard.services.extensionAuth, user.id, parsed.request),
  );
  return { code: location.searchParams.get("code") ?? "", location, user, verifier };
}

describe("connection request validation", () => {
  it("accepts only Chrome identity redirects for allowlisted extensions", () => {
    expect(parseExtensionRedirectUri(REDIRECT_URI, allow)).toBe(EXTENSION_ID);
    expect(parseExtensionRedirectUri(`https://${EXTENSION_ID}.chromiumapp.org/`, allow)).toBe(
      EXTENSION_ID,
    );
    for (const hostile of [
      `https://${OTHER_EXTENSION_ID}.chromiumapp.org/`,
      `http://${EXTENSION_ID}.chromiumapp.org/`,
      `https://${EXTENSION_ID}.chromiumapp.org.evil.test/`,
      `https://evil.test/${EXTENSION_ID}.chromiumapp.org/`,
      `https://${EXTENSION_ID}.chromiumapp.org:8443/`,
      `https://${EXTENSION_ID}.chromiumapp.org/?next=https://evil.test`,
      `https://user@${EXTENSION_ID}.chromiumapp.org/`,
      "not a url",
    ]) {
      expect(parseExtensionRedirectUri(hostile, allow)).toBeNull();
    }
  });

  it("requires S256, a well-formed challenge and state, and a clean device label", () => {
    const verifier = createCodeVerifier();
    const ids = dashboard.services.extensionAuth.allowedExtensionIds;
    expect(parseConnectionRequest(connectionParams(verifier), ids).ok).toBe(true);
    expect(
      parseConnectionRequest(connectionParams(verifier, { code_challenge_method: "plain" }), ids),
    ).toEqual({ ok: false, problem: "invalid-challenge" });
    expect(
      parseConnectionRequest(connectionParams(verifier, { code_challenge: "short" }), ids),
    ).toEqual({ ok: false, problem: "invalid-challenge" });
    expect(parseConnectionRequest(connectionParams(verifier, { state: "x" }), ids)).toEqual({
      ok: false,
      problem: "invalid-state",
    });
    expect(
      parseConnectionRequest(connectionParams(verifier, { device_label: "bad\u0000label" }), ids),
    ).toEqual({ ok: false, problem: "invalid-device-label" });
  });
});

describe("user-triggered connection", () => {
  it("issues nothing until the signed-in user approves, and never for a denial", async () => {
    const { cookies, csrfToken } = await signInThroughHandlers(dashboard, "consent@example.test");
    const params = connectionParams(createCodeVerifier());
    const decide = (decision: string, csrf = csrfToken, origin = DASHBOARD_ORIGIN) =>
      handleConnectDecision(
        new Request(`${DASHBOARD_ORIGIN}/extension/connect/decision`, {
          body: new URLSearchParams({ csrf, decision, request: params.toString() }),
          headers: {
            Cookie: cookies,
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: origin,
          },
          method: "POST",
        }),
        dashboard.services,
      );

    const countCodes = async () =>
      dashboard.database.db.collection("extensionAuthorizationCodes").countDocuments();

    expect((await decide("approve", "forged")).status).toBe(403);
    expect((await decide("approve", csrfToken, "https://evil.test")).status).toBe(403);
    expect(await countCodes()).toBe(0);

    const denied = await decide("deny");
    const deniedLocation = new URL(denied.headers.get("Location") ?? "");
    expect(deniedLocation.searchParams.get("error")).toBe("access_denied");
    expect(deniedLocation.searchParams.get("code")).toBeNull();
    expect(await countCodes()).toBe(0);

    const approved = await decide("approve");
    const location = new URL(approved.headers.get("Location") ?? "");
    expect(location.origin).toBe(`https://${EXTENSION_ID}.chromiumapp.org`);
    expect(location.searchParams.get("state")).toBe(params.get("state"));
    expect(location.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(await countCodes()).toBe(1);
  });

  it("creates exactly one revocable session from a single-use code", async () => {
    const { code, verifier } = await issueCode();
    const request = {
      code,
      codeVerifier: verifier,
      grantType: "authorization_code" as const,
      redirectUri: REDIRECT_URI,
    };

    const first = await exchangeExtensionToken(dashboard.services.extensionAuth, request);
    expect(first.ok).toBe(true);
    const replay = await exchangeExtensionToken(dashboard.services.extensionAuth, request);
    expect(replay).toEqual({ error: "invalid-grant", ok: false });

    const sessions = dashboard.database.db.collection("extensionSessions");
    expect(await sessions.countDocuments()).toBe(1);

    if (!first.ok) throw new Error("exchange failed");
    const stored = await sessions.find({}).toArray();
    expect(stored[0]?.accessTokenHash).toBe(hashToken(first.response.accessToken));
    expect(JSON.stringify(stored)).not.toContain(first.response.accessToken);
    expect(JSON.stringify(stored)).not.toContain(first.response.refreshToken);
  });

  it("rejects a wrong verifier, a different redirect URI, or an expired code", async () => {
    const wrongVerifier = await issueCode();
    await expect(
      exchangeExtensionToken(dashboard.services.extensionAuth, {
        code: wrongVerifier.code,
        codeVerifier: createCodeVerifier(),
        grantType: "authorization_code",
        redirectUri: REDIRECT_URI,
      }),
    ).resolves.toEqual({ error: "invalid-grant", ok: false });

    await deleteAllUsers();
    const wrongRedirect = await issueCode();
    await expect(
      exchangeExtensionToken(dashboard.services.extensionAuth, {
        code: wrongRedirect.code,
        codeVerifier: wrongRedirect.verifier,
        grantType: "authorization_code",
        redirectUri: `https://${EXTENSION_ID}.chromiumapp.org/other`,
      }),
    ).resolves.toEqual({ error: "invalid-grant", ok: false });

    await deleteAllUsers();
    const expired = await issueCode();
    dashboard.clock.advance(AUTH_POLICY.extensionAuthorizationCodeMilliseconds + 1);
    await expect(
      exchangeExtensionToken(dashboard.services.extensionAuth, {
        code: expired.code,
        codeVerifier: expired.verifier,
        grantType: "authorization_code",
        redirectUri: REDIRECT_URI,
      }),
    ).resolves.toEqual({ error: "invalid-grant", ok: false });
  });
});

describe("extension session lifecycle", () => {
  async function connected() {
    const { code, user, verifier } = await issueCode();
    const result = await exchangeExtensionToken(dashboard.services.extensionAuth, {
      code,
      codeVerifier: verifier,
      grantType: "authorization_code",
      redirectUri: REDIRECT_URI,
    });
    if (!result.ok) throw new Error("exchange failed");
    return { tokens: result.response, user };
  }

  it("authenticates, expires the access token, and rotates the refresh token", async () => {
    const { tokens } = await connected();
    await expect(
      authenticateExtensionBearer(dashboard.services.extensionAuth, `Bearer ${tokens.accessToken}`),
    ).resolves.toMatchObject({ kind: "active" });
    await expect(
      authenticateExtensionBearer(dashboard.services.extensionAuth, "Bearer nope"),
    ).resolves.toEqual({ kind: "unauthorized" });
    await expect(
      authenticateExtensionBearer(dashboard.services.extensionAuth, tokens.accessToken),
    ).resolves.toEqual({ kind: "unauthorized" });

    dashboard.clock.advance(AUTH_POLICY.extensionAccessTokenMilliseconds + 1);
    await expect(
      authenticateExtensionBearer(dashboard.services.extensionAuth, `Bearer ${tokens.accessToken}`),
    ).resolves.toEqual({ kind: "expired" });

    const refreshed = await exchangeExtensionToken(dashboard.services.extensionAuth, {
      grantType: "refresh_token",
      refreshToken: tokens.refreshToken,
    });
    if (!refreshed.ok) throw new Error("refresh failed");
    expect(refreshed.response.refreshToken).not.toBe(tokens.refreshToken);
    expect(refreshed.response.sessionId).toBe(tokens.sessionId);
    await expect(
      authenticateExtensionBearer(
        dashboard.services.extensionAuth,
        `Bearer ${refreshed.response.accessToken}`,
      ),
    ).resolves.toMatchObject({ kind: "active" });
  });

  it("revokes the whole session when a rotated refresh token is reused", async () => {
    const { tokens } = await connected();
    const rotated = await exchangeExtensionToken(dashboard.services.extensionAuth, {
      grantType: "refresh_token",
      refreshToken: tokens.refreshToken,
    });
    if (!rotated.ok) throw new Error("refresh failed");

    await expect(
      exchangeExtensionToken(dashboard.services.extensionAuth, {
        grantType: "refresh_token",
        refreshToken: tokens.refreshToken,
      }),
    ).resolves.toEqual({ error: "session-revoked", ok: false });
    await expect(
      exchangeExtensionToken(dashboard.services.extensionAuth, {
        grantType: "refresh_token",
        refreshToken: rotated.response.refreshToken,
      }),
    ).resolves.toEqual({ error: "session-revoked", ok: false });
    await expect(
      authenticateExtensionBearer(
        dashboard.services.extensionAuth,
        `Bearer ${rotated.response.accessToken}`,
      ),
    ).resolves.toEqual({ kind: "revoked" });
  });

  it("refuses the next request immediately after the user revokes the session", async () => {
    const { tokens, user } = await connected();
    await revokeExtensionSession(
      dashboard.database,
      user.id,
      tokens.sessionId,
      dashboard.clock.now(),
    );
    await expect(
      authenticateExtensionBearer(dashboard.services.extensionAuth, `Bearer ${tokens.accessToken}`),
    ).resolves.toEqual({ kind: "revoked" });
    await expect(
      exchangeExtensionToken(dashboard.services.extensionAuth, {
        grantType: "refresh_token",
        refreshToken: tokens.refreshToken,
      }),
    ).resolves.toEqual({ error: "session-revoked", ok: false });
  });

  it("ends at the absolute session lifetime", async () => {
    const { tokens } = await connected();
    dashboard.clock.advance(AUTH_POLICY.extensionSessionMilliseconds + 1);
    await expect(
      exchangeExtensionToken(dashboard.services.extensionAuth, {
        grantType: "refresh_token",
        refreshToken: tokens.refreshToken,
      }),
    ).resolves.toEqual({ error: "invalid-grant", ok: false });
  });
});
