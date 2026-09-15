import {
  approveExtensionConnection,
  AUTH_POLICY,
  authenticateExtensionBearer,
  beginSignIn,
  completeSignIn,
  createCodeChallenge,
  createCodeVerifier,
  deriveCsrfToken,
  DevelopmentIdentityProvider,
  exchangeExtensionToken,
  isRecentlyAuthenticated,
  OidcClient,
  OidcError,
  parseConnectionRequest,
  resolveWebSession,
  sanitizeReturnPath,
  signOut,
  verifyPkce,
  verifySessionCsrf,
} from "@lingobridge/auth";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cookieNames, readCookie } from "../../apps/dashboard/src/server/cookies";
import {
  handleCallback,
  handleSignInStart,
  handleSignOut,
} from "../../apps/dashboard/src/server/handlers/auth";
import {
  cookieHeader,
  createTestDashboard,
  DASHBOARD_ORIGIN,
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

async function startAndAuthorize(email = "person@example.test") {
  const start = await beginSignIn(dashboard.services.webAuth, {
    purpose: "sign-in",
    returnTo: "/phrases",
  });
  const authorize = new URL(start.authorizationUrl);
  const callback = new URL(
    dashboard.services.developmentIdentity?.issueCode(authorize.searchParams, {
      email,
      name: "Person",
    }) ?? "",
  );
  return { authorize, callback, start };
}

describe("authorization request", () => {
  it("uses the code flow with S256 PKCE, state, and nonce", async () => {
    const { authorize } = await startAndAuthorize();
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(authorize.searchParams.get("state")?.length).toBeGreaterThanOrEqual(43);
    expect(authorize.searchParams.get("nonce")?.length).toBeGreaterThanOrEqual(43);
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${DASHBOARD_ORIGIN}/auth/callback`);
  });

  it("verifies PKCE only for the matching verifier", () => {
    const verifier = "a".repeat(43);
    const challenge = createCodeChallenge(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("b".repeat(43), challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
  });
});

describe("callback", () => {
  it("signs in once and refuses a replayed callback", async () => {
    const { callback, start } = await startAndAuthorize();
    const input = {
      browserBinding: start.browserBinding,
      code: callback.searchParams.get("code"),
      currentSessionToken: null,
      providerError: null,
      state: callback.searchParams.get("state"),
    };
    const first = await completeSignIn(dashboard.services.webAuth, input);
    expect(first).toMatchObject({
      kind: "signed-in",
      returnTo: "/phrases",
      user: { email: "person@example.test", role: "user" },
    });

    await expect(completeSignIn(dashboard.services.webAuth, input)).resolves.toEqual({
      kind: "failed",
      reason: "invalid-state",
    });
  });

  it("rejects a callback without the browser binding cookie (login CSRF)", async () => {
    const { callback } = await startAndAuthorize();
    await expect(
      completeSignIn(dashboard.services.webAuth, {
        browserBinding: "attacker-binding-value-0000000000000000000",
        code: callback.searchParams.get("code"),
        currentSessionToken: null,
        providerError: null,
        state: callback.searchParams.get("state"),
      }),
    ).resolves.toEqual({ kind: "failed", reason: "invalid-state" });
  });

  it("rejects a forged state value", async () => {
    const { callback, start } = await startAndAuthorize();
    await expect(
      completeSignIn(dashboard.services.webAuth, {
        browserBinding: start.browserBinding,
        code: callback.searchParams.get("code"),
        currentSessionToken: null,
        providerError: null,
        state: "forged-state-forged-state-forged-state-000",
      }),
    ).resolves.toEqual({ kind: "failed", reason: "invalid-state" });
  });

  it("expires a sign-in attempt that took too long", async () => {
    const { callback, start } = await startAndAuthorize();
    dashboard.clock.advance(AUTH_POLICY.loginAttemptMilliseconds + 1);
    await expect(
      completeSignIn(dashboard.services.webAuth, {
        browserBinding: start.browserBinding,
        code: callback.searchParams.get("code"),
        currentSessionToken: null,
        providerError: null,
        state: callback.searchParams.get("state"),
      }),
    ).resolves.toEqual({ kind: "failed", reason: "invalid-state" });
  });

  it("reports a provider denial and consumes the attempt", async () => {
    const { callback, start } = await startAndAuthorize();
    const denied = {
      browserBinding: start.browserBinding,
      code: null,
      currentSessionToken: null,
      providerError: "access_denied",
      state: callback.searchParams.get("state"),
    };
    await expect(completeSignIn(dashboard.services.webAuth, denied)).resolves.toEqual({
      kind: "failed",
      reason: "provider-denied",
    });
    await expect(
      completeSignIn(dashboard.services.webAuth, {
        ...denied,
        code: callback.searchParams.get("code"),
        providerError: null,
      }),
    ).resolves.toEqual({ kind: "failed", reason: "invalid-state" });
  });

  it("rejects an authorization code that fails PKCE at the provider", async () => {
    const { start } = await startAndAuthorize();
    const authorize = new URL(start.authorizationUrl);
    const tampered = new URLSearchParams(authorize.searchParams);
    tampered.set("code_challenge", createCodeChallenge("x".repeat(43)));
    const callback = new URL(
      dashboard.services.developmentIdentity?.issueCode(tampered, {
        email: "p@example.test",
        name: "P",
      }) ?? "",
    );
    await expect(
      completeSignIn(dashboard.services.webAuth, {
        browserBinding: start.browserBinding,
        code: callback.searchParams.get("code"),
        currentSessionToken: null,
        providerError: null,
        state: callback.searchParams.get("state"),
      }),
    ).resolves.toEqual({ kind: "failed", reason: "provider-unavailable" });
  });

  it("grants admin only to verified allowlisted emails", async () => {
    const admin = await signInThroughHandlers(dashboard, "ADMIN@example.test");
    const token = readCookie(admin.cookies, cookieNames(false).session);
    expect((await resolveWebSession(dashboard.services.webAuth, token))?.user.role).toBe("admin");
  });
});

describe("ID token verification", () => {
  async function signedToken(
    claims: Record<string, unknown>,
    options: { audience?: string; expiresIn?: number; issuer?: string } = {},
  ) {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "test" };
    const now = Math.floor(Date.parse("2026-09-14T10:00:00.000Z") / 1_000);
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(options.issuer ?? "https://issuer.test")
      .setAudience(options.audience ?? "client")
      .setSubject("user-1")
      .setIssuedAt(now)
      .setExpirationTime(now + (options.expiresIn ?? 300))
      .sign(privateKey);
    const client = new OidcClient(
      {
        clientId: "client",
        clientSecret: null,
        issuer: "https://issuer.test",
        redirectUri: "https://app.test/cb",
        scopes: ["openid"],
      },
      {
        jwks: async () => (await import("jose")).importJWK(jwk, "RS256") as Promise<CryptoKey>,
        now: () => new Date("2026-09-14T10:00:00.000Z"),
      },
    );
    return { client, token };
  }

  it("accepts a valid token and rejects wrong nonce, audience, issuer, and expiry", async () => {
    const valid = await signedToken({
      auth_time: 1_789_380_000,
      email: "a@b.test",
      email_verified: true,
      nonce: "n1",
    });
    await expect(valid.client.verifyIdToken(valid.token, { nonce: "n1" })).resolves.toMatchObject({
      subject: "user-1",
    });
    await expect(valid.client.verifyIdToken(valid.token, { nonce: "other" })).rejects.toMatchObject(
      { reason: "nonce-mismatch" },
    );

    const wrongAudience = await signedToken({ nonce: "n1" }, { audience: "someone-else" });
    await expect(
      wrongAudience.client.verifyIdToken(wrongAudience.token, { nonce: "n1" }),
    ).rejects.toBeInstanceOf(OidcError);

    const wrongIssuer = await signedToken({ nonce: "n1" }, { issuer: "https://evil.test" });
    await expect(
      wrongIssuer.client.verifyIdToken(wrongIssuer.token, { nonce: "n1" }),
    ).rejects.toMatchObject({ reason: "invalid-id-token" });

    const expired = await signedToken({ nonce: "n1" }, { expiresIn: -600 });
    await expect(
      expired.client.verifyIdToken(expired.token, { nonce: "n1" }),
    ).rejects.toMatchObject({ reason: "invalid-id-token" });
  });

  it("requires a fresh auth_time for re-authentication", async () => {
    const stale = await signedToken({
      auth_time: Math.floor(Date.parse("2026-09-14T09:00:00.000Z") / 1_000),
      nonce: "n",
    });
    await expect(
      stale.client.verifyIdToken(stale.token, { maxAgeSeconds: 300, nonce: "n" }),
    ).rejects.toMatchObject({
      reason: "authentication-too-old",
    });
    const missing = await signedToken({ nonce: "n" });
    await expect(
      missing.client.verifyIdToken(missing.token, { maxAgeSeconds: 300, nonce: "n" }),
    ).rejects.toMatchObject({
      reason: "authentication-too-old",
    });
  });

  it("refuses a non-HTTPS issuer outside loopback", () => {
    expect(
      () =>
        new OidcClient({
          clientId: "c",
          clientSecret: null,
          issuer: "http://issuer.example",
          redirectUri: "https://x/cb",
          scopes: ["openid"],
        }),
    ).toThrow();
    expect(
      new DevelopmentIdentityProvider({ clients: [], issuer: "http://127.0.0.1:3000/dev-identity" })
        .issuer,
    ).toContain("127.0.0.1");
  });
});

describe("dashboard sessions", () => {
  it("expire after the idle window and slide while in use", async () => {
    const { cookies } = await signInThroughHandlers(dashboard, "idle@example.test");
    const token = readCookie(cookies, cookieNames(false).session);

    dashboard.clock.advance(AUTH_POLICY.webSessionIdleMilliseconds - 60_000);
    expect(await resolveWebSession(dashboard.services.webAuth, token)).not.toBeNull();
    dashboard.clock.advance(AUTH_POLICY.webSessionIdleMilliseconds - 60_000);
    expect(await resolveWebSession(dashboard.services.webAuth, token)).not.toBeNull();
    dashboard.clock.advance(AUTH_POLICY.webSessionIdleMilliseconds + 1);
    expect(await resolveWebSession(dashboard.services.webAuth, token)).toBeNull();
  });

  it("expire at the absolute limit even when used continuously", async () => {
    const { cookies } = await signInThroughHandlers(dashboard, "absolute@example.test");
    const token = readCookie(cookies, cookieNames(false).session);
    const step = AUTH_POLICY.webSessionIdleMilliseconds / 2;
    let elapsed = 0;
    while (elapsed + step < AUTH_POLICY.webSessionAbsoluteMilliseconds) {
      dashboard.clock.advance(step);
      elapsed += step;
      expect(await resolveWebSession(dashboard.services.webAuth, token)).not.toBeNull();
    }
    dashboard.clock.advance(AUTH_POLICY.webSessionAbsoluteMilliseconds - elapsed + 1);
    expect(await resolveWebSession(dashboard.services.webAuth, token)).toBeNull();
  });

  it("end on sign-out and store only token hashes", async () => {
    const { cookies, csrfToken } = await signInThroughHandlers(dashboard, "out@example.test");
    const token = readCookie(cookies, cookieNames(false).session) ?? "";
    const stored = await dashboard.database.db.collection("webSessions").find({}).toArray();
    expect(stored.some((document) => document.tokenHash === token)).toBe(false);

    const response = await handleSignOut(
      new Request(`${DASHBOARD_ORIGIN}/auth/sign-out`, {
        body: new URLSearchParams({ csrf: csrfToken }),
        headers: {
          Cookie: cookies,
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: DASHBOARD_ORIGIN,
        },
        method: "POST",
      }),
      dashboard.services,
    );
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie().join()).toMatch(/lingobridge_session=;.*Max-Age=0/u);
    expect(await resolveWebSession(dashboard.services.webAuth, token)).toBeNull();
  });

  it("disconnect the signed-out user's extensions and nobody else's", async () => {
    async function signedInWithExtension(email: string) {
      const { cookies, csrfToken } = await signInThroughHandlers(dashboard, email);
      const auth = await resolveWebSession(
        dashboard.services.webAuth,
        readCookie(cookies, cookieNames(false).session),
      );
      if (!auth) throw new Error("no session");
      const verifier = createCodeVerifier();
      const parsed = parseConnectionRequest(
        new URLSearchParams({
          code_challenge: createCodeChallenge(verifier),
          code_challenge_method: "S256",
          device_label: "Chrome on Windows",
          redirect_uri: REDIRECT_URI,
          state: "s".repeat(43),
        }),
        dashboard.services.extensionAuth.allowedExtensionIds,
      );
      if (!parsed.ok) throw new Error(parsed.problem);
      const location = new URL(
        await approveExtensionConnection(
          dashboard.services.extensionAuth,
          auth.user.id,
          parsed.request,
        ),
      );
      const exchanged = await exchangeExtensionToken(dashboard.services.extensionAuth, {
        code: location.searchParams.get("code") ?? "",
        codeVerifier: verifier,
        grantType: "authorization_code",
        redirectUri: REDIRECT_URI,
      });
      if (!exchanged.ok) throw new Error(exchanged.error);
      return { cookies, csrfToken, tokens: exchanged.response };
    }

    const leaving = await signedInWithExtension("leaving@example.test");
    const staying = await signedInWithExtension("staying@example.test");

    const response = await handleSignOut(
      new Request(`${DASHBOARD_ORIGIN}/auth/sign-out`, {
        body: new URLSearchParams({ csrf: leaving.csrfToken }),
        headers: {
          Cookie: leaving.cookies,
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: DASHBOARD_ORIGIN,
        },
        method: "POST",
      }),
      dashboard.services,
    );
    expect(response.status).toBe(303);

    const bearer = (token: string) =>
      authenticateExtensionBearer(dashboard.services.extensionAuth, `Bearer ${token}`);
    await expect(bearer(leaving.tokens.accessToken)).resolves.toEqual({ kind: "revoked" });
    await expect(
      exchangeExtensionToken(dashboard.services.extensionAuth, {
        grantType: "refresh_token",
        refreshToken: leaving.tokens.refreshToken,
      }),
    ).resolves.toEqual({ error: "session-revoked", ok: false });
    await expect(bearer(staying.tokens.accessToken)).resolves.toMatchObject({ kind: "active" });
  });

  it("refuse sign-out without the CSRF token or from another origin", async () => {
    const { cookies, csrfToken } = await signInThroughHandlers(dashboard, "csrf@example.test");
    const attempt = (headers: Record<string, string>, csrf: string) =>
      handleSignOut(
        new Request(`${DASHBOARD_ORIGIN}/auth/sign-out`, {
          body: new URLSearchParams({ csrf }),
          headers: {
            Cookie: cookies,
            "Content-Type": "application/x-www-form-urlencoded",
            ...headers,
          },
          method: "POST",
        }),
        dashboard.services,
      );
    expect((await attempt({ Origin: DASHBOARD_ORIGIN }, "wrong")).status).toBe(403);
    expect((await attempt({ Origin: "https://evil.test" }, csrfToken)).status).toBe(403);
    expect(
      (await attempt({ Origin: DASHBOARD_ORIGIN, "Sec-Fetch-Site": "cross-site" }, csrfToken))
        .status,
    ).toBe(403);
  });

  it("bind CSRF tokens to the session and the server secret", () => {
    const secret = dashboard.services.webAuth.sessionSecret;
    const token = deriveCsrfToken(secret, "session-a");
    expect(verifySessionCsrf({ sessionSecret: secret }, "session-a", token)).toBe(true);
    expect(verifySessionCsrf({ sessionSecret: secret }, "session-b", token)).toBe(false);
    expect(
      verifySessionCsrf(
        { sessionSecret: "another-secret-that-is-long-enough-xx" },
        "session-a",
        token,
      ),
    ).toBe(false);
    expect(verifySessionCsrf({ sessionSecret: secret }, "session-a", null)).toBe(false);
  });

  it("require recent authentication and re-authenticate the same account only", async () => {
    const { cookies } = await signInThroughHandlers(dashboard, "reauth@example.test");
    const token = readCookie(cookies, cookieNames(false).session);
    const auth = await resolveWebSession(dashboard.services.webAuth, token);
    if (!auth) throw new Error("no session");
    expect(isRecentlyAuthenticated(auth.session, dashboard.clock.now())).toBe(true);
    dashboard.clock.advance(AUTH_POLICY.recentAuthenticationMilliseconds + 1);
    expect(isRecentlyAuthenticated(auth.session, dashboard.clock.now())).toBe(false);

    const reauth = async (email: string) => {
      const start = await beginSignIn(dashboard.services.webAuth, {
        purpose: "reauthenticate",
        returnTo: "/privacy",
        userId: auth.user.id,
      });
      const authorize = new URL(start.authorizationUrl);
      expect(authorize.searchParams.get("prompt")).toBe("login");
      expect(authorize.searchParams.get("max_age")).toBe("0");
      const callback = new URL(
        dashboard.services.developmentIdentity?.issueCode(authorize.searchParams, {
          email,
          name: "x",
        }) ?? "",
      );
      return completeSignIn(dashboard.services.webAuth, {
        browserBinding: start.browserBinding,
        code: callback.searchParams.get("code"),
        currentSessionToken: token,
        providerError: null,
        state: callback.searchParams.get("state"),
      });
    };

    await expect(reauth("someone-else@example.test")).resolves.toEqual({
      kind: "failed",
      reason: "account-mismatch",
    });
    await expect(reauth("reauth@example.test")).resolves.toEqual({
      kind: "reauthenticated",
      returnTo: "/privacy",
    });
    const refreshed = await resolveWebSession(dashboard.services.webAuth, token);
    expect(refreshed && isRecentlyAuthenticated(refreshed.session, dashboard.clock.now())).toBe(
      true,
    );
  });
});

describe("handlers and redirects", () => {
  it("keep return paths on the dashboard", () => {
    expect(sanitizeReturnPath("/phrases?q=hello#top")).toBe("/phrases?q=hello#top");
    for (const hostile of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(sanitizeReturnPath(hostile)).toBe("/overview");
    }
  });

  it("set an HttpOnly, SameSite=Lax login binding and a session cookie only after the callback", async () => {
    const start = await handleSignInStart(
      new Request(`${DASHBOARD_ORIGIN}/auth/sign-in?returnTo=/privacy`),
      dashboard.services,
    );
    const binding = start.headers.getSetCookie()[0] ?? "";
    expect(binding).toMatch(/^lingobridge_login=/u);
    expect(binding).toContain("HttpOnly");
    expect(binding).toContain("SameSite=Lax");
    expect(binding).not.toContain("lingobridge_session");

    const failed = await handleCallback(
      new Request(`${DASHBOARD_ORIGIN}/auth/callback?state=x&code=y`, {
        headers: { Cookie: cookieHeader(start) },
      }),
      dashboard.services,
    );
    expect(failed.headers.get("Location")).toBe(`${DASHBOARD_ORIGIN}/sign-in?error=invalid-state`);
    expect(failed.headers.getSetCookie().join()).not.toMatch(/lingobridge_session=[A-Za-z0-9]/u);
  });

  it("sign out even when the browser has no session", async () => {
    await expect(signOut(dashboard.services.webAuth, null)).resolves.toBeUndefined();
  });
});
