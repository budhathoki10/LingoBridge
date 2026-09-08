export type ProviderInterruption = "cancelled" | "timeout";

export class ProviderInterruptedError extends Error {
  constructor(readonly reason: ProviderInterruption) {
    super(reason === "timeout" ? "Provider deadline exceeded" : "Request cancelled");
    this.name = "ProviderInterruptedError";
  }
}

export async function runWithProviderDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  requestSignal: AbortSignal,
  timeoutMilliseconds: number,
): Promise<T> {
  const providerController = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let handleRequestAbort: (() => void) | undefined;

  const interruption = new Promise<never>((_resolve, reject) => {
    handleRequestAbort = () => {
      reject(new ProviderInterruptedError("cancelled"));
      providerController.abort();
    };

    if (requestSignal.aborted) {
      handleRequestAbort();
      return;
    }

    requestSignal.addEventListener("abort", handleRequestAbort, { once: true });
    timeout = setTimeout(() => {
      reject(new ProviderInterruptedError("timeout"));
      providerController.abort();
    }, timeoutMilliseconds);
  });

  try {
    return await Promise.race([operation(providerController.signal), interruption]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (handleRequestAbort) requestSignal.removeEventListener("abort", handleRequestAbort);
  }
}
