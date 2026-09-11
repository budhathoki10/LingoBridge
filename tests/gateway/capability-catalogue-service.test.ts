import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CapabilityCatalogueService,
  type CapabilityCatalogueSource,
  type CapabilityCatalogueStore,
} from "../../apps/gateway/src/capability-catalogue-service";
import { FileCapabilityCatalogueStore } from "../../apps/gateway/src/file-capability-catalogue-store";
import type { CapabilityCatalogue } from "../../packages/contracts/src/index";

function catalogue(verifiedAt: string): CapabilityCatalogue {
  return {
    catalogueVersion: "google-nmt-test-version",
    directions: [],
    freshness: "fresh",
    generatedAt: verifiedAt,
    googlePairing: "all-listed",
    languages: [
      {
        code: "en",
        googleSource: true,
        googleTarget: true,
        name: "English",
        nativeName: null,
        textDirection: "ltr",
      },
      {
        code: "ne",
        googleSource: true,
        googleTarget: true,
        name: "Nepali",
        nativeName: "नेपाली",
        textDirection: "ltr",
      },
    ],
    source: "google-nmt",
    verifiedAt,
  };
}

class MemoryStore implements CapabilityCatalogueStore {
  saved: CapabilityCatalogue[] = [];

  constructor(readonly stored: unknown | null) {}

  async load(): Promise<unknown | null> {
    return this.stored;
  }

  async save(value: CapabilityCatalogue): Promise<void> {
    this.saved.push(value);
  }
}

class QueueSource implements CapabilityCatalogueSource {
  calls = 0;

  constructor(private readonly results: Array<CapabilityCatalogue | Error>) {}

  async fetch(): Promise<CapabilityCatalogue> {
    const result = this.results[this.calls++];
    if (result instanceof Error) throw result;
    if (!result) throw new Error("No queued source result");
    return result;
  }
}

function service(
  source: CapabilityCatalogueSource,
  store: CapabilityCatalogueStore,
  now: () => number,
) {
  return new CapabilityCatalogueService(
    source,
    store,
    { freshForMilliseconds: 60_000, retryAfterFailureMilliseconds: 10_000 },
    now,
  );
}

describe("CapabilityCatalogueService", () => {
  it("saves and reuses a fresh provider catalogue", async () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const source = new QueueSource([catalogue(new Date(now).toISOString())]);
    const store = new MemoryStore(null);
    const registry = service(source, store, () => now);

    const first = await registry.get(new AbortController().signal);
    const second = await registry.get(new AbortController().signal);

    expect(first.freshness).toBe("fresh");
    expect(second).toEqual(first);
    expect(source.calls).toBe(1);
    expect(store.saved).toEqual([first]);
  });

  it("keeps a shared refresh alive when one caller cancels", async () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const fresh = catalogue(new Date(now).toISOString());
    let release: (() => void) | undefined;
    let calls = 0;
    const source: CapabilityCatalogueSource = {
      fetch: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = () => resolve(fresh);
        });
      },
    };
    const registry = service(source, new MemoryStore(null), () => now);
    const cancelledController = new AbortController();

    const cancelledRequest = registry.get(cancelledController.signal);
    const activeRequest = registry.get(new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    cancelledController.abort();
    release?.();

    await expect(cancelledRequest).rejects.toMatchObject({ name: "AbortError" });
    await expect(activeRequest).resolves.toEqual(fresh);
    expect(calls).toBe(1);
  });

  it("returns a stale last-known-good catalogue when refresh fails", async () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const source = new QueueSource([new Error("provider offline")]);
    const registry = service(
      source,
      new MemoryStore(catalogue("2026-09-01T00:00:00.000Z")),
      () => now,
    );

    const stale = await registry.get(new AbortController().signal);
    const withinBackoff = await registry.get(new AbortController().signal);

    expect(stale.freshness).toBe("stale");
    expect(withinBackoff.freshness).toBe("stale");
    expect(source.calls).toBe(1);
  });

  it("ignores a malformed stored snapshot when a fresh provider result exists", async () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const fresh = catalogue(new Date(now).toISOString());
    const registry = service(
      new QueueSource([fresh]),
      new MemoryStore({ secret: "bad" }),
      () => now,
    );

    await expect(registry.get(new AbortController().signal)).resolves.toEqual(fresh);
  });

  it("uses the last-known-good snapshot when provider metadata is malformed", async () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const source = new QueueSource([{ unexpected: true } as unknown as CapabilityCatalogue]);
    const registry = service(
      source,
      new MemoryStore(catalogue("2026-09-01T00:00:00.000Z")),
      () => now,
    );

    await expect(registry.get(new AbortController().signal)).resolves.toMatchObject({
      freshness: "stale",
      source: "google-nmt",
    });
  });

  it("returns a safe unavailable error when neither provider nor cache is valid", async () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const registry = service(
      new QueueSource([new Error("provider offline")]),
      new MemoryStore({ malformed: true }),
      () => now,
    );

    await expect(registry.get(new AbortController().signal)).rejects.toMatchObject({
      name: "CapabilityCatalogueUnavailableError",
    });
  });
});

describe("FileCapabilityCatalogueStore", () => {
  it("round-trips a last-known-good snapshot through an atomic file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lingobridge-capabilities-"));
    try {
      const store = new FileCapabilityCatalogueStore(join(directory, "catalogue.json"));
      const snapshot = catalogue("2026-09-07T12:00:00.000Z");

      expect(await store.load()).toBeNull();
      await store.save(snapshot);
      expect(await store.load()).toEqual(snapshot);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
