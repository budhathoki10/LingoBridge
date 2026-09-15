/**
 * What the popup shows about the dashboard connection. It holds no credential: account name, sync
 * timing, and a user-facing problem only. The background worker is the sole writer.
 */

export const ACCOUNT_STATUS_STORAGE_KEY = "lingobridgeAccountStatus";
export const SYNC_STATE_STORAGE_KEY = "lingobridgeSyncState";

export type AccountConnection = "disconnected" | "connecting" | "connected" | "revoked";

export interface AccountStatus {
  account: { displayName: string | null; email: string | null } | null;
  connection: AccountConnection;
  lastError: string | null;
  lastSyncedAt: string | null;
  nextAttemptAt: string | null;
  pendingChanges: number;
  phraseSyncEnabled: boolean;
  syncing: boolean;
}

export const DISCONNECTED_STATUS: AccountStatus = {
  account: null,
  connection: "disconnected",
  lastError: null,
  lastSyncedAt: null,
  nextAttemptAt: null,
  pendingChanges: 0,
  phraseSyncEnabled: true,
  syncing: false,
};

const CONNECTIONS: readonly AccountConnection[] = [
  "disconnected",
  "connecting",
  "connected",
  "revoked",
];

function nullableString(value: unknown, maximum = 320): string | null {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

export function normalizeAccountStatus(value: unknown): AccountStatus {
  if (!value || typeof value !== "object") return DISCONNECTED_STATUS;
  const candidate = value as Partial<AccountStatus>;
  const connection = CONNECTIONS.includes(candidate.connection as AccountConnection)
    ? (candidate.connection as AccountConnection)
    : "disconnected";
  return {
    account:
      candidate.account && typeof candidate.account === "object"
        ? {
            displayName: nullableString(candidate.account.displayName, 120),
            email: nullableString(candidate.account.email),
          }
        : null,
    connection,
    lastError: nullableString(candidate.lastError, 240),
    lastSyncedAt: nullableString(candidate.lastSyncedAt, 40),
    nextAttemptAt: nullableString(candidate.nextAttemptAt, 40),
    pendingChanges: Number.isSafeInteger(candidate.pendingChanges)
      ? Math.max(0, candidate.pendingChanges as number)
      : 0,
    phraseSyncEnabled: candidate.phraseSyncEnabled !== false,
    syncing: candidate.syncing === true,
  };
}

/* ---------- Popup → background messages ---------- */

export const ACCOUNT_MESSAGE_TYPES = [
  "lingobridge:account:connect",
  "lingobridge:account:disconnect",
  "lingobridge:account:sync-now",
  "lingobridge:account:keep-local",
  "lingobridge:account:delete-local",
] as const;

export type AccountMessageType = (typeof ACCOUNT_MESSAGE_TYPES)[number];

export function parseAccountMessage(value: unknown): AccountMessageType | null {
  if (!value || typeof value !== "object") return null;
  const type = (value as { type?: unknown }).type;
  return ACCOUNT_MESSAGE_TYPES.includes(type as AccountMessageType)
    ? (type as AccountMessageType)
    : null;
}

export interface AccountMessageResult {
  message: string | null;
  ok: boolean;
}
