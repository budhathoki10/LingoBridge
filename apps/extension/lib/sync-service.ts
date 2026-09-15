import { type AccountClient, AccountClientError } from "./account-client";
import {
  ACCOUNT_STATUS_STORAGE_KEY,
  type AccountStatus,
  DISCONNECTED_STATUS,
  normalizeAccountStatus,
  SYNC_STATE_STORAGE_KEY,
} from "./account-status";
import {
  applySyncResponse,
  buildSyncRequest,
  INITIAL_SYNC_STATE,
  normalizeSyncState,
  queueLocalChanges,
  scheduleRetry,
  type SyncState,
} from "./phrase-sync";
import { normalizePopupPreferences, type PopupPreferences } from "./popup-preferences";
import {
  normalizeSavedPhrases,
  SAVED_PHRASES_STORAGE_KEY,
  type SavedPhrase,
} from "./saved-phrases";

export const POPUP_PREFERENCES_STORAGE_KEY = "phase2PopupPreferences";
const MAX_ROUNDS = 10;

export interface SyncStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface SyncServiceDependencies {
  client: AccountClient;
  hasCredentials: () => Promise<boolean>;
  newId: () => string;
  now: () => Date;
  /** Schedules the next attempt; the worker maps this to chrome.alarms. */
  scheduleAt: (when: Date | null) => Promise<void>;
  storage: SyncStorage;
}

export type SyncOutcome = "synced" | "not-connected" | "retry-scheduled" | "revoked" | "failed";

/**
 * Runs synchronization rounds one at a time. Each round reads local phrases, queues what changed,
 * sends at most one batch, and writes the result back before the next round starts.
 */
