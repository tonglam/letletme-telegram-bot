import { describe, expect, test } from "bun:test";

import {
  MissingNotificationTargetsError,
  type NotificationServicePort
} from "../../src/application/services/notification-service.ts";
import { createApp, createRequestLog } from "../../src/http/create-app.ts";

const apiToken = "secret";

function headers(withAuth = true): HeadersInit {
  return {
    "content-type": "application/json",
    ...(withAuth ? { authorization: `Bearer ${apiToken}` } : {})
  };
}

function createTestApp(service: NotificationServicePort, logs: unknown[] = []) {
  return createApp({
    notificationService: service,
    apiToken,
    logger: (entry) => logs.push(entry)
  });
}

describe("notification route", () => {
  test("creates timestamped request logs without payload fields", () => {
    const log = createRequestLog({
      requestId: "request-1",
      method: "POST",
      path: "/telegramBot/letletme/notification",
      statusCode: 200,
      durationMs: 4
    });

    expect(log).toEqual({
      event: "http_request",
      timestamp: expect.any(String),
      requestId: "request-1",
      method: "POST",
      path: "/telegramBot/letletme/notification",
      statusCode: 200,
      durationMs: 4
    });
  });

  test("accepts a valid text notification request", async () => {
    const service: NotificationServicePort = {
      send: async (notification) => ({
        status: "success",
        notificationType: notification.type,
        requestedCount: notification.targets.length,
        deliveredCount: notification.targets.length,
        failedCount: 0,
        failures: []
      })
    };

    const app = createTestApp(service);
    const response = await app.handle(
      new Request("http://localhost/telegramBot/letletme/notification", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          type: "text",
          targets: ["1001"],
          text: "hello"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9._-]+$/);
    await expect(response.json()).resolves.toEqual({
      status: "success",
      notificationType: "text",
      requestedCount: 1,
      deliveredCount: 1,
      failedCount: 0,
      failures: []
    });
  });

  test("accepts a valid image notification request with caption", async () => {
    const service: NotificationServicePort = {
      send: async (notification) => ({
        status: "success",
        notificationType: notification.type,
        requestedCount: notification.targets.length,
        deliveredCount: notification.targets.length,
        failedCount: 0,
        failures: []
      })
    };

    const app = createTestApp(service);
    const response = await app.handle(
      new Request("http://localhost/telegramBot/letletme/notification", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          type: "image",
          targets: ["1001"],
          imageUrl: "https://example.com/chart.png",
          caption: "price update"
        })
      })
    );

    expect(response.status).toBe(200);
  });

  test("maps the service missing-target error to a 422", async () => {
    let called = false;
    const service: NotificationServicePort = {
      send: async () => {
        called = true;
        throw new MissingNotificationTargetsError();
      }
    };

    const app = createTestApp(service);
    const response = await app.handle(
      new Request("http://localhost/telegramBot/letletme/notification", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          type: "text",
          text: "hello"
        })
      })
    );

    expect(response.status).toBe(422);
    expect(called).toBe(true);
    await expect(response.json()).resolves.toEqual({
      code: "notification_targets_required",
      message: "Notification targets are required when no default target is configured."
    });
  });

  test("rejects unauthorized callers before validating the body", async () => {
    const service: NotificationServicePort = {
      send: async () => {
        throw new Error("send should not be called");
      }
    };

    const app = createTestApp(service);
    const response = await app.handle(
      new Request("http://localhost/telegramBot/letletme/notification", {
        method: "POST",
        headers: headers(false),
        body: JSON.stringify({
          type: "image",
          targets: [],
          imageUrl: ""
        })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Missing or invalid bearer token."
    });
  });

  test("rejects invalid notification payloads after authentication", async () => {
    const service: NotificationServicePort = {
      send: async () => {
        throw new Error("send should not be called");
      }
    };

    const app = createTestApp(service);
    const response = await app.handle(
      new Request("http://localhost/telegramBot/letletme/notification", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          type: "image",
          targets: [],
          imageUrl: ""
        })
      })
    );

    expect(response.status).toBe(422);
  });

  test("enforces Telegram-safe request bounds", async () => {
    const service: NotificationServicePort = {
      send: async () => {
        throw new Error("send should not be called");
      }
    };
    const app = createTestApp(service);

    const longTextResponse = await app.handle(
      new Request("http://localhost/telegramBot/letletme/notification", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ type: "text", targets: ["1001"], text: "x".repeat(4073) })
      })
    );
    const tooManyTargetsResponse = await app.handle(
      new Request("http://localhost/telegramBot/letletme/notification", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ type: "text", targets: Array.from({ length: 51 }, (_, i) => String(i)), text: "hello" })
      })
    );
    const invalidUrlResponse = await app.handle(
      new Request("http://localhost/telegramBot/letletme/notification", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          type: "image",
          targets: ["1001"],
          imageUrl: "ftp://example.com/chart.png"
        })
      })
    );

    expect(longTextResponse.status).toBe(422);
    expect(tooManyTargetsResponse.status).toBe(422);
    expect(invalidUrlResponse.status).toBe(422);
  });

  test("serves health without API authentication", async () => {
    const service: NotificationServicePort = {
      send: async () => {
        throw new Error("send should not be called");
      }
    };
    const app = createTestApp(service);
    const response = await app.handle(new Request("http://localhost/healthz"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
