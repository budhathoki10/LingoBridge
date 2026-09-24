import {
  consumeLoginAttempt,
  createLoginAttempt,
  createWebSession,
  type Database,
  findUserById,
  findUserByIdentity,
  type LoginPurpose,
  markWebSessionReauthenticated,
  revokeAllExtensionSessions,
  revokeWebSession,
  touchWebSession,
  type User,
  type UserRole,
  upsertUserFromIdentity,
  type WebSession,
} from "@lingobridge/database";
import {
  createCodeChallenge,
  createCodeVerifier,
  deriveCsrfToken,
  hashToken,
  randomToken,
  verifyCsrfToken,
} from "./crypto.js";
import { type OidcClient, OidcError } from "./oidc.js";
import { AUTH_POLICY } from "./policy.js";

export interface WebAuthDependencies {
  adminEmails: ReadonlySet<string>;
  database: Database;
  now: () => Date;
  oidc: OidcClient;
  sessionSecret: string;
}

export const DEFAULT_RETURN_PATH = "/overview";

/** Only same-origin absolute paths survive; anything that could leave the dashboard is replaced. */
export function sanitizeReturnPath(value: string | null | undefined): string {
  if (!value || value.length > 512) return DEFAULT_RETURN_PATH;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_RETURN_PATH;
  }
  if (/\p{Cc}/u.test(value)) return DEFAULT_RETURN_PATH;
  try {
    const parsed = new URL(value, "https://dashboard.invalid");
    if (parsed.origin !== "https://dashboard.invalid") return DEFAULT_RETURN_PATH;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
}

export function roleForIdentity(
  adminEmails: ReadonlySet<string>,
  email: string | null,
  emailVerified: boolean,
): UserRole {
  return emailVerified && email && adminEmails.has(email.toLowerCase()) ? "admin" : "user";
}

export interface SignInStart {
  authorizationUrl: string;
  /** Opaque value for the short-lived, HttpOnly login-binding cookie. */
  browserBinding: string;
  bindingExpiresAt: Date;
}

export async function beginSignIn(
  dependencies: WebAuthDependencies,
  input: {
    /** Ask the provider to show its account chooser instead of reusing its current account. */
    chooseAccount?: boolean;
    purpose: LoginPurpose;
    returnTo: string | null;
    userId?: string;
  },
): Promise<SignInStart> {
  const now = dependencies.now();
  const state = randomToken();
  const nonce = randomToken();
  const browserBinding = randomToken();
  const codeVerifier = createCodeVerifier();
  const expiresAt = new Date(now.getTime() + AUTH_POLICY.loginAttemptMilliseconds);

  await createLoginAttempt(
    dependencies.database,
    {
      browserBindingHash: hashToken(browserBinding),
      codeVerifier,
      expiresAt,
      nonce,
      purpose: input.purpose,
      returnTo: sanitizeReturnPath(input.returnTo),
      stateHash: hashToken(state),
      userId: input.purpose === "reauthenticate" ? (input.userId ?? null) : null,
    },
    now,
  );

  const authorizationUrl = await dependencies.oidc.authorizationUrl({
    codeChallenge: createCodeChallenge(codeVerifier),
    nonce,
    state,
    ...(input.purpose === "reauthenticate"
      ? { maxAgeSeconds: 0, prompt: "login" as const }
      : input.chooseAccount
        ? { prompt: "select_account" as const }
        : {}),
  });
  return { authorizationUrl, bindingExpiresAt: expiresAt, browserBinding };
}

export type SignInFailureReason =
  | "invalid-state"
  | "provider-denied"
  | "provider-unavailable"
  | "invalid-token"
  | "account-mismatch";

export type SignInCompletion =
  | {
      kind: "signed-in";
      returnTo: string;
      sessionExpiresAt: Date;
      sessionToken: string;
      user: User;
    }
  | { kind: "reauthenticated"; returnTo: string }
  | { kind: "failed"; reason: SignInFailureReason };

/**
 * Every failure is terminal and reported without detail to the browser. The login attempt is
 * consumed before the provider is contacted, so a callback URL can never be replayed.
 */
