export interface RateLimitRule {
  limit: number;
  windowMilliseconds: number;
  /**
   * When set, going over the limit locks the key for this long from that moment, and a fresh
   * window starts afterwards. Without it the wait is only what remains of the current window,
   * which can be a few seconds when the window began long before the limit was reached.
   */
  lockoutMilliseconds?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(scope: string, key: string, rule: RateLimitRule): RateLimitDecision;
}

interface WindowEntry {
  count: number;
  /** Set while a lockout lasts; `resetAt` then equals it, so the lockout ends in a fresh window. */
  lockedUntil?: number;
  resetAt: number;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, WindowEntry>();
  private checksSinceCleanup = 0;

  constructor(private readonly now: () => number = Date.now) {}

  consume(scope: string, key: string, rule: RateLimitRule): RateLimitDecision {
    const currentTime = this.now();
    const entryKey = `${scope}:${key}`;
    let entry = this.entries.get(entryKey);

    if (!entry || entry.resetAt <= currentTime) {
      entry = { count: 0, resetAt: currentTime + rule.windowMilliseconds };
      this.entries.set(entryKey, entry);
    }

    // Attempts during a lockout neither count nor extend it.
    if (entry.lockedUntil !== undefined) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - currentTime) / 1_000)),
      };
    }

    entry.count += 1;
    this.checksSinceCleanup += 1;
    if (this.checksSinceCleanup >= 256) this.removeExpiredEntries(currentTime);

    const allowed = entry.count <= rule.limit;
    if (!allowed && rule.lockoutMilliseconds !== undefined) {
      entry.lockedUntil = currentTime + rule.lockoutMilliseconds;
      entry.resetAt = entry.lockedUntil;
    }
    return {
      allowed,
      remaining: Math.max(0, rule.limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1_000)),
    };
  }

  private removeExpiredEntries(currentTime: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= currentTime) this.entries.delete(key);
    }
    this.checksSinceCleanup = 0;
  }
}
