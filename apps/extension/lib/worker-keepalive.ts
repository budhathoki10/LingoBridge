/**
 * Chrome stops an extension service worker after about 30 seconds without extension activity, and
 * a pending fetch does not count. An explanation that waits on NVIDIA and then the OpenRouter
 * backup can take longer, so an extension API call is made on an interval while it is pending.
 */
export const WORKER_KEEPALIVE_INTERVAL_MS = 20_000;

export function keepWorkerAlive(
  ping: () => Promise<unknown>,
  intervalMilliseconds = WORKER_KEEPALIVE_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    ping().catch(() => undefined);
  }, intervalMilliseconds);
  return () => clearInterval(timer);
}
