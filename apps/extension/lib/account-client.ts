import { ONLINE_PROVIDER_CONSENT_VERSION } from "@lingobridge/contracts";
import {
  accountApiErrorSchema,
  DASHBOARD_API_ROUTES,
  EXTENSION_CONNECT_PATH,
  type ExtensionTokenResponse,
  extensionTokenResponseSchema,
  type SavedWordRecord,
  type SyncRequest,
  type SyncResponse,
  syncResponseSchema,
  vocabularyUpsertResponseSchema,
} from "@lingobridge/contracts/account";
import type { CredentialStore, StoredCredentials } from "./account-credentials";

export type AccountFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class AccountClientError extends Error {
  readonly kind:
    | "network"
    | "revoked"
    | "invalid-response"
    | "rejected"
    | "rate-limited"
    | "server";
  readonly retryable: boolean;

  constructor(kind: AccountClientError["kind"], message: string, retryable: boolean) {
    super(message);
    this.name = "AccountClientError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

/* ---------- PKCE and the interactive connection URL ---------- */

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function randomUrlSafe(byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function createPkcePair(): Promise<{ challenge: string; verifier: string }> {
  const verifier = randomUrlSafe(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { challenge: base64Url(new Uint8Array(digest)), verifier };
}

export function buildConnectUrl(input: {
  challenge: string;
  dashboardOrigin: string;
  deviceLabel: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(EXTENSION_CONNECT_PATH, input.dashboardOrigin);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("device_label", input.deviceLabel);
  return url.toString();
}

export type AuthorizationRedirect =
  | { code: string; kind: "code"; onlineConsentAccepted: boolean }
  | { kind: "denied" }
  | { kind: "invalid" };

/** The state must match exactly; anything else is discarded without exchanging a code. */
export function parseAuthorizationRedirect(
  responseUrl: string | undefined,
  expectedRedirectUri: string,
  expectedState: string,
): AuthorizationRedirect {
  if (!responseUrl) return { kind: "invalid" };
  let url: URL;
  try {
    url = new URL(responseUrl);
  } catch {
    return { kind: "invalid" };
  }
  const expected = new URL(expectedRedirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname)
    return { kind: "invalid" };
  if (url.searchParams.get("state") !== expectedState) return { kind: "invalid" };
  if (url.searchParams.get("error") === "access_denied") return { kind: "denied" };
  const code = url.searchParams.get("code");
  return code && /^[A-Za-z0-9_-]{32,128}$/u.test(code)
    ? {
        code,
        kind: "code",
        onlineConsentAccepted:
          url.searchParams.get("online_consent_version") === ONLINE_PROVIDER_CONSENT_VERSION,
      }
    : { kind: "invalid" };
}

/* ---------- Authenticated API client ---------- */

export interface AccountClientOptions {
  credentials: CredentialStore;
  dashboardOrigin: string;
  fetcher?: AccountFetch;
  now?: () => Date;
}

const REFRESH_MARGIN_MILLISECONDS = 60_000;

export function createAccountClient(options: AccountClientOptions) {
  const fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? (() => new Date());
  let refreshing: Promise<StoredCredentials> | null = null;

  async function post(route: string, body: unknown, accessToken?: string): Promise<Response> {
    try {
      return await fetcher(new URL(route, options.dashboardOrigin).toString(), {
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        method: "POST",
      });
    } catch {
      throw new AccountClientError(
        "network",
        "The dashboard can’t be reached. Sync will retry.",
        true,
      );
    }
  }

  async function failure(response: Response): Promise<AccountClientError> {
    const parsed = accountApiErrorSchema.safeParse(await response.json().catch(() => null));
    const code = parsed.success ? parsed.data.code : null;
    if (code === "session-revoked" || code === "invalid-grant" || code === "unauthorized") {
      return new AccountClientError(
        "revoked",
        "This extension is no longer connected to the dashboard.",
        false,
      );
    }
    if (response.status === 429) {
      return new AccountClientError(
        "rate-limited",
        "Syncing is paused briefly. It will retry.",
        true,
      );
    }
    if (response.status >= 500) {
      return new AccountClientError(
        "server",
        "The dashboard had a problem. Sync will retry.",
        true,
      );
    }
    return new AccountClientError(
      "rejected",
      parsed.success ? parsed.data.message : "The dashboard refused the request.",
      false,
    );
  }

  async function exchange(body: unknown): Promise<StoredCredentials> {
    const response = await post(DASHBOARD_API_ROUTES.extensionToken, body);
    if (!response.ok) throw await failure(response);
    const parsed = extensionTokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new AccountClientError(
        "invalid-response",
        "The dashboard returned an unexpected response.",
        true,
      );
    }
    return options.credentials.save(parsed.data);
  }

  /** Single-flight: concurrent callers share one rotation, so a refresh token is never reused. */
  function refresh(current: StoredCredentials): Promise<StoredCredentials> {
    refreshing ??= exchange({
      grantType: "refresh_token",
      refreshToken: current.refreshToken,
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function validCredentials(): Promise<StoredCredentials> {
    const current = await options.credentials.load();
    if (!current)
      throw new AccountClientError("revoked", "This extension is not connected.", false);
    if (Date.parse(current.accessTokenExpiresAt) - REFRESH_MARGIN_MILLISECONDS > now().getTime())
      return current;
    return refresh(current);
  }

  return {
    async exchangeCode(input: {
      code: string;
      codeVerifier: string;
      redirectUri: string;
    }): Promise<ExtensionTokenResponse> {
      return exchange({ ...input, grantType: "authorization_code" });
    },

    async sync(request: SyncRequest): Promise<SyncResponse> {
      let credentials = await validCredentials();
      let response = await post(DASHBOARD_API_ROUTES.sync, request, credentials.accessToken);
      if (response.status === 401) {
        const parsed = accountApiErrorSchema.safeParse(
          await response
            .clone()
            .json()
            .catch(() => null),
        );
        if (parsed.success && parsed.data.code === "session-expired") {
          credentials = await refresh(credentials);
          response = await post(DASHBOARD_API_ROUTES.sync, request, credentials.accessToken);
        }
      }
      if (!response.ok) throw await failure(response);
      const parsed = syncResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        throw new AccountClientError(
          "invalid-response",
          "The dashboard returned an unexpected sync response.",
          true,
        );
      }
      return parsed.data;
    },

    async saveWord(word: SavedWordRecord): Promise<void> {
      let credentials = await validCredentials();
      let response = await post(DASHBOARD_API_ROUTES.vocabulary, { word }, credentials.accessToken);
      if (response.status === 401) {
        credentials = await refresh(credentials);
        response = await post(DASHBOARD_API_ROUTES.vocabulary, { word }, credentials.accessToken);
      }
      if (!response.ok) throw await failure(response);
      const parsed = vocabularyUpsertResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success) {
        throw new AccountClientError(
          "invalid-response",
          "The dashboard returned an unexpected vocabulary response.",
          true,
        );
      }
    },

    /** Best effort: local credentials are removed whether or not the dashboard is reachable. */
    async disconnect(): Promise<void> {
      const current = await options.credentials.load();
      try {
        if (current) await post(DASHBOARD_API_ROUTES.extensionRevoke, {}, current.accessToken);
      } catch {
        // Offline: the session still expires, and it can be revoked from the dashboard.
      } finally {
        await options.credentials.clear();
      }
    },
  };
}

export type AccountClient = ReturnType<typeof createAccountClient>;
