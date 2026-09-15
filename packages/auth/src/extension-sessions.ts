import {
  deviceLabelSchema,
  type ExtensionTokenRequest,
  type ExtensionTokenResponse,
} from "@lingobridge/contracts/account";
import {
  authenticateExtensionAccessToken,
  consumeExtensionAuthorizationCode,
  createExtensionAuthorizationCode,
  createExtensionSession,
  type Database,
  type ExtensionSession,
  findUserById,
  revokeExtensionSession,
  rotateExtensionRefreshToken,
  type User,
} from "@lingobridge/database";
import { hashToken, isValidCodeChallenge, randomToken, verifyPkce } from "./crypto.js";
import { AUTH_POLICY } from "./policy.js";

export interface ExtensionIdAllowlist {
  has(extensionId: string): boolean;
}

export interface ExtensionAuthDependencies {
  /** Exact Chrome extension ids allowed to connect. Unknown installations cannot obtain codes. */
  allowedExtensionIds: ExtensionIdAllowlist;
  database: Database;
  now: () => Date;
}

const EXTENSION_ID = /^[a-p]{32}$/u;

/**
 * Chrome's identity redirect is `https://<extension-id>.chromiumapp.org/<optional-path>`. The URL
 * must match that shape exactly and name an allowlisted extension, so a code can only ever be
 * delivered back to the extension that asked for it.
 */
export function parseExtensionRedirectUri(
  value: string,
  allowedExtensionIds: ExtensionIdAllowlist,
): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  if (url.search || url.hash) return null;
  const match = /^([a-p]{32})\.chromiumapp\.org$/u.exec(url.hostname);
  const extensionId = match?.[1];
  if (!extensionId || !EXTENSION_ID.test(extensionId)) return null;
  if (!allowedExtensionIds.has(extensionId)) return null;
  if (!/^\/[A-Za-z0-9_-]{0,40}$/u.test(url.pathname)) return null;
  return extensionId;
}

export type ConnectionRequestProblem =
  | "invalid-redirect"
  | "invalid-challenge"
  | "invalid-state"
  | "invalid-device-label";

export interface ExtensionConnectionRequest {
  codeChallenge: string;
  deviceLabel: string;
  extensionId: string;
  redirectUri: string;
  state: string;
}

/** Validates the query the extension opened; nothing is created until the user approves. */
export function parseConnectionRequest(
  params: URLSearchParams,
  allowedExtensionIds: ExtensionIdAllowlist,
):
  | { ok: true; request: ExtensionConnectionRequest }
  | { ok: false; problem: ConnectionRequestProblem } {
  const redirectUri = params.get("redirect_uri") ?? "";
  const extensionId = parseExtensionRedirectUri(redirectUri, allowedExtensionIds);
  if (!extensionId) return { ok: false, problem: "invalid-redirect" };
  if (
    params.get("code_challenge_method") !== "S256" ||
    !isValidCodeChallenge(params.get("code_challenge") ?? "")
  ) {
    return { ok: false, problem: "invalid-challenge" };
  }
  const state = params.get("state") ?? "";
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(state)) return { ok: false, problem: "invalid-state" };
  const label = deviceLabelSchema.safeParse(params.get("device_label") ?? "Chrome");
  if (!label.success) return { ok: false, problem: "invalid-device-label" };
  return {
    ok: true,
    request: {
      codeChallenge: params.get("code_challenge") ?? "",
      deviceLabel: label.data,
      extensionId,
      redirectUri,
      state,
    },
  };
}

/** Called only after the signed-in user approves; returns Chrome's redirect with a one-time code. */
export async function approveExtensionConnection(
  dependencies: ExtensionAuthDependencies,
  userId: string,
  request: ExtensionConnectionRequest,
): Promise<string> {
  const now = dependencies.now();
  const code = randomToken();
  await createExtensionAuthorizationCode(
    dependencies.database,
    {
      codeChallenge: request.codeChallenge,
      codeHash: hashToken(code),
      deviceLabel: request.deviceLabel,
      expiresAt: new Date(now.getTime() + AUTH_POLICY.extensionAuthorizationCodeMilliseconds),
      extensionId: request.extensionId,
      redirectUri: request.redirectUri,
      userId,
    },
    now,
  );
  const location = new URL(request.redirectUri);
  location.searchParams.set("code", code);
  location.searchParams.set("state", request.state);
  return location.toString();
}

