import { LatestRequestRunner } from "../../apps/extension/lib/latest-request";
import { describe, expect, it } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("LatestRequestRunner", () => {
  it("marks a late older response stale even when its task ignores cancellation", async () => {
    const runner = new LatestRequestRunner();
    const olderTask = deferred<string>();
    const newerTask = deferred<string>();
    const olderOutcome = runner.run(() => olderTask.promise);
    const newerOutcome = runner.run(() => newerTask.promise);

    newerTask.resolve("new result");
    await expect(newerOutcome).resolves.toEqual({ status: "success", value: "new result" });

    olderTask.resolve("old result");
    await expect(olderOutcome).resolves.toEqual({ status: "stale" });
  });

  it("invalidates a request when the user cancels it", async () => {
    const runner = new LatestRequestRunner();
    const task = deferred<string>();
    const outcome = runner.run(() => task.promise);

    runner.cancel();
    task.resolve("must not render");

    await expect(outcome).resolves.toEqual({ status: "stale" });
  });
});
