import { type CapabilityCatalogue, capabilityCatalogueSchema } from "@lingobridge/contracts";

const STORAGE_KEY = "lingobridgeCapabilityCatalogue";

export interface CapabilityCacheStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function extensionStorage(): CapabilityCacheStorage {
  const runtime = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: CapabilityCacheStorage } };
  };
  const storage = runtime.chrome?.storage?.local;
  if (!storage) throw new Error("Extension storage is unavailable.");
  return storage;
}

export function markCapabilityCatalogueStale(catalogue: CapabilityCatalogue): CapabilityCatalogue {
  return capabilityCatalogueSchema.parse({ ...catalogue, freshness: "stale" });
}

export function createCapabilityCache(storage: CapabilityCacheStorage) {
  return {
    async load(): Promise<CapabilityCatalogue | null> {
      const stored = await storage.get(STORAGE_KEY);
      const parsed = capabilityCatalogueSchema.safeParse(stored[STORAGE_KEY]);
      return parsed.success ? parsed.data : null;
    },
    async save(catalogue: CapabilityCatalogue): Promise<void> {
      const validated = capabilityCatalogueSchema.parse(catalogue);
      await storage.set({ [STORAGE_KEY]: validated });
    },
  };
}

export function loadCachedCapabilityCatalogue(): Promise<CapabilityCatalogue | null> {
  return createCapabilityCache(extensionStorage()).load();
}

export function saveCachedCapabilityCatalogue(catalogue: CapabilityCatalogue): Promise<void> {
  return createCapabilityCache(extensionStorage()).save(catalogue);
}
