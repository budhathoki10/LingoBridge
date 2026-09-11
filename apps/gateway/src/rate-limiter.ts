export interface RateLimitRule {
  limit: number;
  windowMilliseconds: number;
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

    entry.count += 1;
    this.checksSinceCleanup += 1;
    if (this.checksSinceCleanup >= 256) this.removeExpiredEntries(currentTime);

    const allowed = entry.count <= rule.limit;
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
