import {
  type ExtensionTokenResponse,
  extensionTokenResponseSchema,
} from "@lingobridge/contracts/account";

/**
 * Account tokens live in IndexedDB on the extension's own origin. Content scripts run on the
 * webpage's origin and cannot open this database, whereas chrome.storage.local is readable by
 * content scripts. Only the background worker imports this module; tokens are never placed in
 * extension messages, chrome.storage, URLs after the exchange, logs, or page DOM.
 */

export interface StoredCredentials extends ExtensionTokenResponse {
  storedAt: string;
}

export interface CredentialStore {
  clear(): Promise<void>;
  load(): Promise<StoredCredentials | null>;
  save(credentials: ExtensionTokenResponse): Promise<StoredCredentials>;
}

const DATABASE_NAME = "lingobridge-account";
const STORE_NAME = "credentials";
const RECORD_KEY = "current";

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE_NAME, 1);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(STORE_NAME)) {
        opening.result.createObjectStore(STORE_NAME);
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await request(work(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME)));
  } finally {
    database.close();
  }
}

export function parseStoredCredentials(value: unknown): StoredCredentials | null {
  if (!value || typeof value !== "object") return null;
  const { storedAt, ...rest } = value as Record<string, unknown>;
  const parsed = extensionTokenResponseSchema.safeParse(rest);
  if (!parsed.success || typeof storedAt !== "string") return null;
  return { ...parsed.data, storedAt };
}

export const indexedDbCredentialStore: CredentialStore = {
  async clear() {
    await withStore("readwrite", (store) => store.delete(RECORD_KEY));
  },
  async load() {
    return parseStoredCredentials(await withStore("readonly", (store) => store.get(RECORD_KEY)));
  },
  async save(credentials) {
    const record: StoredCredentials = { ...credentials, storedAt: new Date().toISOString() };
    await withStore("readwrite", (store) => store.put(record, RECORD_KEY));
    return record;
  },
};

export function createMemoryCredentialStore(
  initial: StoredCredentials | null = null,
): CredentialStore {
  let current = initial;
  return {
    async clear() {
      current = null;
    },
    async load() {
      return current;
    },
    async save(credentials) {
      current = { ...credentials, storedAt: new Date().toISOString() };
      return current;
    },
  };
}
