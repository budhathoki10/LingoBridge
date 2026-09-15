import { randomUUID } from "node:crypto";
import {
  collection,
  type DbClient,
  inSession,
  toIsoString,
  toNullableIsoString,
  type UserDocument,
} from "./client.js";
import { DEFAULT_PREFERENCES } from "./phrases.js";

export type UserRole = "user" | "admin";

export interface User {
  createdAt: string;
  deletedAt: string | null;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  id: string;
  identityIssuer: string;
  role: UserRole;
}

export interface VerifiedIdentity {
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  issuer: string;
  subject: string;
}

function toUser(document: UserDocument): User {
  return {
    createdAt: toIsoString(document.createdAt),
    deletedAt: toNullableIsoString(document.deletedAt),
    displayName: document.displayName,
    email: document.email,
    emailVerified: document.emailVerified,
    id: document._id,
    identityIssuer: document.identityIssuer,
    role: document.role,
  };
}

/**
 * The identity provider is the only source of who a user is. The role is decided by the server at
 * every sign-in, so removing someone from the admin allowlist demotes them on their next visit.
 */
export async function upsertUserFromIdentity(
  client: DbClient,
  identity: VerifiedIdentity,
  role: UserRole,
  now: Date,
): Promise<User> {
  const user = await collection(client, "users").findOneAndUpdate(
    { identityIssuer: identity.issuer, identitySubject: identity.subject },
    {
      $set: {
        displayName: identity.displayName,
        email: identity.email,
        emailVerified: identity.emailVerified,
        role,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: randomUUID(),
        changeSeq: 0,
        createdAt: now,
        deletedAt: null,
        lockVersion: 0,
        tombstonePurgeSeq: 0,
      },
    },
    { ...inSession(client), returnDocument: "after", upsert: true },
  );
  if (!user) throw new Error("User upsert returned no document.");
  await collection(client, "preferences").updateOne(
    { _id: user._id },
    {
      $setOnInsert: {
        changeSeq: 0,
        phraseSyncEnabled: DEFAULT_PREFERENCES.phraseSyncEnabled,
        preferredTargetLanguage: null,
        processingPreference: null,
        revision: 0,
        updatedAt: null,
      },
    },
    { ...inSession(client), upsert: true },
  );
  return toUser(user);
}

export async function findUserByIdentity(
  client: DbClient,
  issuer: string,
  subject: string,
): Promise<User | null> {
  const user = await collection(client, "users").findOne(
    { deletedAt: null, identityIssuer: issuer, identitySubject: subject },
    inSession(client),
  );
  return user ? toUser(user) : null;
}

export async function findUserById(client: DbClient, userId: string): Promise<User | null> {
  const user = await collection(client, "users").findOne(
    { _id: userId, deletedAt: null },
    inSession(client),
  );
  return user ? toUser(user) : null;
}
