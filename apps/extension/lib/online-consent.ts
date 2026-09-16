import { type OnlineConsent, onlineConsentSchema } from "@lingobridge/contracts";

export const ONLINE_PROVIDER_CONSENT_VERSION = "mymemory-primary-nvidia-backup-v1";
const STORAGE_KEY = "lingobridgeOnlineProviderConsent";

export interface ConsentStorage {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

function extensionStorage(): ConsentStorage {
  const runtime = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: ConsentStorage } };
  };
  const storage = runtime.chrome?.storage?.local;
  if (!storage) throw new Error("Extension storage is unavailable.");
  return storage;
}

export function createOnlineConsentRepository(storage: ConsentStorage) {
  return {
    async accept(): Promise<OnlineConsent> {
      const consent = onlineConsentSchema.parse({
        acceptedAt: new Date().toISOString(),
        google: false,
        googleBackup: false,
        myMemory: true,
        nvidia: true,
        nvidiaBackup: true,
        version: ONLINE_PROVIDER_CONSENT_VERSION,
      });
      await storage.set({ [STORAGE_KEY]: consent });
      return consent;
    },
    async load(): Promise<OnlineConsent | null> {
      const stored = await storage.get(STORAGE_KEY);
      const parsed = onlineConsentSchema.safeParse(stored[STORAGE_KEY]);
      if (!parsed.success || parsed.data.version !== ONLINE_PROVIDER_CONSENT_VERSION) return null;
      return parsed.data;
    },
    async revoke(): Promise<void> {
      await storage.remove(STORAGE_KEY);
    },
  };
}

export function acceptOnlineProviderConsent(): Promise<OnlineConsent> {
  return createOnlineConsentRepository(extensionStorage()).accept();
}

export function loadOnlineProviderConsent(): Promise<OnlineConsent | null> {
  return createOnlineConsentRepository(extensionStorage()).load();
}

export function revokeOnlineProviderConsent(): Promise<void> {
  return createOnlineConsentRepository(extensionStorage()).revoke();
}
