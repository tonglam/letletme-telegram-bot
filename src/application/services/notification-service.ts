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
}

export class MissingNotificationTargetsError extends Error {
  constructor() {
    super("Notification targets are required when no default target is configured.");
    this.name = "MissingNotificationTargetsError";
  }
}

type NotificationServiceOptions = {
  defaultTextTarget?: string | undefined;
};

export class NotificationService implements NotificationServicePort {
  constructor(
    private readonly telegramClient: TelegramClient,
    private readonly options: NotificationServiceOptions = {}
  ) {}

  async send(notification: NotificationRequest): Promise<NotificationResult> {
    const failures: NotificationFailure[] = [];
    const targets = this.resolveTargets(notification);

    for (const target of targets) {
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
      } catch (error) {
        failures.push(toNotificationFailure(target, error));
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
