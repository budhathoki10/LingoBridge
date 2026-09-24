import type { ExtensionTokenResponse } from "@lingobridge/contracts/account";
import { describe, expect, it } from "vitest";
import {
  AccountClientError,
  buildConnectUrl,
  createAccountClient,
  createPkcePair,
  parseAuthorizationRedirect,
} from "../../apps/extension/lib/account-client";
import {
  createMemoryCredentialStore,
  parseStoredCredentials,
} from "../../apps/extension/lib/account-credentials";
import { parseAccountMessage } from "../../apps/extension/lib/account-status";

const ORIGIN = "http://127.0.0.1:3000";
const REDIRECT = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/lingobridge";
const token = (seed: string) => seed.repeat(43).slice(0, 43);

function tokens(overrides: Partial<ExtensionTokenResponse> = {}): ExtensionTokenResponse {
  return {
    accessToken: token("a"),
    accessTokenExpiresAt: "2026-09-14T10:15:00.000Z",
    account: { displayName: "D", email: "d@example.test" },
    refreshToken: token("r"),
    sessionExpiresAt: "2026-12-13T10:00:00.000Z",
    sessionId: "6f0f7a0e-0000-4000-8000-000000000001",
    ...overrides,
  };
}

const emptySync = {
  changes: { phrases: [], preferences: null },
  cursor: "1",
  fullResync: false,
  hasMore: false,
  phraseSyncEnabled: true,
  results: [],
};

describe("connection URL and redirect", () => {
  it("builds a PKCE S256 request to the dashboard consent page", async () => {
    const pair = await createPkcePair();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{64}$/u);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pair.verifier));
    expect(Buffer.from(digest).toString("base64url")).toBe(pair.challenge);

    const url = new URL(
      buildConnectUrl({
        challenge: pair.challenge,
        dashboardOrigin: ORIGIN,
        deviceLabel: "Chrome on Windows",
        redirectUri: REDIRECT,
        state: "s".repeat(43),
      }),
    );
    expect(url.pathname).toBe("/extension/connect");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("code_verifier")).toBe(false);
  });

  it("accepts a code only with the exact state and redirect", () => {
    const state = "s".repeat(43);
    const code = "c".repeat(43);
    expect(
      parseAuthorizationRedirect(`${REDIRECT}?code=${code}&state=${state}`, REDIRECT, state),
    ).toEqual({ code, kind: "code", onlineConsentAccepted: false });
    expect(
      parseAuthorizationRedirect(
        `${REDIRECT}?code=${code}&state=${state}&online_consent_version=mymemory-primary-nvidia-backup-v2`,
        REDIRECT,
        state,
      ),
    ).toEqual({ code, kind: "code", onlineConsentAccepted: true });
    expect(
      parseAuthorizationRedirect(`${REDIRECT}?code=${code}&state=other`, REDIRECT, state),
    ).toEqual({ kind: "invalid" });
    expect(
      parseAuthorizationRedirect(
        `https://evil.test/lingobridge?code=${code}&state=${state}`,
        REDIRECT,
        state,
      ),
    ).toEqual({ kind: "invalid" });
    expect(
      parseAuthorizationRedirect(`${REDIRECT}?error=access_denied&state=${state}`, REDIRECT, state),
    ).toEqual({ kind: "denied" });
    expect(parseAuthorizationRedirect(undefined, REDIRECT, state)).toEqual({ kind: "invalid" });
  });
});

