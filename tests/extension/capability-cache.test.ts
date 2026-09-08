import { describe, expect, it } from "vitest";
import {
  type CapabilityCacheStorage,
  createCapabilityCache,
  markCapabilityCatalogueStale,
} from "../../apps/extension/lib/capability-cache";
import { fakeCapabilityCatalogue } from "../../apps/gateway/src/capabilities";

class MemoryStorage implements CapabilityCacheStorage {
  readonly values: Record<string, unknown> = {};

  async get(): Promise<Record<string, unknown>> {
    return { ...this.values };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }
}

describe("extension capability cache", () => {
  it("persists only a contract-valid catalogue", async () => {
    const storage = new MemoryStorage();
    const cache = createCapabilityCache(storage);

    expect(await cache.load()).toBeNull();
    await cache.save(fakeCapabilityCatalogue);
    expect(await cache.load()).toEqual(fakeCapabilityCatalogue);
  });

  it("ignores malformed cached data and marks valid fallback data stale", async () => {
    const storage = new MemoryStorage();
    storage.values.lingobridgeCapabilityCatalogue = { providerSecret: "invalid" };
    expect(await createCapabilityCache(storage).load()).toBeNull();
    expect(markCapabilityCatalogueStale(fakeCapabilityCatalogue).freshness).toBe("stale");
  });
});
