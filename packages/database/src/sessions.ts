import { randomUUID } from "node:crypto";
import { type SqlClient, toIsoString, toNullableIsoString } from "./client.js";

/* ---------------------------------------------------------------------------------------------
 * Sign-in attempts. The state value travels through the identity provider; the browser binding
 * lives in a cookie. A callback must present both, once, before expiry.
 * ------------------------------------------------------------------------------------------- */

export type LoginPurpose = "sign-in" | "reauthenticate";

export interface LoginAttempt {
  codeVerifier: string;
  nonce: string;
  purpose: LoginPurpose;
  returnTo: string;
  userId: string | null;
}

export async function createLoginAttempt(
  client: SqlClient,
  input: LoginAttempt & { browserBindingHash: string; expiresAt: Date; stateHash: string },
  now: Date,
): Promise<void> {
  await client.query(
    `insert into login_attempts (id, state_hash, browser_binding_hash, nonce, code_verifier,
                                 purpose, return_to, user_id, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      randomUUID(),
      input.stateHash,
      input.browserBindingHash,
      input.nonce,
      input.codeVerifier,
      input.purpose,
      input.returnTo,
      input.userId,
      now,
      input.expiresAt,
    ],
  );
}

/** Single use: the row is consumed atomically, so a replayed callback finds nothing. */
export async function consumeLoginAttempt(
  client: SqlClient,
  stateHash: string,
  browserBindingHash: string,
  now: Date,
): Promise<LoginAttempt | null> {
  const { rows } = await client.query<{
    code_verifier: string;
    nonce: string;
    purpose: LoginPurpose;
    return_to: string;
    user_id: string | null;
  }>(
    `update login_attempts set consumed_at = $3
     where state_hash = $1 and browser_binding_hash = $2
       and consumed_at is null and expires_at > $3
     returning nonce, code_verifier, purpose, return_to, user_id`,
    [stateHash, browserBindingHash, now],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    codeVerifier: row.code_verifier,
    nonce: row.nonce,
    purpose: row.purpose,
    returnTo: row.return_to,
    userId: row.user_id,
  };
}

export async function purgeExpiredLoginAttempts(client: SqlClient, now: Date): Promise<void> {
  await client.query("delete from login_attempts where expires_at <= $1", [now]);
  await client.query("delete from extension_authorization_codes where expires_at <= $1", [now]);
}

/* ---------------------------------------------------------------------------------------------
 * Dashboard web sessions.
 * ------------------------------------------------------------------------------------------- */

export interface WebSession {
  absoluteExpiresAt: string;
  authenticatedAt: string;
  id: string;
  idleExpiresAt: string;
  userId: string;
}

interface WebSessionRow {
  absolute_expires_at: unknown;
  authenticated_at: unknown;
  id: string;
  idle_expires_at: unknown;
  user_id: string;
}

function toWebSession(row: WebSessionRow): WebSession {
  return {
    absoluteExpiresAt: toIsoString(row.absolute_expires_at),
    authenticatedAt: toIsoString(row.authenticated_at),
    id: row.id,
    idleExpiresAt: toIsoString(row.idle_expires_at),
    userId: row.user_id,
  };
}

export async function createWebSession(
  client: SqlClient,
  input: {
    absoluteExpiresAt: Date;
    authenticatedAt: Date;
    idleExpiresAt: Date;
    tokenHash: string;
    userId: string;
  },
  now: Date,
): Promise<WebSession> {
  const { rows } = await client.query<WebSessionRow>(
    `insert into web_sessions (id, user_id, token_hash, created_at, last_seen_at,
                               idle_expires_at, absolute_expires_at, authenticated_at)
     values ($1, $2, $3, $4, $4, $5, $6, $7)
     returning id, user_id, idle_expires_at, absolute_expires_at, authenticated_at`,
    [
      randomUUID(),
      input.userId,
      input.tokenHash,
      now,
      input.idleExpiresAt,
      input.absoluteExpiresAt,
      input.authenticatedAt,
    ],
  );
  if (!rows[0]) throw new Error("Web session insert returned no row.");
  return toWebSession(rows[0]);
}

/**
 * Finds a live session and slides its idle expiry forward in the same statement. The idle window
 * never extends past the absolute expiry, and a deleted account's sessions never match.
 */
export async function touchWebSession(
  client: SqlClient,
  tokenHash: string,
  idleMilliseconds: number,
  now: Date,
): Promise<WebSession | null> {
  const { rows } = await client.query<WebSessionRow>(
    `update web_sessions s
        set last_seen_at = $2,
            idle_expires_at = least(s.absolute_expires_at, $3::timestamptz)
       from users u
      where s.token_hash = $1 and u.id = s.user_id and u.deleted_at is null
        and s.revoked_at is null and s.idle_expires_at > $2 and s.absolute_expires_at > $2
      returning s.id, s.user_id, s.idle_expires_at, s.absolute_expires_at, s.authenticated_at`,
    [tokenHash, now, new Date(now.getTime() + idleMilliseconds)],
  );
  return rows[0] ? toWebSession(rows[0]) : null;
}

export async function markWebSessionReauthenticated(
  client: SqlClient,
  sessionId: string,
  userId: string,
  now: Date,
): Promise<void> {
  await client.query(
    `update web_sessions set authenticated_at = $3
     where id = $1 and user_id = $2 and revoked_at is null`,
    [sessionId, userId, now],
  );
}

export async function revokeWebSession(
  client: SqlClient,
  tokenHash: string,
  now: Date,
): Promise<string | null> {
  const { rows } = await client.query<{ user_id: string }>(
    "update web_sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null returning user_id",
    [tokenHash, now],
  );
  return rows[0]?.user_id ?? null;
}

/* ---------------------------------------------------------------------------------------------
 * Extension connection codes and sessions.
 * ------------------------------------------------------------------------------------------- */

export interface ExtensionAuthorizationCode {
  codeChallenge: string;
  deviceLabel: string;
  extensionId: string;
  redirectUri: string;
  userId: string;
}

export async function createExtensionAuthorizationCode(
  client: SqlClient,
  input: ExtensionAuthorizationCode & { codeHash: string; expiresAt: Date },
  now: Date,
): Promise<void> {
  await client.query(
    `insert into extension_authorization_codes
       (code_hash, user_id, extension_id, redirect_uri, code_challenge, device_label,
        created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.codeHash,
      input.userId,
      input.extensionId,
      input.redirectUri,
      input.codeChallenge,
      input.deviceLabel,
      now,
      input.expiresAt,
    ],
  );
}

