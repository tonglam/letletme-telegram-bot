import type {
  NotificationFailure,
  NotificationFailureCode,
  NotificationRequest,
  NotificationResult,
  NotificationDeliveryState
} from "../../domain/notification.ts";
import type { TelegramClient } from "../ports/telegram-client.ts";

export interface NotificationServicePort {
  send(notification: NotificationRequest): Promise<NotificationResult>;
  getOperationalStatus?(): NotificationOperationalStatus;
}

export type NotificationOperationalStatus = {
  release: string;
  startedAt: string;
  configReady: boolean;
  delivery: {
    attempted: number;
    delivered: number;
    failed: number;
    unknown: number;
    rateLimited: number;
  };
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureCode: string | null;
};

export class MissingNotificationTargetsError extends Error {
  constructor() {
    super("Notification targets are required when no default target is configured.");
    this.name = "MissingNotificationTargetsError";
  }
}

type NotificationServiceOptions = {
  defaultTextTarget?: string | undefined;
  release?: string | undefined;
  configReady?: boolean | undefined;
};

export class NotificationService implements NotificationServicePort {
  private readonly startedAt = new Date().toISOString();
  private readonly counters = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    unknown: 0,
    rateLimited: 0,
    lastAttemptAt: null as string | null,
    lastSuccessAt: null as string | null,
    lastFailureCode: null as string | null,
  };

  constructor(
    private readonly telegramClient: TelegramClient,
    private readonly options: NotificationServiceOptions = {}
  ) {}

  async send(notification: NotificationRequest): Promise<NotificationResult> {
    const failures: NotificationFailure[] = [];
    let targets: ReturnType<NotificationService['resolveTargets']> extends infer T ? T : never;
    try {
      targets = this.resolveTargets(notification);
    } catch (error) {
      throw error;
    }

    for (const target of targets) {
      this.counters.attempted += 1;
      this.counters.lastAttemptAt = new Date().toISOString();
      try {
        if (notification.type === "text") {
          await this.telegramClient.sendText({
            target,
            text: this.formatText(notification.text)
          });
        } else {
          await this.telegramClient.sendPhoto({
            target,
            imageUrl: notification.imageUrl,
            caption: notification.caption
          });
        }
        this.counters.delivered += 1;
        this.counters.lastSuccessAt = new Date().toISOString();
      } catch (error) {
        const failure = toNotificationFailure(target, error);
        this.recordFailure(failure);
        failures.push(failure);
      }
    }

    const requestedCount = targets.length;
    const failedCount = failures.length;
    const deliveredCount = requestedCount - failedCount;

    return {
      status:
        failedCount === 0 ? "success" : deliveredCount === 0 ? "failure" : "partial_failure",
      notificationType: notification.type,
      requestedCount,
      deliveredCount,
      failedCount,
      failures
    };
  }

  getOperationalStatus(): NotificationOperationalStatus {
    return {
      release: this.options.release ?? 'unknown',
      startedAt: this.startedAt,
      configReady: this.options.configReady ?? true,
      delivery: {
        attempted: this.counters.attempted,
        delivered: this.counters.delivered,
        failed: this.counters.failed,
        unknown: this.counters.unknown,
        rateLimited: this.counters.rateLimited,
      },
      lastAttemptAt: this.counters.lastAttemptAt,
      lastSuccessAt: this.counters.lastSuccessAt,
      lastFailureCode: this.counters.lastFailureCode,
    };
  }

  private recordFailure(error: unknown): void {
    this.counters.failed += 1;
    const candidate = error !== null && typeof error === 'object' ? error as {
      code?: unknown;
      deliveryState?: unknown;
    } : {};
    if (candidate.deliveryState === 'unknown') this.counters.unknown += 1;
    if (candidate.code === 'telegram_rate_limited') this.counters.rateLimited += 1;
    this.counters.lastFailureCode = typeof candidate.code === 'string'
      ? candidate.code
      : 'telegram_transport_error';
  }

  private resolveTargets(notification: NotificationRequest) {
    if (notification.targets.length > 0) {
      return notification.targets;
    }

    if (notification.type === "text" && this.options.defaultTextTarget) {
      return [this.options.defaultTextTarget];
    }

    throw new MissingNotificationTargetsError();
  }

  private formatText(text: string) {
    return `[letletme-telegram-bot] ${text}`;
  }
}

function toNotificationFailure(target: NotificationFailure["target"], error: unknown): NotificationFailure {
  const candidate: {
    code?: unknown;
    deliveryState?: unknown;
    publicMessage?: unknown;
    retryAfterSeconds?: unknown;
  } = error !== null && typeof error === "object" ? error : {};
  const code = isFailureCode(candidate.code) ? candidate.code : "telegram_transport_error";
  const deliveryState = isDeliveryState(candidate.deliveryState) ? candidate.deliveryState : "unknown";
  const retryAfterSeconds =
    typeof candidate.retryAfterSeconds === "number" &&
    Number.isInteger(candidate.retryAfterSeconds) &&
    candidate.retryAfterSeconds >= 0
      ? candidate.retryAfterSeconds
      : undefined;

  return {
    target,
    code,
    deliveryState,
    message: typeof candidate.publicMessage === "string" ? candidate.publicMessage : "Notification delivery failed.",
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
  };
}

function isFailureCode(value: unknown): value is NotificationFailureCode {
  return (
    value === "telegram_rejected" ||
    value === "telegram_rate_limited" ||
    value === "telegram_unavailable" ||
    value === "telegram_timeout" ||
    value === "telegram_transport_error"
  );
}

function isDeliveryState(value: unknown): value is NotificationDeliveryState {
  return value === "not_delivered" || value === "unknown";
}
