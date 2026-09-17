import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  keepWorkerAlive,
  WORKER_KEEPALIVE_INTERVAL_MS,
} from "../../apps/extension/lib/worker-keepalive";

describe("keepWorkerAlive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pings well inside Chrome's 30-second idle limit until stopped", async () => {
    expect(WORKER_KEEPALIVE_INTERVAL_MS).toBeLessThan(30_000);
    const ping = vi.fn(async () => undefined);
    const stop = keepWorkerAlive(ping);

    await vi.advanceTimersByTimeAsync(66_000);
    expect(ping).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it("keeps pinging when one ping fails", async () => {
    const ping = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("worker busy"))
      .mockResolvedValue(undefined);
    const stop = keepWorkerAlive(ping, 10);

    await vi.advanceTimersByTimeAsync(30);
    expect(ping).toHaveBeenCalledTimes(3);
    stop();
  });
});