export function createSyncService(dependencies: SyncServiceDependencies) {
  let running: Promise<SyncOutcome> | null = null;
  let rerun = false;

  async function read(): Promise<{
    phrases: SavedPhrase[];
    preferences: PopupPreferences;
    state: SyncState;
    status: AccountStatus;
    storedPreferences: unknown;
  }> {
    const stored = await dependencies.storage.get([
      SAVED_PHRASES_STORAGE_KEY,
      SYNC_STATE_STORAGE_KEY,
      ACCOUNT_STATUS_STORAGE_KEY,
      POPUP_PREFERENCES_STORAGE_KEY,
    ]);
    return {
      phrases: normalizeSavedPhrases(stored[SAVED_PHRASES_STORAGE_KEY]),
      preferences: normalizePopupPreferences(stored[POPUP_PREFERENCES_STORAGE_KEY]),
      state: normalizeSyncState(stored[SYNC_STATE_STORAGE_KEY]),
      status: normalizeAccountStatus(stored[ACCOUNT_STATUS_STORAGE_KEY]),
      storedPreferences: stored[POPUP_PREFERENCES_STORAGE_KEY],
    };
  }

  async function writeStatus(
    status: AccountStatus,
    patch: Partial<AccountStatus>,
  ): Promise<AccountStatus> {
    const next = { ...status, ...patch };
    await dependencies.storage.set({ [ACCOUNT_STATUS_STORAGE_KEY]: next });
    return next;
  }

  async function markRevoked(status: AccountStatus): Promise<void> {
    await dependencies.scheduleAt(null);
    await writeStatus(status, {
      connection: "revoked",
      lastError:
        "This extension was disconnected from the dashboard. Phrases on this device are unchanged.",
      nextAttemptAt: null,
      pendingChanges: 0,
      syncing: false,
    });
  }

  async function runOnce(): Promise<SyncOutcome> {
    let { status } = await read();
    if (status.connection !== "connected" || !(await dependencies.hasCredentials()))
      return "not-connected";
    status = await writeStatus(status, { syncing: true });

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const snapshot = await read();
      const queued = queueLocalChanges(
        snapshot.state,
        snapshot.phrases,
        snapshot.preferences.targetLanguage,
        dependencies.newId,
      );
      const request = buildSyncRequest(queued);

      let response: Awaited<ReturnType<AccountClient["sync"]>>;
      try {
        response = await dependencies.client.sync(request);
      } catch (error) {
        if (error instanceof AccountClientError && error.kind === "revoked") {
          await dependencies.storage.set({ [SYNC_STATE_STORAGE_KEY]: queued });
          await markRevoked(snapshot.status);
          return "revoked";
        }
        const now = dependencies.now();
        const retryable = !(error instanceof AccountClientError) || error.retryable;
        const message =
          error instanceof AccountClientError
            ? error.message
            : "Sync failed unexpectedly. It will retry.";
        const next = retryable
          ? scheduleRetry(queued, now, message)
          : { ...queued, lastError: message };
        await dependencies.storage.set({ [SYNC_STATE_STORAGE_KEY]: next });
        await dependencies.scheduleAt(next.nextAttemptAt ? new Date(next.nextAttemptAt) : null);
        await writeStatus(snapshot.status, {
          lastError: message,
          nextAttemptAt: next.nextAttemptAt,
          pendingChanges: next.outbox.length,
          syncing: false,
        });
        return retryable ? "retry-scheduled" : "failed";
      }

      // Re-read before writing: the user may have saved or deleted a phrase during the request.
      const latest = await read();
      const merged = queueLocalChanges(
        queued,
        latest.phrases,
        latest.preferences.targetLanguage,
        dependencies.newId,
      );
      const applied = applySyncResponse(
        merged,
        latest.phrases,
        request,
        response,
        dependencies.now(),
        dependencies.newId,
      );
      const storedPhrases = normalizeSavedPhrases(applied.phrases);

      // The local store is bounded. Phrases that did not fit remain on the server; forgetting them
      // here keeps the next diff from mistaking "not stored locally" for "deleted by the user".
      const kept = new Set(storedPhrases.map((phrase) => phrase.id));
      const known = Object.fromEntries(
        Object.entries(applied.state.known).filter(([id]) => kept.has(id)),
      );
      const state = { ...applied.state, known };

      const writes: Record<string, unknown> = {
        [SAVED_PHRASES_STORAGE_KEY]: storedPhrases,
        [SYNC_STATE_STORAGE_KEY]: state,
      };
      if (applied.preferredTargetLanguage) {
        writes[POPUP_PREFERENCES_STORAGE_KEY] = normalizePopupPreferences({
          ...latest.preferences,
          targetLanguage: applied.preferredTargetLanguage,
        });
      }
      await dependencies.storage.set(writes);

      const targetAfter = applied.preferredTargetLanguage || latest.preferences.targetLanguage;
      const more =
        response.hasMore ||
        queueLocalChanges(state, storedPhrases, targetAfter, () => "pending").outbox.length > 0;
      if (!more) {
        await dependencies.scheduleAt(null);
        await writeStatus(latest.status, {
          lastError: state.lastError,
          lastSyncedAt: state.lastSyncedAt,
          nextAttemptAt: null,
          pendingChanges: 0,
          phraseSyncEnabled: state.phraseSyncEnabled,
          syncing: false,
        });
        return "synced";
      }
      if (!response.hasMore && response.results.length === 0) break;
    }

    const { state, status: latestStatus } = await read();
    await writeStatus(latestStatus, { pendingChanges: state.outbox.length, syncing: false });
    return "synced";
  }

  return {
    /** Coalesces overlapping triggers into one follow-up run. */
    run(): Promise<SyncOutcome> {
      if (running) {
        rerun = true;
        return running;
      }
      running = (async () => {
        let outcome: SyncOutcome;
        do {
          rerun = false;
          outcome = await runOnce();
        } while (rerun && outcome === "synced");
        return outcome;
      })().finally(() => {
        running = null;
      });
      return running;
    },

    /** True when local phrases or the preferred language differ from what was last synced. */
    async hasLocalChanges(): Promise<boolean> {
      const snapshot = await read();
      if (snapshot.status.connection !== "connected") return false;
      const queued = queueLocalChanges(
        snapshot.state,
        snapshot.phrases,
        snapshot.preferences.targetLanguage,
        () => "pending",
      );
      return queued.outbox.length > 0;
    },

    async markConnected(account: AccountStatus["account"]): Promise<void> {
      const { status } = await read();
      await dependencies.storage.set({ [SYNC_STATE_STORAGE_KEY]: INITIAL_SYNC_STATE });
      await writeStatus(status, { ...DISCONNECTED_STATUS, account, connection: "connected" });
    },

    async markDisconnected(): Promise<void> {
      await dependencies.scheduleAt(null);
      await dependencies.storage.set({
        [ACCOUNT_STATUS_STORAGE_KEY]: DISCONNECTED_STATUS,
        [SYNC_STATE_STORAGE_KEY]: INITIAL_SYNC_STATE,
      });
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
