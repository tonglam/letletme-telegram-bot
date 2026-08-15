export type NotificationTarget = string | number;

export type TextNotification = {
  type: "text";
  targets: NotificationTarget[];
  text: string;
};

export type ImageNotification = {
  type: "image";
  targets: NotificationTarget[];
  imageUrl: string;
  caption?: string | undefined;
};

export type NotificationRequest = TextNotification | ImageNotification;

export type NotificationFailure = {
  target: NotificationTarget;
  code: NotificationFailureCode;
  deliveryState: NotificationDeliveryState;
  message: string;
  retryAfterSeconds?: number | undefined;
};

export type NotificationFailureCode =
  | "telegram_rejected"
  | "telegram_rate_limited"
  | "telegram_unavailable"
  | "telegram_timeout"
  | "telegram_transport_error";

export type NotificationDeliveryState = "not_delivered" | "unknown";

export type NotificationResult = {
  status: "success" | "partial_failure" | "failure";
  notificationType: NotificationRequest["type"];
  requestedCount: number;
  deliveredCount: number;
  failedCount: number;
  failures: NotificationFailure[];
};