describe("authenticated client", () => {
  it("refreshes an expiring access token once even when calls overlap", async () => {
    let refreshes = 0;
    const store = createMemoryCredentialStore({
      ...tokens({ accessTokenExpiresAt: "2026-09-14T10:00:30.000Z" }),
      storedAt: "x",
    });
    const client = createAccountClient({
      credentials: store,
      dashboardOrigin: ORIGIN,
      fetcher: async (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (url.endsWith("/api/v1/extension/token")) {
          refreshes += 1;
          expect(body).toEqual({ grantType: "refresh_token", refreshToken: token("r") });
          await new Promise((resolve) => setTimeout(resolve, 10));
          return Response.json(tokens({ accessToken: token("b"), refreshToken: token("s") }));
        }
        expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token("b")}`);
        expect(init?.credentials).toBe("omit");
        return Response.json(emptySync);
      },
      now: () => new Date("2026-09-14T10:00:00.000Z"),
    });

    await Promise.all([
      client.sync({ cursor: null, mutations: [] }),
      client.sync({ cursor: null, mutations: [] }),
    ]);
    expect(refreshes).toBe(1);
    expect((await store.load())?.refreshToken).toBe(token("s"));
  });

  it("retries once after the server reports an expired access token", async () => {
    const calls: string[] = [];
    const client = createAccountClient({
      credentials: createMemoryCredentialStore({ ...tokens(), storedAt: "x" }),
      dashboardOrigin: ORIGIN,
      fetcher: async (url) => {
        calls.push(new URL(url).pathname);
        if (url.endsWith("/token")) return Response.json(tokens({ accessToken: token("n") }));
        if (calls.filter((path) => path === "/api/v1/sync").length === 1) {
          return Response.json(
            { code: "session-expired", message: "expired", retryable: true },
            { status: 401 },
          );
        }
        return Response.json(emptySync);
      },
      now: () => new Date("2026-09-14T10:00:00.000Z"),
    });
    await client.sync({ cursor: null, mutations: [] });
    expect(calls).toEqual(["/api/v1/sync", "/api/v1/extension/token", "/api/v1/sync"]);
  });

  it("classifies revocation, network failures, and malformed responses", async () => {
    const make = (fetcher: Parameters<typeof createAccountClient>[0]["fetcher"]) =>
      createAccountClient({
        credentials: createMemoryCredentialStore({ ...tokens(), storedAt: "x" }),
        dashboardOrigin: ORIGIN,
        fetcher,
        now: () => new Date("2026-09-14T10:00:00.000Z"),
      });

    await expect(
      make(async () =>
        Response.json(
          { code: "session-revoked", message: "gone", retryable: false },
          { status: 401 },
        ),
      ).sync({ cursor: null, mutations: [] }),
    ).rejects.toMatchObject({ kind: "revoked", retryable: false });
    await expect(
      make(async () => {
        throw new TypeError("offline");
      }).sync({ cursor: null, mutations: [] }),
    ).rejects.toMatchObject({ kind: "network", retryable: true });
    await expect(
      make(async () => Response.json({ nope: true })).sync({ cursor: null, mutations: [] }),
    ).rejects.toBeInstanceOf(AccountClientError);
    await expect(
      make(async () => new Response("", { status: 503 })).sync({ cursor: null, mutations: [] }),
    ).rejects.toMatchObject({ kind: "server", retryable: true });
  });

  it("clears credentials on disconnect even when the dashboard is unreachable", async () => {
    const store = createMemoryCredentialStore({ ...tokens(), storedAt: "x" });
    const client = createAccountClient({
      credentials: store,
      dashboardOrigin: ORIGIN,
      fetcher: async () => {
        throw new TypeError("offline");
      },
    });
    await client.disconnect();
    expect(await store.load()).toBeNull();
  });
});

describe("credential and message validation", () => {
  it("drops malformed stored credentials", () => {
    expect(parseStoredCredentials({ accessToken: "short" })).toBeNull();
    expect(parseStoredCredentials({ ...tokens(), storedAt: "2026-09-14" })).not.toBeNull();
  });

  it("accepts only known account messages", () => {
    expect(parseAccountMessage({ type: "lingobridge:account:connect" })).toBe(
      "lingobridge:account:connect",
    );
    expect(parseAccountMessage({ type: "lingobridge:account:read-token" })).toBeNull();
    expect(parseAccountMessage(null)).toBeNull();
  });
});