export type TokenExchangeResult =
  | { ok: true; response: ExtensionTokenResponse }
  | { error: "invalid-grant" | "session-revoked"; ok: false };

function accountSummary(user: User): ExtensionTokenResponse["account"] {
  return { displayName: user.displayName, email: user.email };
}

function tokenResponse(
  session: ExtensionSession,
  user: User,
  accessToken: string,
  refreshToken: string,
): ExtensionTokenResponse {
  return {
    accessToken,
    accessTokenExpiresAt: session.accessExpiresAt,
    account: accountSummary(user),
    refreshToken,
    sessionExpiresAt: session.expiresAt,
    sessionId: session.id,
  };
}

export async function exchangeExtensionToken(
  dependencies: ExtensionAuthDependencies,
  request: ExtensionTokenRequest,
): Promise<TokenExchangeResult> {
  const now = dependencies.now();
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const accessExpiresAt = new Date(now.getTime() + AUTH_POLICY.extensionAccessTokenMilliseconds);

  if (request.grantType === "authorization_code") {
    return dependencies.database.transaction(async (client) => {
      const code = await consumeExtensionAuthorizationCode(client, hashToken(request.code), now);
      if (!code) return { error: "invalid-grant", ok: false } as const;
      if (code.redirectUri !== request.redirectUri) {
        return { error: "invalid-grant", ok: false } as const;
      }
      if (!dependencies.allowedExtensionIds.has(code.extensionId)) {
        return { error: "invalid-grant", ok: false } as const;
      }
      if (!verifyPkce(request.codeVerifier, code.codeChallenge)) {
        return { error: "invalid-grant", ok: false } as const;
      }
      const user = await findUserById(client, code.userId);
      if (!user) return { error: "invalid-grant", ok: false } as const;
      const session = await createExtensionSession(
        client,
        {
          accessExpiresAt,
          accessTokenHash: hashToken(accessToken),
          deviceLabel: code.deviceLabel,
          expiresAt: new Date(now.getTime() + AUTH_POLICY.extensionSessionMilliseconds),
          extensionId: code.extensionId,
          refreshTokenHash: hashToken(refreshToken),
          userId: user.id,
        },
        now,
      );
      return { ok: true, response: tokenResponse(session, user, accessToken, refreshToken) };
    });
  }

  const rotation = await rotateExtensionRefreshToken(
    dependencies.database,
    {
      accessExpiresAt,
      newAccessTokenHash: hashToken(accessToken),
      newRefreshTokenHash: hashToken(refreshToken),
      presentedRefreshTokenHash: hashToken(request.refreshToken),
    },
    now,
  );
  if (rotation.kind === "reuse-detected" || rotation.kind === "revoked") {
    return { error: "session-revoked", ok: false };
  }
  if (rotation.kind === "invalid") return { error: "invalid-grant", ok: false };
  const user = await findUserById(dependencies.database, rotation.session.userId);
  if (!user) return { error: "session-revoked", ok: false };
  return { ok: true, response: tokenResponse(rotation.session, user, accessToken, refreshToken) };
}

export type BearerAuthentication =
  | { kind: "active"; session: ExtensionSession; user: User }
  | { kind: "unauthorized" | "expired" | "revoked" };

export function readBearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/u.exec(header ?? "");
  return match?.[1] ?? null;
}

export async function authenticateExtensionBearer(
  dependencies: Pick<ExtensionAuthDependencies, "database" | "now">,
  authorizationHeader: string | null | undefined,
): Promise<BearerAuthentication> {
  const token = readBearerToken(authorizationHeader);
  if (!token) return { kind: "unauthorized" };
  const lookup = await authenticateExtensionAccessToken(
    dependencies.database,
    hashToken(token),
    dependencies.now(),
  );
  if (lookup.kind !== "active") {
    return { kind: lookup.kind === "unknown" ? "unauthorized" : lookup.kind };
  }
  const user = await findUserById(dependencies.database, lookup.session.userId);
  if (!user) return { kind: "revoked" };
  return { kind: "active", session: lookup.session, user };
}

export async function revokeOwnExtensionSession(
  dependencies: Pick<ExtensionAuthDependencies, "database" | "now">,
  session: ExtensionSession,
): Promise<void> {
  await revokeExtensionSession(
    dependencies.database,
    session.userId,
    session.id,
    dependencies.now(),
  );
}
