import { describe, expect, it } from "vitest";
import {
  type ConsentStorage,
  createOnlineConsentRepository,
  ONLINE_PROVIDER_CONSENT_VERSION,
} from "../../apps/extension/lib/online-consent";

class MemoryConsentStorage implements ConsentStorage {
  readonly values: Record<string, unknown> = {};

  async get(): Promise<Record<string, unknown>> {
    return { ...this.values };
  }

  async remove(key: string): Promise<void> {
    delete this.values[key];
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }
}

describe("online provider consent", () => {
  it("requires an explicit current-version acceptance and can be revoked", async () => {
    const storage = new MemoryConsentStorage();
    const repository = createOnlineConsentRepository(storage);

    expect(await repository.load()).toBeNull();
    const consent = await repository.accept();
    expect(consent).toMatchObject({
      google: true,
      googleBackup: true,
      nvidia: true,
      version: ONLINE_PROVIDER_CONSENT_VERSION,
    });
    expect(await repository.load()).toEqual(consent);

    await repository.revoke();
    expect(await repository.load()).toBeNull();
  });

  it("does not accept consent from an obsolete disclosure version", async () => {
    const storage = new MemoryConsentStorage();
    await storage.set({
      lingobridgeOnlineProviderConsent: {
        acceptedAt: "2026-09-07T00:00:00.000Z",
        google: true,
        googleBackup: true,
        nvidia: true,
        version: "obsolete",
      },
    });

    expect(await createOnlineConsentRepository(storage).load()).toBeNull();
  });
});
