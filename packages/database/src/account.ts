import { randomUUID } from "node:crypto";
import type {
  LivePhraseRecord,
  SavedWordRecord,
  SyncedPreferences,
} from "@lingobridge/contracts/account";
import {
  type CollectionName,
  collection,
  type Database,
  type DbClient,
  type DeletionReceiptDocument,
  inSession,
  toIsoString,
  toNullableIsoString,
} from "./client.js";
import { getPreferences, toLivePhraseRecords } from "./phrases.js";
import { type ExtensionSession, listExtensionSessions } from "./sessions.js";
import { lockAccount } from "./sync.js";
import { findUserById } from "./users.js";
import { listSavedWords } from "./vocabulary.js";

/**
 * Deletion window: synchronized phrases, preferences, sync receipts, and every session are removed
 * or revoked immediately when the user confirms. The account document is kept only in a
 * de-identified state (no email, name, or identity subject) so revoked extensions receive a clear
 * answer, and it is purged once this window closes.
 */
export const ACCOUNT_PURGE_WINDOW_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export interface DeletionReceipt {
  accountPurgeAfter: string;
  accountPurgedAt: string | null;
  contentDeletedAt: string;
  id: string;
  requestedAt: string;
}

function toDeletionReceipt(document: DeletionReceiptDocument): DeletionReceipt {
  return {
    accountPurgeAfter: toIsoString(document.accountPurgeAfter),
    accountPurgedAt: toNullableIsoString(document.accountPurgedAt),
    contentDeletedAt: toIsoString(document.contentDeletedAt),
    id: document._id,
    requestedAt: toIsoString(document.requestedAt),
  };
}

export interface AccountDeletionResult {
  receipt: DeletionReceipt;
  revokedExtensionSessions: number;
}

/** Collections whose documents belong to one user through a `userId` field. */
const USER_CONTENT_COLLECTIONS = [
  "phrases",
  "vocabulary",
  "syncMutations",
  "loginAttempts",
  "extensionAuthorizationCodes",
] as const satisfies readonly CollectionName[];

export async function deleteAccount(
  database: Database,
  userId: string,
  now: Date,
): Promise<AccountDeletionResult> {
  return database.transaction(async (client) => {
    await lockAccount(client, userId);

    for (const name of USER_CONTENT_COLLECTIONS) {
      await client.db.collection(name).deleteMany({ userId }, inSession(client));
    }
    await collection(client, "preferences").deleteOne({ _id: userId }, inSession(client));
    const revoked = await collection(client, "extensionSessions").updateMany(
      { revokedAt: null, userId },
      { $set: { revokedAt: now, revokedReason: "account-deleted" } },
      inSession(client),
    );
    await collection(client, "webSessions").updateMany(
      { revokedAt: null, userId },
      { $set: { revokedAt: now } },
      inSession(client),
    );
    await collection(client, "users").updateOne(
      { _id: userId },
      {
        $set: {
          deletedAt: now,
          displayName: null,
          email: null,
          emailVerified: false,
          identitySubject: `deleted:${userId}`,
          role: "user",
          updatedAt: now,
        },
      },
      inSession(client),
    );

    const receipt: DeletionReceiptDocument = {
      _id: randomUUID(),
      accountPurgeAfter: new Date(now.getTime() + ACCOUNT_PURGE_WINDOW_MILLISECONDS),
      accountPurgedAt: null,
      contentDeletedAt: now,
      requestedAt: now,
      userId,
    };
    await collection(client, "deletionReceipts").insertOne(receipt, inSession(client));
    return { receipt: toDeletionReceipt(receipt), revokedExtensionSessions: revoked.modifiedCount };
  });
}

export async function getDeletionReceipt(
  client: DbClient,
  receiptId: string,
): Promise<DeletionReceipt | null> {
  const receipt = await collection(client, "deletionReceipts").findOne(
    { _id: receiptId },
    inSession(client),
  );
  return receipt ? toDeletionReceipt(receipt) : null;
}

/**
 * Removes de-identified account shells whose window has closed, with every document that still
 * references them. The receipt itself remains.
 */
