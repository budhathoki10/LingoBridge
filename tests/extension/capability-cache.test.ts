import type { CapabilityCatalogue } from "@lingobridge/contracts";
import { describe, expect, it } from "vitest";
import {
  type CapabilityCacheStorage,
  createCapabilityCache,
  markCapabilityCatalogueStale,
} from "../../apps/extension/lib/capability-cache";
import { fakeCapabilityCatalogue } from "../../apps/gateway/src/capabilities";
import { createNvidiaCapabilityCatalogue } from "../../apps/gateway/src/nvidia-capabilities";

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

  it("ignores stale pre-MyMemory live capability catalogues", async () => {
    const storage = new MemoryStorage();
    const catalogue = createNvidiaCapabilityCatalogue();
    const oldCatalogue = {
      ...catalogue,
      catalogueVersion: "nvidia-riva-old",
      languages: catalogue.languages.slice(0, 20),
      source: "nvidia-riva",
    } as CapabilityCatalogue;
    storage.values.lingobridgeCapabilityCatalogue = oldCatalogue;

    expect(await createCapabilityCache(storage).load()).toBeNull();
    await expect(createCapabilityCache(storage).save(oldCatalogue)).rejects.toThrow(
      "predates MyMemory support",
    );
  });
});
