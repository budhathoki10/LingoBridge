export type LatestRequestOutcome<T> =
  | { status: "error"; error: unknown }
  | { status: "stale" }
  | { status: "success"; value: T };

export class LatestRequestRunner {
  private activeController: AbortController | undefined;
  private sequence = 0;

  async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<LatestRequestOutcome<T>> {
    this.activeController?.abort();
    const requestSequence = ++this.sequence;
    const controller = new AbortController();
    this.activeController = controller;

    try {
      const value = await task(controller.signal);

      if (requestSequence !== this.sequence || controller.signal.aborted) {
        return { status: "stale" };
      }

      this.activeController = undefined;
      return { status: "success", value };
    } catch (error) {
      if (requestSequence !== this.sequence || controller.signal.aborted) {
        return { status: "stale" };
      }

      this.activeController = undefined;
      return { status: "error", error };
    }
  }

  cancel(): void {
    this.sequence += 1;
    this.activeController?.abort();
    this.activeController = undefined;
  }
}
