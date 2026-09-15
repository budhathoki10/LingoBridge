import { randomUUID } from "node:crypto";
import type { LivePhraseRecord, SyncedPreferences } from "@lingobridge/contracts/account";
import {
  type Database,
  type SqlClient,
  toInteger,
  toIsoString,
  toNullableIsoString,
} from "./client.js";
import { getPreferences, PHRASE_COLUMNS, type PhraseRow, toPhraseRecord } from "./phrases.js";
import { type ExtensionSession, listExtensionSessions } from "./sessions.js";
import { lockAccount } from "./sync.js";
import { findUserById } from "./users.js";

/**
 * Deletion window: synchronized phrases, preferences, sync receipts, and every session are removed
 * or revoked immediately when the user confirms. The account row is kept only in a de-identified
 * state (no email, name, or identity subject) so revoked extensions receive a clear answer, and
 * it is purged once this window closes.
 */
export const ACCOUNT_PURGE_WINDOW_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export interface DeletionReceipt {
  accountPurgeAfter: string;
  accountPurgedAt: string | null;
  contentDeletedAt: string;
  id: string;
  requestedAt: string;
}

interface DeletionReceiptRow {
  account_purge_after: unknown;
  account_purged_at: unknown;
  content_deleted_at: unknown;
  id: string;
  requested_at: unknown;
}

function toDeletionReceipt(row: DeletionReceiptRow): DeletionReceipt {
  return {
    accountPurgeAfter: toIsoString(row.account_purge_after),
    accountPurgedAt: toNullableIsoString(row.account_purged_at),
    contentDeletedAt: toIsoString(row.content_deleted_at),
    id: row.id,
    requestedAt: toIsoString(row.requested_at),
  };
}

export interface AccountDeletionResult {
  receipt: DeletionReceipt;
  revokedExtensionSessions: number;
}

export async function deleteAccount(
  database: Database,
  userId: string,
  now: Date,
): Promise<AccountDeletionResult> {
  return database.transaction(async (client) => {
    await lockAccount(client, userId);

    for (const table of [
      "phrases",
      "preferences",
      "sync_mutations",
      "login_attempts",
      "extension_authorization_codes",
    ]) {
      await client.query(`delete from ${table} where user_id = $1`, [userId]);
    }
    const revoked = await client.query<{ id: string }>(
      `update extension_sessions
          set revoked_at = $2, revoked_reason = 'account-deleted'
        where user_id = $1 and revoked_at is null
        returning id`,
      [userId, now],
    );
    await client.query(
      "update web_sessions set revoked_at = $2 where user_id = $1 and revoked_at is null",
      [userId, now],
    );
    await client.query(
      `update users
          set deleted_at = $2, email = null, email_verified = false, display_name = null,
              identity_subject = 'deleted:' || id::text, role = 'user', updated_at = $2
        where id = $1`,
      [userId, now],
    );

    const { rows } = await client.query<DeletionReceiptRow>(
      `insert into deletion_receipts (id, user_id, requested_at, content_deleted_at,
                                      account_purge_after)
       values ($1, $2, $3, $3, $4)
       returning id, requested_at, content_deleted_at, account_purge_after, account_purged_at`,
      [randomUUID(), userId, now, new Date(now.getTime() + ACCOUNT_PURGE_WINDOW_MILLISECONDS)],
    );
    if (!rows[0]) throw new Error("Deletion receipt insert returned no row.");
    return { receipt: toDeletionReceipt(rows[0]), revokedExtensionSessions: revoked.rows.length };
  });
}

export async function getDeletionReceipt(
  client: SqlClient,
  receiptId: string,
): Promise<DeletionReceipt | null> {
  const { rows } = await client.query<DeletionReceiptRow>(
    `select id, requested_at, content_deleted_at, account_purge_after, account_purged_at
       from deletion_receipts where id = $1`,
    [receiptId],
  );
  return rows[0] ? toDeletionReceipt(rows[0]) : null;
}

/** Removes de-identified account shells whose window has closed. The receipt itself remains. */
export async function purgeDeletedAccounts(database: Database, now: Date): Promise<number> {
  return database.transaction(async (client) => {
    const { rows } = await client.query<{ user_id: string }>(
      `update deletion_receipts set account_purged_at = $1
        where account_purge_after <= $1 and account_purged_at is null
        returning user_id`,
      [now],
    );
    for (const row of rows) {
      await client.query("delete from users where id = $1 and deleted_at is not null", [
        row.user_id,
      ]);
    }
    return rows.length;
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
}

export async function listAllLivePhrases(
  client: SqlClient,
  userId: string,
): Promise<LivePhraseRecord[]> {
  const { rows } = await client.query<PhraseRow>(
    `select ${PHRASE_COLUMNS} from phrases
      where user_id = $1 and deleted_at is null
      order by saved_at desc, id`,
    [userId],
  );
  return rows
    .map(toPhraseRecord)
    .filter((record): record is LivePhraseRecord => record.state === "live");
}

/** Session metadata is exported; token hashes and extension ids are not. */
export async function exportAccount(
  client: SqlClient,
  userId: string,
  now: Date,
): Promise<AccountExport | null> {
  const user = await findUserById(client, userId);
  if (!user) return null;
  const [phrases, preferences, sessions] = await Promise.all([
    listAllLivePhrases(client, userId),
    getPreferences(client, userId),
    listExtensionSessions(client, userId),
  ]);
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
  client: SqlClient,
  userId: string,
  now: Date,
): Promise<AccountOverview> {
  const [counts, recent, preferences] = await Promise.all([
    client.query<{ active_sessions: unknown; last_activity: unknown; phrases: unknown }>(
      `select
         (select count(*) from phrases where user_id = $1 and deleted_at is null) as phrases,
         (select count(*) from extension_sessions
           where user_id = $1 and revoked_at is null and expires_at > $2) as active_sessions,
         (select max(last_used_at) from extension_sessions
           where user_id = $1 and revoked_at is null) as last_activity`,
      [userId, now],
    ),
    client.query<PhraseRow>(
      `select ${PHRASE_COLUMNS} from phrases
        where user_id = $1 and deleted_at is null
        order by saved_at desc, id limit 5`,
      [userId],
    ),
    getPreferences(client, userId),
  ]);
  const row = counts.rows[0];
  return {
    activeExtensionSessions: toInteger(row?.active_sessions ?? 0),
    lastExtensionActivityAt: toNullableIsoString(row?.last_activity ?? null),
    phraseCount: toInteger(row?.phrases ?? 0),
    preferences,
    recentPhrases: recent.rows
      .map(toPhraseRecord)
      .filter((record): record is LivePhraseRecord => record.state === "live"),
  };
}
