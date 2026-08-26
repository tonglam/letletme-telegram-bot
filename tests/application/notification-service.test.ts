import { describe, expect, test } from "bun:test";

import {
  MissingNotificationTargetsError,
  NotificationService
} from "../../src/application/services/notification-service.ts";
import type { TelegramClient } from "../../src/application/ports/telegram-client.ts";
import { TelegramApiError } from "../../src/integrations/telegram/telegram-client.ts";

describe("NotificationService", () => {
  test("sends text notifications through the message path", async () => {
    const calls: Array<{ kind: string; target: string | number; text?: string | undefined; imageUrl?: string | undefined; caption?: string | undefined }> = [];
    const client: TelegramClient = {
      sendText: async ({ target, text }) => {
        calls.push({ kind: "text", target, text });
      },
      sendPhoto: async ({ target, imageUrl, caption }) => {
        calls.push({ kind: "image", target, imageUrl, caption });
      }
    };

    const service = new NotificationService(client);

    const result = await service.send({
      type: "text",
      targets: ["1001", 1002],
      text: "hello"
    });

    expect(result).toEqual({
      status: "success",
      notificationType: "text",
      requestedCount: 2,
      deliveredCount: 2,
      failedCount: 0,
      failures: []
    });
    expect(calls).toEqual([
      { kind: "text", target: "1001", text: "[letletme-telegram-bot] hello" },
      { kind: "text", target: 1002, text: "[letletme-telegram-bot] hello" }
    ]);
  });

  test("uses the configured default text target when none is provided", async () => {
    const calls: Array<{ kind: string; target: string | number; text?: string | undefined }> = [];
    const client: TelegramClient = {
      sendText: async ({ target, text }) => {
        calls.push({ kind: "text", target, text });
      },
      sendPhoto: async () => {
        throw new Error("sendPhoto should not be called");
      }
    };

    const service = new NotificationService(client, {
      defaultTextTarget: "123456789"
    });

    const result = await service.send({
      type: "text",
      targets: [],
      text: "hello"
    });

    expect(result).toEqual({
      status: "success",
      notificationType: "text",
      requestedCount: 1,
      deliveredCount: 1,
      failedCount: 0,
      failures: []
    });
    expect(calls).toEqual([
      { kind: "text", target: "123456789", text: "[letletme-telegram-bot] hello" }
    ]);
  });

  test("rejects an empty target set when no default is configured", async () => {
    let calls = 0;
    const service = new NotificationService({
      sendText: async () => {
        calls += 1;
      },
      sendPhoto: async () => {
        calls += 1;
      }
    });

    await expect(
      service.send({
        type: "text",
        targets: [],
        text: "hello"
      })
    ).rejects.toBeInstanceOf(MissingNotificationTargetsError);
    expect(calls).toBe(0);
  });

  test("aggregates partial failures without exposing raw errors", async () => {
    const client: TelegramClient = {
      sendText: async ({ target }) => {
        if (target === "1001") {
          throw new Error("https://api.telegram.org/botsecret-token leaked");
        }
      },
      sendPhoto: async () => undefined
    };

    const result = await new NotificationService(client).send({
      type: "text",
      targets: ["1001", "1002"],
      text: "hello"
    });

    expect(result).toEqual({
      status: "partial_failure",
      notificationType: "text",
      requestedCount: 2,
      deliveredCount: 1,
      failedCount: 1,
      failures: [
        {
          target: "1001",
          code: "telegram_transport_error",
          deliveryState: "unknown",
          message: "Notification delivery failed."
        }
      ]
    });
  });

  test("reports failure when every target fails", async () => {
    const service = new NotificationService({
      sendText: async () => {
        throw new Error("failed");
      },
      sendPhoto: async () => undefined
    });

    const result = await service.send({
      type: "text",
      targets: ["1001"],
      text: "hello"
    });

    expect(result.status).toBe("failure");
    expect(result.failedCount).toBe(1);
  });

  test("sends image notifications through the photo path and preserves caption", async () => {
    const calls: Array<{ kind: string; target: string | number; imageUrl?: string | undefined; caption?: string | undefined }> = [];
    const client: TelegramClient = {
      sendText: async () => {
        throw new Error("sendText should not be called");
      },
      sendPhoto: async ({ target, imageUrl, caption }) => {
        calls.push({ kind: "image", target, imageUrl, caption });
      }
    };

    const result = await new NotificationService(client).send({
      type: "image",
      targets: ["@team-chat"],
      imageUrl: "https://example.com/image.png",
      caption: "latest chart"
    });

    expect(result.status).toBe("success");
    expect(calls).toEqual([
      {
        kind: "image",
        target: "@team-chat",
        imageUrl: "https://example.com/image.png",
        caption: "latest chart"
      }
    ]);
  });

  test("exposes release, readiness, and bounded delivery counters", async () => {
    const service = new NotificationService(
      {
        sendText: async ({ target }) => {
          if (target === "429") {
            throw new TelegramApiError("Telegram rate limit persisted.", {
              statusCode: 429,
              errorCode: 429,
              code: "telegram_rate_limited",
              deliveryState: "not_delivered",
              retryAfterSeconds: 3
            });
          }
        },
        sendPhoto: async () => undefined
      },
      { release: "release-sha", configReady: false }
    );

    await service.send({
      type: "text",
      targets: ["ok", "429"],
      text: "health probe"
    });

    expect(service.getOperationalStatus()).toMatchObject({
      release: "release-sha",
      configReady: false,
      delivery: {
        attempted: 2,
        delivered: 1,
        failed: 1,
        unknown: 0,
        rateLimited: 1
      },
      lastFailureCode: "telegram_rate_limited"
    });
  });
});