export async function purgeDeletedAccounts(database: Database, now: Date): Promise<number> {
  return database.transaction(async (client) => {
    const receipts = collection(client, "deletionReceipts");
    const due = await receipts
      .find({ accountPurgeAfter: { $lte: now }, accountPurgedAt: null }, inSession(client))
      .toArray();
    for (const receipt of due) {
      await receipts.updateOne(
        { _id: receipt._id },
        { $set: { accountPurgedAt: now } },
        inSession(client),
      );
      const user = await collection(client, "users").deleteOne(
        { _id: receipt.userId, deletedAt: { $ne: null } },
        inSession(client),
      );
      if (user.deletedCount === 0) continue;
      for (const name of [...USER_CONTENT_COLLECTIONS, "extensionSessions", "webSessions"]) {
        await client.db.collection(name).deleteMany({ userId: receipt.userId }, inSession(client));
      }
      await collection(client, "preferences").deleteOne({ _id: receipt.userId }, inSession(client));
    }
    return due.length;
  });
}

export interface AccountExport {
  account: {
    createdAt: string;
    displayName: string | null;
    email: string | null;
    role: "user" | "admin";
  };
  exportedAt: string;
  extensionSessions: {
    connectedAt: string;
    deviceLabel: string;
    lastUsedAt: string;
    revokedAt: string | null;
  }[];
  phrases: LivePhraseRecord[];
  preferences: SyncedPreferences;
  version: 1;
  vocabulary: SavedWordRecord[];
}

export async function listAllLivePhrases(
  client: DbClient,
  userId: string,
): Promise<LivePhraseRecord[]> {
  const documents = await collection(client, "phrases")
    .find({ deletedAt: null, userId }, inSession(client))
    .sort([
      ["savedAt", -1],
      ["id", 1],
    ])
    .toArray();
  return toLivePhraseRecords(documents);
}

/** Session metadata is exported; token hashes and extension ids are not. */
export async function exportAccount(
  client: DbClient,
  userId: string,
  now: Date,
): Promise<AccountExport | null> {
  const user = await findUserById(client, userId);
  if (!user) return null;
  // Sequential: operations sharing a transaction session must not run concurrently.
  const phrases = await listAllLivePhrases(client, userId);
  const preferences = await getPreferences(client, userId);
  const sessions = await listExtensionSessions(client, userId);
  const vocabulary = await listSavedWords(client, userId);
  return {
    account: {
      createdAt: user.createdAt,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
    },
    exportedAt: now.toISOString(),
    extensionSessions: sessions.map((session: ExtensionSession) => ({
      connectedAt: session.createdAt,
      deviceLabel: session.deviceLabel,
      lastUsedAt: session.lastUsedAt,
      revokedAt: session.revokedAt,
    })),
    phrases,
    preferences,
    version: 1,
    vocabulary,
  };
}

export interface AccountOverview {
  activeExtensionSessions: number;
  lastExtensionActivityAt: string | null;
  phraseCount: number;
  preferences: SyncedPreferences;
  recentPhrases: LivePhraseRecord[];
}

export async function getAccountOverview(
  client: DbClient,
  userId: string,
  now: Date,
): Promise<AccountOverview> {
  const phrases = collection(client, "phrases");
  const sessions = collection(client, "extensionSessions");
  const phraseCount = await phrases.countDocuments({ deletedAt: null, userId }, inSession(client));
  const activeExtensionSessions = await sessions.countDocuments(
    { expiresAt: { $gt: now }, revokedAt: null, userId },
    inSession(client),
  );
  const lastActive = await sessions.findOne(
    { revokedAt: null, userId },
    { ...inSession(client), projection: { lastUsedAt: 1 }, sort: { lastUsedAt: -1 } },
  );
  const recent = await phrases
    .find({ deletedAt: null, userId }, inSession(client))
    .sort([
      ["savedAt", -1],
      ["id", 1],
    ])
    .limit(5)
    .toArray();
  return {
    activeExtensionSessions,
    lastExtensionActivityAt: toNullableIsoString(lastActive?.lastUsedAt ?? null),
    phraseCount,
    preferences: await getPreferences(client, userId),
    recentPhrases: toLivePhraseRecords(recent),
  };
}