export async function consumeExtensionAuthorizationCode(
  client: SqlClient,
  codeHash: string,
  now: Date,
): Promise<ExtensionAuthorizationCode | null> {
  const { rows } = await client.query<{
    code_challenge: string;
    device_label: string;
    extension_id: string;
    redirect_uri: string;
    user_id: string;
  }>(
    `update extension_authorization_codes c set consumed_at = $2
       from users u
      where c.code_hash = $1 and u.id = c.user_id and u.deleted_at is null
        and c.consumed_at is null and c.expires_at > $2
      returning c.user_id, c.extension_id, c.redirect_uri, c.code_challenge, c.device_label`,
    [codeHash, now],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    codeChallenge: row.code_challenge,
    deviceLabel: row.device_label,
    extensionId: row.extension_id,
    redirectUri: row.redirect_uri,
    userId: row.user_id,
  };
}

export type ExtensionSessionRevocationReason = "user" | "refresh-reuse" | "account-deleted";

export interface ExtensionSession {
  accessExpiresAt: string;
  createdAt: string;
  deviceLabel: string;
  expiresAt: string;
  extensionId: string;
  id: string;
  lastUsedAt: string;
  revokedAt: string | null;
  revokedReason: ExtensionSessionRevocationReason | null;
  userId: string;
}

interface ExtensionSessionRow {
  access_expires_at: unknown;
  created_at: unknown;
  device_label: string;
  expires_at: unknown;
  extension_id: string;
  id: string;
  last_used_at: unknown;
  revoked_at: unknown;
  revoked_reason: ExtensionSessionRevocationReason | null;
  user_id: string;
}

const EXTENSION_SESSION_COLUMNS = `s.id, s.user_id, s.extension_id, s.device_label,
  s.access_expires_at, s.created_at, s.last_used_at, s.expires_at, s.revoked_at, s.revoked_reason`;

function toExtensionSession(row: ExtensionSessionRow): ExtensionSession {
  return {
    accessExpiresAt: toIsoString(row.access_expires_at),
    createdAt: toIsoString(row.created_at),
    deviceLabel: row.device_label,
    expiresAt: toIsoString(row.expires_at),
    extensionId: row.extension_id,
    id: row.id,
    lastUsedAt: toIsoString(row.last_used_at),
    revokedAt: toNullableIsoString(row.revoked_at),
    revokedReason: row.revoked_reason,
    userId: row.user_id,
  };
}

export async function createExtensionSession(
  client: SqlClient,
  input: {
    accessExpiresAt: Date;
    accessTokenHash: string;
    deviceLabel: string;
    expiresAt: Date;
    extensionId: string;
    refreshTokenHash: string;
    userId: string;
  },
  now: Date,
): Promise<ExtensionSession> {
  const { rows } = await client.query<ExtensionSessionRow>(
    `insert into extension_sessions as s
       (id, user_id, extension_id, device_label, access_token_hash, access_expires_at,
        refresh_token_hash, created_at, last_used_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
     returning ${EXTENSION_SESSION_COLUMNS}`,
    [
      randomUUID(),
      input.userId,
      input.extensionId,
      input.deviceLabel,
      input.accessTokenHash,
      input.accessExpiresAt,
      input.refreshTokenHash,
      now,
      input.expiresAt,
    ],
  );
  if (!rows[0]) throw new Error("Extension session insert returned no row.");
  return toExtensionSession(rows[0]);
}

