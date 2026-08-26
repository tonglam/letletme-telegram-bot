import { Elysia, t } from "elysia";

import {
  MissingNotificationTargetsError,
  type NotificationOperationalStatus,
  type NotificationServicePort
} from "../application/services/notification-service.ts";
import type { NotificationResult } from "../domain/notification.ts";

const notificationPath = "/telegramBot/letletme/notification";
const targetSchema = t.Union([
  t.String({ minLength: 1, maxLength: 128 }),
  t.Integer()
]);

const textNotificationSchema = t.Object({
  type: t.Literal("text"),
  targets: t.Optional(t.Array(targetSchema, { maxItems: 50 })),
  text: t.String({ minLength: 1, maxLength: 4072 })
});

const imageNotificationSchema = t.Object({
  type: t.Literal("image"),
  targets: t.Array(targetSchema, { minItems: 1, maxItems: 50 }),
  imageUrl: t.String({ minLength: 1, maxLength: 2048, format: "uri", pattern: "^https?://" }),
  caption: t.Optional(t.String({ minLength: 1, maxLength: 1024 }))
});

export type RequestLog = {
  event: "http_request";
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  notificationType?: NotificationResult["notificationType"] | undefined;
  requestedCount?: number | undefined;
  deliveredCount?: number | undefined;
  failedCount?: number | undefined;
};

type CreateAppOptions = {
  notificationService: NotificationServicePort;
  apiToken: string;
  logger?: (entry: RequestLog) => void;
};

type RequestMetadata = {
  requestId: string;
  startedAt: number;
};

export function createRequestLog(fields: Omit<RequestLog, "event" | "timestamp">): RequestLog {
  return {
    event: "http_request",
    timestamp: new Date().toISOString(),
    ...fields
  };
}

export function createApp({ notificationService, apiToken, logger = logRequest }: CreateAppOptions) {
  const requestMetadata = new WeakMap<Request, RequestMetadata>();

  return new Elysia()
    .onRequest(({ request, set }) => {
      const requestId = requestIdFrom(request.headers.get("x-request-id"));
      requestMetadata.set(request, {
        requestId,
        startedAt: performance.now()
      });
      set.headers["x-request-id"] = requestId;

      if (
        request.method === "POST" &&
        new URL(request.url).pathname === notificationPath &&
        !isAuthorized(request.headers.get("authorization"), apiToken)
      ) {
        set.status = 401;
        return {
          code: "unauthorized",
          message: "Missing or invalid bearer token."
        };
      }
    })
    .get("/healthz", () => ({ status: "ok" }))
    .get("/health/ready", ({ set }) => {
      const status = notificationService.getOperationalStatus?.();
      const ready = status?.configReady ?? true;
      if (!ready) set.status = 503;
      return { status: ready ? "ok" : "not_ready", configReady: ready };
    })
    .get("/internal/ops/status", ({ headers, set }) => {
      if (!isAuthorized(headers.authorization ?? null, apiToken)) {
        set.status = 401;
        return { code: "unauthorized", message: "Missing or invalid bearer token." };
      }
      return statusForService(notificationService);
    })
    .post(
      notificationPath,
      async ({ body, set }) => {
        try {
          return await notificationService.send({
            ...body,
            targets: body.targets ?? []
          });
        } catch (error) {
          if (error instanceof MissingNotificationTargetsError) {
            set.status = 422;
            return {
              code: "notification_targets_required",
              message: error.message
            };
          }

          throw error;
        }
      },
      {
        body: t.Union([textNotificationSchema, imageNotificationSchema])
      }
    )
    .onAfterResponse(({ request, responseValue, set }) => {
      const metadata = requestMetadata.get(request);
      if (!metadata) {
        return;
      }

      const result = isNotificationResult(responseValue) ? responseValue : undefined;
      logger(
        createRequestLog({
          requestId: metadata.requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          statusCode: numericStatus(set.status),
          durationMs: Math.round(performance.now() - metadata.startedAt),
          ...(result === undefined
            ? {}
            : {
                notificationType: result.notificationType,
                requestedCount: result.requestedCount,
                deliveredCount: result.deliveredCount,
                failedCount: result.failedCount
              })
        })
      );
    });
}

function statusForService(service: NotificationServicePort): NotificationOperationalStatus {
  return service.getOperationalStatus?.() ?? {
    release: "unknown",
    startedAt: new Date().toISOString(),
    configReady: false,
    delivery: { attempted: 0, delivered: 0, failed: 0, unknown: 0, rateLimited: 0 },
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureCode: null,
  };
}

function isAuthorized(header: string | null, expectedToken: string): boolean {
  const expected = `Bearer ${expectedToken}`;
  if (header === null || header.length !== expected.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ header.charCodeAt(index);
  }

  return difference === 0;
}

function requestIdFrom(value: string | null): string {
  if (value && /^[A-Za-z0-9._-]{1,64}$/.test(value)) {
    return value;
  }

  return crypto.randomUUID();
}

function numericStatus(status: number | string | undefined): number {
  if (typeof status === "number") {
    return status;
  }

  const parsed = Number(status);
  return Number.isInteger(parsed) ? parsed : 200;
}

function isNotificationResult(value: unknown): value is NotificationResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<NotificationResult>;
  return (
    (candidate.status === "success" || candidate.status === "partial_failure" || candidate.status === "failure") &&
    (candidate.notificationType === "text" || candidate.notificationType === "image") &&
    typeof candidate.requestedCount === "number" &&
    typeof candidate.deliveredCount === "number" &&
    typeof candidate.failedCount === "number"
  );
}

function logRequest(entry: RequestLog): void {
  console.log(JSON.stringify(entry));
}
