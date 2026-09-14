export interface RateLimitRule {
  limit: number;
  windowMilliseconds: number;
}

export const RATE_LIMITS = {
  /** Token exchange and refresh, keyed by network address. */
  extensionToken: { limit: 30, windowMilliseconds: 60_000 },
  /** Sync round trips, keyed by extension session. */
  sync: { limit: 60, windowMilliseconds: 60_000 },
  /** Dashboard mutations, keyed by user. */
  dashboardMutation: { limit: 120, windowMilliseconds: 60_000 },
  /** Sign-in starts, keyed by network address. */
  signIn: { limit: 20, windowMilliseconds: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counters held in memory. A multi-instance deployment should front this with a
 * shared limiter; the interface is deliberately small so that swap does not touch handlers.
 */
export class MemoryRateLimiter {
  readonly #buckets = new Map<string, { count: number; resetAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  consume(
    scope: string,
    key: string,
    rule: RateLimitRule,
  ): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.#now();
    const bucketKey = `${scope}:${key}`;
    let bucket = this.#buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMilliseconds };
      this.#buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    if (this.#buckets.size > 50_000) {
      for (const [entryKey, entry] of this.#buckets) {
        if (entry.resetAt <= now) this.#buckets.delete(entryKey);
      }
    }
    return {
      allowed: bucket.count <= rule.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }
}

/** Only a coarse, truncated address is used as a limiter key and it is never logged. */
export function networkKey(request: Request): string {
  const forwarded = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("X-Real-IP") || "unknown-network";
  if (address.includes(":")) return address.split(":").slice(0, 4).join(":");
  return address.split(".").slice(0, 3).join(".");
}
