import { anonymousInstallationIdSchema } from "@lingobridge/contracts";

const STORAGE_KEY = "lingobridgeAnonymousInstallationId";
let pendingInstallationId: Promise<string> | undefined;

interface ExtensionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function getExtensionStorage(): ExtensionStorage {
  const runtime = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: ExtensionStorage } };
  };
  const storage = runtime.chrome?.storage?.local;
  if (!storage) throw new Error("Extension storage is unavailable.");
  return storage;
}

async function loadOrCreateInstallationId(): Promise<string> {
  const storage = getExtensionStorage();
  const stored = await storage.get(STORAGE_KEY);
  const parsed = anonymousInstallationIdSchema.safeParse(stored[STORAGE_KEY]);
  if (parsed.success) return parsed.data;

  const installationId = crypto.randomUUID();
  await storage.set({ [STORAGE_KEY]: installationId });
  return installationId;
}

export function getAnonymousInstallationId(): Promise<string> {
  pendingInstallationId ??= loadOrCreateInstallationId().catch((error) => {
    pendingInstallationId = undefined;
    throw error;
  });
  return pendingInstallationId;
}
