import { randomUUID } from "node:crypto";
import {
  collection,
  type DbClient,
  type ExtensionSessionDocument,
  inSession,
  toIsoString,
  toNullableIsoString,
  type WebSessionDocument,
} from "./client.js";
import { findUserById } from "./users.js";

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
  client: DbClient,
  input: LoginAttempt & { browserBindingHash: string; expiresAt: Date; stateHash: string },
  now: Date,
): Promise<void> {
  await collection(client, "loginAttempts").insertOne(
    {
      _id: randomUUID(),
      browserBindingHash: input.browserBindingHash,
      codeVerifier: input.codeVerifier,
      consumedAt: null,
      createdAt: now,
      expiresAt: input.expiresAt,
      nonce: input.nonce,
      purpose: input.purpose,
      returnTo: input.returnTo,
      stateHash: input.stateHash,
      userId: input.userId,
    },
    inSession(client),
  );
}

/** Single use: the document is consumed atomically, so a replayed callback finds nothing. */
export async function consumeLoginAttempt(
  client: DbClient,
  stateHash: string,
  browserBindingHash: string,
  now: Date,
): Promise<LoginAttempt | null> {
  const attempt = await collection(client, "loginAttempts").findOneAndUpdate(
    { browserBindingHash, consumedAt: null, expiresAt: { $gt: now }, stateHash },
    { $set: { consumedAt: now } },
    { ...inSession(client), returnDocument: "after" },
  );
  if (!attempt) return null;
  return {
    codeVerifier: attempt.codeVerifier,
    nonce: attempt.nonce,
    purpose: attempt.purpose,
    returnTo: attempt.returnTo,
    userId: attempt.userId,
  };
}

