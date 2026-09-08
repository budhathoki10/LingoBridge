import { type CapabilityCatalogue, capabilityCatalogueSchema } from "@lingobridge/contracts";

export interface CapabilityCatalogueSource {
  fetch(signal: AbortSignal): Promise<CapabilityCatalogue>;
}

export interface CapabilityCatalogueStore {
  load(): Promise<unknown | null>;
  save(catalogue: CapabilityCatalogue): Promise<void>;
}

export interface CapabilityCatalogueServiceOptions {
  freshForMilliseconds: number;
  retryAfterFailureMilliseconds: number;
}

export class CapabilityCatalogueUnavailableError extends Error {
  constructor() {
    super("No valid capability catalogue is available.");
    this.name = "CapabilityCatalogueUnavailableError";
  }
}

function withFreshness(
  catalogue: CapabilityCatalogue,
  freshness: "fresh" | "stale",
): CapabilityCatalogue {
  return capabilityCatalogueSchema.parse({ ...catalogue, freshness });
}

function abortError(): DOMException {
  return new DOMException("The capability request was cancelled.", "AbortError");
}

function waitForCatalogue(
  catalogue: Promise<CapabilityCatalogue>,
  signal: AbortSignal,
): Promise<CapabilityCatalogue> {
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });

    catalogue.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export class CapabilityCatalogueService {
  private cached: CapabilityCatalogue | null = null;
  private initialized = false;
  private nextRefreshAt = 0;
  private refreshInFlight: Promise<CapabilityCatalogue> | null = null;

  constructor(
    private readonly source: CapabilityCatalogueSource,
    private readonly store: CapabilityCatalogueStore,
    private readonly options: CapabilityCatalogueServiceOptions,
    private readonly now: () => number = Date.now,
  ) {}

  async get(signal: AbortSignal): Promise<CapabilityCatalogue> {
    await this.loadStoredCatalogue();
    const currentTime = this.now();
    if (this.cached) {
      const verifiedAt = Date.parse(this.cached.verifiedAt);
      if (currentTime - verifiedAt < this.options.freshForMilliseconds) {
        this.cached = withFreshness(this.cached, "fresh");
        return this.cached;
      }
      if (currentTime < this.nextRefreshAt) return withFreshness(this.cached, "stale");
    }

    this.refreshInFlight ??= this.refresh(new AbortController().signal).finally(() => {
      this.refreshInFlight = null;
    });
    return waitForCatalogue(this.refreshInFlight, signal);
  }

  private async loadStoredCatalogue(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const parsed = capabilityCatalogueSchema.safeParse(await this.store.load());
      if (parsed.success && parsed.data.source !== "fake") this.cached = parsed.data;
    } catch {
      this.cached = null;
    }
  }

  private async refresh(signal: AbortSignal): Promise<CapabilityCatalogue> {
    try {
      const fresh = capabilityCatalogueSchema.parse(await this.source.fetch(signal));
      if (fresh.source === "fake" || fresh.freshness !== "fresh") {
        throw new CapabilityCatalogueUnavailableError();
      }
      this.cached = fresh;
      this.nextRefreshAt = this.now() + this.options.freshForMilliseconds;
      try {
        await this.store.save(fresh);
      } catch {
        // Serving a validated fresh catalogue is safer than failing because persistence is offline.
      }
      return fresh;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      this.nextRefreshAt = this.now() + this.options.retryAfterFailureMilliseconds;
      if (this.cached) {
        this.cached = withFreshness(this.cached, "stale");
        return this.cached;
      }
      throw new CapabilityCatalogueUnavailableError();
    }
  }
}