export type AccessTokenLookup =
  | { kind: "active"; session: ExtensionSession }
  | { kind: "expired" }
  | { kind: "revoked" }
  | { kind: "unknown" };

export async function authenticateExtensionAccessToken(
  client: SqlClient,
  accessTokenHash: string,
  now: Date,
): Promise<AccessTokenLookup> {
  const { rows } = await client.query<ExtensionSessionRow & { user_deleted_at: unknown }>(
    `select ${EXTENSION_SESSION_COLUMNS}, u.deleted_at as user_deleted_at
       from extension_sessions s join users u on u.id = s.user_id
      where s.access_token_hash = $1`,
    [accessTokenHash],
  );
  const row = rows[0];
  if (!row) return { kind: "unknown" };
  if (row.revoked_at !== null || row.user_deleted_at !== null) return { kind: "revoked" };
  const session = toExtensionSession(row);
  if (Date.parse(session.accessExpiresAt) <= now.getTime()) return { kind: "expired" };
  if (Date.parse(session.expiresAt) <= now.getTime()) return { kind: "expired" };

  await client.query("update extension_sessions set last_used_at = $2 where id = $1", [
    session.id,
    now,
  ]);
  return { kind: "active", session: { ...session, lastUsedAt: now.toISOString() } };
}

export type RefreshRotation =
  | { kind: "rotated"; session: ExtensionSession }
  | { kind: "reuse-detected" }
  | { kind: "revoked" }
  | { kind: "invalid" };

/**
 * Refresh tokens rotate on every use. Presenting the token that was just replaced means two
 * parties hold the same credential, so the whole session is revoked rather than guessing which one
 * is legitimate.
 */
export async function rotateExtensionRefreshToken(
  client: SqlClient,
  input: {
    accessExpiresAt: Date;
    newAccessTokenHash: string;
    newRefreshTokenHash: string;
    presentedRefreshTokenHash: string;
  },
  now: Date,
): Promise<RefreshRotation> {
  const { rows } = await client.query<ExtensionSessionRow>(
    `update extension_sessions s
        set previous_refresh_token_hash = s.refresh_token_hash,
            refresh_token_hash = $2,
            access_token_hash = $3,
            access_expires_at = least(s.expires_at, $4::timestamptz),
            last_used_at = $5
       from users u
      where s.refresh_token_hash = $1 and u.id = s.user_id and u.deleted_at is null
        and s.revoked_at is null and s.expires_at > $5
      returning ${EXTENSION_SESSION_COLUMNS}`,
    [
      input.presentedRefreshTokenHash,
      input.newRefreshTokenHash,
      input.newAccessTokenHash,
      input.accessExpiresAt,
      now,
    ],
  );
  if (rows[0]) return { kind: "rotated", session: toExtensionSession(rows[0]) };

  const reused = await client.query<{ id: string }>(
    `update extension_sessions set revoked_at = $2, revoked_reason = 'refresh-reuse'
      where previous_refresh_token_hash = $1 and revoked_at is null
      returning id`,
    [input.presentedRefreshTokenHash, now],
  );
  if (reused.rows.length > 0) return { kind: "reuse-detected" };

  const revoked = await client.query<{ id: string }>(
    `select id from extension_sessions
      where (refresh_token_hash = $1 or previous_refresh_token_hash = $1)
        and revoked_at is not null`,
    [input.presentedRefreshTokenHash],
  );
  return revoked.rows.length > 0 ? { kind: "revoked" } : { kind: "invalid" };
}

export async function listExtensionSessions(
  client: SqlClient,
  userId: string,
): Promise<ExtensionSession[]> {
  const { rows } = await client.query<ExtensionSessionRow>(
    `select ${EXTENSION_SESSION_COLUMNS} from extension_sessions s
      where s.user_id = $1
      order by s.revoked_at is not null, s.last_used_at desc`,
    [userId],
  );
  return rows.map(toExtensionSession);
}

/** Ownership is part of the predicate: another user's session id matches nothing. */
export async function revokeExtensionSession(
  client: SqlClient,
  userId: string,
  sessionId: string,
  now: Date,
): Promise<boolean> {
  const { rows } = await client.query<{ id: string }>(
    `update extension_sessions set revoked_at = $3, revoked_reason = 'user'
      where id = $1 and user_id = $2 and revoked_at is null
      returning id`,
    [sessionId, userId, now],
  );
  return rows.length > 0;
}

export async function revokeAllExtensionSessions(
  client: SqlClient,
  userId: string,
  reason: ExtensionSessionRevocationReason,
  now: Date,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `update extension_sessions set revoked_at = $2, revoked_reason = $3
      where user_id = $1 and revoked_at is null
      returning id`,
    [userId, now, reason],
  );
  return rows.length;
}