export async function purgeExpiredLoginAttempts(client: DbClient, now: Date): Promise<void> {
  await collection(client, "loginAttempts").deleteMany(
    { expiresAt: { $lte: now } },
    inSession(client),
  );
  await collection(client, "extensionAuthorizationCodes").deleteMany(
    { expiresAt: { $lte: now } },
    inSession(client),
  );
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

function toWebSession(document: WebSessionDocument): WebSession {
  return {
    absoluteExpiresAt: toIsoString(document.absoluteExpiresAt),
    authenticatedAt: toIsoString(document.authenticatedAt),
    id: document._id,
    idleExpiresAt: toIsoString(document.idleExpiresAt),
    userId: document.userId,
  };
}

export async function createWebSession(
  client: DbClient,
  input: {
    absoluteExpiresAt: Date;
    authenticatedAt: Date;
    idleExpiresAt: Date;
    tokenHash: string;
    userId: string;
  },
  now: Date,
): Promise<WebSession> {
  const document: WebSessionDocument = {
    _id: randomUUID(),
    absoluteExpiresAt: input.absoluteExpiresAt,
    authenticatedAt: input.authenticatedAt,
    createdAt: now,
    idleExpiresAt: input.idleExpiresAt,
    lastSeenAt: now,
    revokedAt: null,
    tokenHash: input.tokenHash,
    userId: input.userId,
  };
  await collection(client, "webSessions").insertOne(document, inSession(client));
  return toWebSession(document);
}

/**
 * Finds a live session and slides its idle expiry forward in the same update. The idle window
 * never extends past the absolute expiry, and a deleted account's sessions never match.
 */
export async function touchWebSession(
  client: DbClient,
  tokenHash: string,
  idleMilliseconds: number,
  now: Date,
): Promise<WebSession | null> {
  const session = await collection(client, "webSessions").findOneAndUpdate(
    {
      absoluteExpiresAt: { $gt: now },
      idleExpiresAt: { $gt: now },
      revokedAt: null,
      tokenHash,
    },
    [
      {
        $set: {
          idleExpiresAt: {
            $min: ["$absoluteExpiresAt", new Date(now.getTime() + idleMilliseconds)],
          },
          lastSeenAt: now,
        },
      },
    ],
    { ...inSession(client), returnDocument: "after" },
  );
  if (!session) return null;
  if (!(await findUserById(client, session.userId))) return null;
  return toWebSession(session);
}

export async function markWebSessionReauthenticated(
  client: DbClient,
  sessionId: string,
  userId: string,
  now: Date,
): Promise<void> {
  await collection(client, "webSessions").updateOne(
    { _id: sessionId, revokedAt: null, userId },
    { $set: { authenticatedAt: now } },
    inSession(client),
  );
}

export async function revokeWebSession(
  client: DbClient,
  tokenHash: string,
  now: Date,
): Promise<string | null> {
  const session = await collection(client, "webSessions").findOneAndUpdate(
    { revokedAt: null, tokenHash },
    { $set: { revokedAt: now } },
    inSession(client),
  );
  return session?.userId ?? null;
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
  client: DbClient,
  input: ExtensionAuthorizationCode & { codeHash: string; expiresAt: Date },
  now: Date,
): Promise<void> {
  await collection(client, "extensionAuthorizationCodes").insertOne(
    {
      _id: input.codeHash,
      codeChallenge: input.codeChallenge,
      consumedAt: null,
      createdAt: now,
      deviceLabel: input.deviceLabel,
      expiresAt: input.expiresAt,
      extensionId: input.extensionId,
      redirectUri: input.redirectUri,
      userId: input.userId,
    },
    inSession(client),
  );
}

export async function consumeExtensionAuthorizationCode(
  client: DbClient,
  codeHash: string,
  now: Date,
): Promise<ExtensionAuthorizationCode | null> {
  const code = await collection(client, "extensionAuthorizationCodes").findOneAndUpdate(
    { _id: codeHash, consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { ...inSession(client), returnDocument: "after" },
  );
  if (!code) return null;
  if (!(await findUserById(client, code.userId))) return null;
  return {
    codeChallenge: code.codeChallenge,
    deviceLabel: code.deviceLabel,
    extensionId: code.extensionId,
    redirectUri: code.redirectUri,
    userId: code.userId,
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

function toExtensionSession(document: ExtensionSessionDocument): ExtensionSession {
  return {
    accessExpiresAt: toIsoString(document.accessExpiresAt),
    createdAt: toIsoString(document.createdAt),
    deviceLabel: document.deviceLabel,
    expiresAt: toIsoString(document.expiresAt),
    extensionId: document.extensionId,
    id: document._id,
    lastUsedAt: toIsoString(document.lastUsedAt),
    revokedAt: toNullableIsoString(document.revokedAt),
    revokedReason: document.revokedReason,
    userId: document.userId,
  };
}

export async function createExtensionSession(
  client: DbClient,
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
  const document: ExtensionSessionDocument = {
    _id: randomUUID(),
    accessExpiresAt: input.accessExpiresAt,
    accessTokenHash: input.accessTokenHash,
    createdAt: now,
    deviceLabel: input.deviceLabel,
    expiresAt: input.expiresAt,
    extensionId: input.extensionId,
    lastUsedAt: now,
    refreshTokenHash: input.refreshTokenHash,
    revokedAt: null,
    revokedReason: null,
    userId: input.userId,
  };
  await collection(client, "extensionSessions").insertOne(document, inSession(client));
  return toExtensionSession(document);
}

export type AccessTokenLookup =
  | { kind: "active"; session: ExtensionSession }
  | { kind: "expired" }
  | { kind: "revoked" }
  | { kind: "unknown" };

export async function authenticateExtensionAccessToken(
  client: DbClient,
  accessTokenHash: string,
  now: Date,
): Promise<AccessTokenLookup> {
  const sessions = collection(client, "extensionSessions");
  const document = await sessions.findOne({ accessTokenHash }, inSession(client));
  if (!document) return { kind: "unknown" };
  if (document.revokedAt !== null || !(await findUserById(client, document.userId))) {
    return { kind: "revoked" };
  }
  const session = toExtensionSession(document);
  if (Date.parse(session.accessExpiresAt) <= now.getTime()) return { kind: "expired" };
  if (Date.parse(session.expiresAt) <= now.getTime()) return { kind: "expired" };

  await sessions.updateOne({ _id: session.id }, { $set: { lastUsedAt: now } }, inSession(client));
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
  client: DbClient,
  input: {
    accessExpiresAt: Date;
    newAccessTokenHash: string;
    newRefreshTokenHash: string;
    presentedRefreshTokenHash: string;
  },
  now: Date,
): Promise<RefreshRotation> {
  const sessions = collection(client, "extensionSessions");
  const rotated = await sessions.findOneAndUpdate(
    { expiresAt: { $gt: now }, refreshTokenHash: input.presentedRefreshTokenHash, revokedAt: null },
    [
      {
        $set: {
          accessExpiresAt: { $min: ["$expiresAt", input.accessExpiresAt] },
          accessTokenHash: input.newAccessTokenHash,
          lastUsedAt: now,
          previousRefreshTokenHash: "$refreshTokenHash",
          refreshTokenHash: input.newRefreshTokenHash,
        },
      },
    ],
    { ...inSession(client), returnDocument: "after" },
  );
  if (rotated) {
    // Account deletion revokes every session in the same transaction, so this is a backstop.
    if (!(await findUserById(client, rotated.userId))) return { kind: "revoked" };
    return { kind: "rotated", session: toExtensionSession(rotated) };
  }

  const reused = await sessions.updateMany(
    { previousRefreshTokenHash: input.presentedRefreshTokenHash, revokedAt: null },
    { $set: { revokedAt: now, revokedReason: "refresh-reuse" } },
    inSession(client),
  );
  if (reused.modifiedCount > 0) return { kind: "reuse-detected" };

  const revoked = await sessions.findOne(
    {
      $or: [
        { refreshTokenHash: input.presentedRefreshTokenHash },
        { previousRefreshTokenHash: input.presentedRefreshTokenHash },
      ],
      revokedAt: { $ne: null },
    },
    inSession(client),
  );
  return revoked ? { kind: "revoked" } : { kind: "invalid" };
}

export async function listExtensionSessions(
  client: DbClient,
  userId: string,
): Promise<ExtensionSession[]> {
  const documents = await collection(client, "extensionSessions")
    .find({ userId }, inSession(client))
    .toArray();
  return documents
    .sort(
      (a, b) =>
        Number(a.revokedAt !== null) - Number(b.revokedAt !== null) ||
        b.lastUsedAt.getTime() - a.lastUsedAt.getTime(),
    )
    .map(toExtensionSession);
}

/** Ownership is part of the filter: another user's session id matches nothing. */
export async function revokeExtensionSession(
  client: DbClient,
  userId: string,
  sessionId: string,
  now: Date,
): Promise<boolean> {
  const result = await collection(client, "extensionSessions").updateOne(
    { _id: sessionId, revokedAt: null, userId },
    { $set: { revokedAt: now, revokedReason: "user" } },
    inSession(client),
  );
  return result.modifiedCount > 0;
}

export async function revokeAllExtensionSessions(
  client: DbClient,
  userId: string,
  reason: ExtensionSessionRevocationReason,
  now: Date,
): Promise<number> {
  const result = await collection(client, "extensionSessions").updateMany(
    { revokedAt: null, userId },
    { $set: { revokedAt: now, revokedReason: reason } },
    inSession(client),
  );
  return result.modifiedCount;
}