export async function completeSignIn(
  dependencies: WebAuthDependencies,
  input: {
    browserBinding: string | null;
    code: string | null;
    currentSessionToken: string | null;
    providerError: string | null;
    state: string | null;
  },
): Promise<SignInCompletion> {
  const now = dependencies.now();
  if (!input.state || !input.browserBinding) return { kind: "failed", reason: "invalid-state" };

  const attempt = await consumeLoginAttempt(
    dependencies.database,
    hashToken(input.state),
    hashToken(input.browserBinding),
    now,
  );
  if (!attempt) return { kind: "failed", reason: "invalid-state" };
  if (input.providerError || !input.code) return { kind: "failed", reason: "provider-denied" };

  let identity: Awaited<ReturnType<OidcClient["verifyIdToken"]>>;
  try {
    const idToken = await dependencies.oidc.exchangeCode({
      code: input.code,
      codeVerifier: attempt.codeVerifier,
    });
    identity = await dependencies.oidc.verifyIdToken(idToken, {
      nonce: attempt.nonce,
      ...(attempt.purpose === "reauthenticate" ? { maxAgeSeconds: 300 } : {}),
    });
  } catch (error) {
    if (error instanceof OidcError && error.reason === "token-exchange-failed") {
      return { kind: "failed", reason: "provider-unavailable" };
    }
    if (error instanceof OidcError && error.reason === "discovery-failed") {
      return { kind: "failed", reason: "provider-unavailable" };
    }
    return { kind: "failed", reason: "invalid-token" };
  }

  if (attempt.purpose === "reauthenticate") {
    const session = input.currentSessionToken
      ? await touchWebSession(
          dependencies.database,
          hashToken(input.currentSessionToken),
          AUTH_POLICY.webSessionIdleMilliseconds,
          now,
        )
      : null;
    const confirmedUser = await findUserByIdentity(
      dependencies.database,
      identity.issuer,
      identity.subject,
    );
    if (!session || !confirmedUser || confirmedUser.id !== attempt.userId) {
      return { kind: "failed", reason: "account-mismatch" };
    }
    if (session.userId !== confirmedUser.id) return { kind: "failed", reason: "account-mismatch" };
    await markWebSessionReauthenticated(dependencies.database, session.id, confirmedUser.id, now);
    return { kind: "reauthenticated", returnTo: attempt.returnTo };
  }

  const sessionToken = randomToken();
  const absoluteExpiresAt = new Date(now.getTime() + AUTH_POLICY.webSessionAbsoluteMilliseconds);
  const user = await dependencies.database.transaction(async (client) => {
    const upserted = await upsertUserFromIdentity(
      client,
      identity,
      roleForIdentity(dependencies.adminEmails, identity.email, identity.emailVerified),
      now,
    );
    await createWebSession(
      client,
      {
        absoluteExpiresAt,
        authenticatedAt: now,
        idleExpiresAt: new Date(now.getTime() + AUTH_POLICY.webSessionIdleMilliseconds),
        tokenHash: hashToken(sessionToken),
        userId: upserted.id,
      },
      now,
    );
    return upserted;
  });

  // A previous session in the same browser is ended rather than left valid alongside the new one.
  if (input.currentSessionToken) {
    await revokeWebSession(dependencies.database, hashToken(input.currentSessionToken), now);
  }
  return {
    kind: "signed-in",
    returnTo: attempt.returnTo,
    sessionExpiresAt: absoluteExpiresAt,
    sessionToken,
    user,
  };
}

export interface AuthenticatedWebSession {
  csrfToken: string;
  session: WebSession;
  user: User;
}

export async function resolveWebSession(
  dependencies: WebAuthDependencies,
  sessionToken: string | null | undefined,
): Promise<AuthenticatedWebSession | null> {
  if (!sessionToken || sessionToken.length > 128) return null;
  const now = dependencies.now();
  const session = await touchWebSession(
    dependencies.database,
    hashToken(sessionToken),
    AUTH_POLICY.webSessionIdleMilliseconds,
    now,
  );
  if (!session) return null;
  const user = await findUserById(dependencies.database, session.userId);
  if (!user) return null;
  return {
    csrfToken: deriveCsrfToken(dependencies.sessionSecret, sessionToken),
    session,
    user,
  };
}

export function verifySessionCsrf(
  dependencies: Pick<WebAuthDependencies, "sessionSecret">,
  sessionToken: string,
  presented: string | null | undefined,
): boolean {
  return verifyCsrfToken(dependencies.sessionSecret, sessionToken, presented);
}

export function isRecentlyAuthenticated(session: WebSession, now: Date): boolean {
  return (
    now.getTime() - Date.parse(session.authenticatedAt) <=
    AUTH_POLICY.recentAuthenticationMilliseconds
  );
}

/**
 * Signing out ends this web session and disconnects every extension installation on the account,
 * so an extension never keeps syncing for someone who signed out. Other browsers' web sessions stay
 * signed in.
 */
export async function signOut(
  dependencies: WebAuthDependencies,
  sessionToken: string | null | undefined,
): Promise<void> {
  if (!sessionToken || sessionToken.length > 128) return;
  const now = dependencies.now();
  await dependencies.database.transaction(async (client) => {
    const userId = await revokeWebSession(client, hashToken(sessionToken), now);
    if (userId) await revokeAllExtensionSessions(client, userId, "user", now);
  });
}
