export type StoppableApp = {
  stop(closeActiveConnections?: boolean): Promise<unknown>;
};

type SignalSource = {
  on(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
};

type ShutdownTimer = ReturnType<typeof setTimeout> | number;

type ShutdownOptions = {
  signalSource?: SignalSource;
  exit?: (code: number) => void;
  timeoutMs?: number;
  schedule?: (callback: () => void, milliseconds: number) => ShutdownTimer;
  cancel?: (timer: ShutdownTimer) => void;
  logger?: (message: string) => void;
};

export function installGracefulShutdown(app: StoppableApp, options: ShutdownOptions = {}): void {
  const signalSource = options.signalSource ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const schedule = options.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const logger = options.logger ?? console.error;
  let shuttingDown = false;
  let completed = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger("Shutdown requested; draining in-flight requests.");
    const forceTimer = schedule(() => {
      if (completed) {
        return;
      }

      completed = true;
      logger("Graceful shutdown timed out; closing active connections.");
      void app.stop(true).then(
        () => exit(1),
        () => exit(1)
      );
    }, timeoutMs);

    try {
      await app.stop(false);
      if (completed) {
        return;
      }

      completed = true;
      cancel(forceTimer);
      exit(0);
    } catch {
      if (completed) {
        return;
      }

      completed = true;
      cancel(forceTimer);
      logger("Graceful shutdown failed.");
      exit(1);
    }
  };

  signalSource.on("SIGTERM", () => {
    void shutdown();
  });
  signalSource.on("SIGINT", () => {
    void shutdown();
  });
}
