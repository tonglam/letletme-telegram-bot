import { describe, expect, test } from "bun:test";

import { installGracefulShutdown } from "../../src/runtime/shutdown.ts";

describe("installGracefulShutdown", () => {
  test("drains active requests after SIGTERM", async () => {
    const listeners = new Map<string, () => void>();
    const stops: Array<boolean | undefined> = [];
    const exits: number[] = [];
    let cancelled = false;
    const logs: string[] = [];

    installGracefulShutdown(
      {
        stop: async (closeActiveConnections) => {
          stops.push(closeActiveConnections);
        }
      },
      {
        signalSource: {
          on: (signal, listener) => {
            listeners.set(signal, listener);
          }
        },
        exit: (code) => exits.push(code),
        schedule: () => 1,
        cancel: () => {
          cancelled = true;
        },
        logger: (message) => logs.push(message)
      }
    );

    listeners.get("SIGTERM")?.();
    await Promise.resolve();

    expect(stops).toEqual([false]);
    expect(exits).toEqual([0]);
    expect(cancelled).toBe(true);
    expect(JSON.parse(logs[0] ?? "")).toEqual({
      event: "shutdown_requested",
      timestamp: expect.any(String)
    });
  });

  test("forces active connections closed after the drain deadline", async () => {
    const listeners = new Map<string, () => void>();
    const stops: Array<boolean | undefined> = [];
    const exits: number[] = [];
    let forceTimer: (() => void) | undefined;

    installGracefulShutdown(
      {
        stop: async (closeActiveConnections) => {
          stops.push(closeActiveConnections);
          if (!closeActiveConnections) {
            await new Promise(() => undefined);
          }
        }
      },
      {
        signalSource: {
          on: (signal, listener) => {
            listeners.set(signal, listener);
          }
        },
        exit: (code) => exits.push(code),
        schedule: (callback) => {
          forceTimer = callback;
          return 1;
        },
        cancel: () => undefined,
        logger: () => undefined
      }
    );

    listeners.get("SIGTERM")?.();
    forceTimer?.();
    await Promise.resolve();

    expect(stops).toEqual([false, true]);
    expect(exits).toEqual([1]);
  });
});
