import type {
  NotificationFailureCode,
  NotificationDeliveryState
} from "../../domain/notification.ts";
import type { SendPhotoInput, SendTextInput, TelegramClient } from "../../application/ports/telegram-client.ts";

export type { SendPhotoInput, SendTextInput, TelegramClient } from "../../application/ports/telegram-client.ts";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Sleeper = (milliseconds: number) => Promise<void>;

type TelegramBotApiClientOptions = {
  botToken: string;
  fetcher?: Fetcher;
  sleeper?: Sleeper;
  requestTimeoutMs?: number;
  maxRetryAfterSeconds?: number;
};

type TelegramApiResponse = {
  ok: boolean;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
};

export class TelegramApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: number | undefined;
  public readonly code: NotificationFailureCode;
  public readonly deliveryState: NotificationDeliveryState;
  public readonly publicMessage: string;
  public readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    options: {
      statusCode: number;
      errorCode: number | undefined;
      code: NotificationFailureCode;
      deliveryState: NotificationDeliveryState;
      retryAfterSeconds?: number | undefined;
    }
  ) {
    super(message);
    this.name = "TelegramApiError";
    this.statusCode = options.statusCode;
    this.errorCode = options.errorCode;
    this.code = options.code;
    this.deliveryState = options.deliveryState;
    this.publicMessage = message;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class TelegramBotApiClient implements TelegramClient {
  private readonly fetcher: Fetcher;
  private readonly baseUrl: string;
  private readonly sleeper: Sleeper;
  private readonly requestTimeoutMs: number;
  private readonly maxRetryAfterSeconds: number;

  constructor(options: TelegramBotApiClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = `https://api.telegram.org/bot${options.botToken}`;
    this.sleeper = options.sleeper ?? sleep;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 10;
  }

  async sendText(input: SendTextInput): Promise<void> {
    await this.call("sendMessage", {
      chat_id: input.target,
      text: input.text
    });
  }

  async sendPhoto(input: SendPhotoInput): Promise<void> {
    const payload: Record<string, string | number> = {
      chat_id: input.target,
      photo: input.imageUrl
    };

    if (input.caption) {
      payload.caption = input.caption;
    }

    await this.call("sendPhoto", payload);
  }

  private async call(method: string, payload: Record<string, string | number>): Promise<void> {
    let retriedRateLimit = false;

    while (true) {
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}/${method}`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.requestTimeoutMs)
        });
      } catch (error) {
        throw toTransportError(error);
      }

      const body = (await parseJsonSafely(response)) as TelegramApiResponse | undefined;
      if (response.ok && body?.ok) {
        return;
      }

      const retryAfterSeconds = body?.parameters?.retry_after;
      if (
        response.status === 429 &&
        !retriedRateLimit &&
        isRetryableDelay(retryAfterSeconds, this.maxRetryAfterSeconds)
      ) {
        retriedRateLimit = true;
        await this.sleeper(retryAfterSeconds * 1_000);
        continue;
      }

      throw toTelegramApiError(response, body);
    }
  }
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRetryableDelay(value: number | undefined, maximum: number): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= maximum;
}

function toTelegramApiError(response: Response, body: TelegramApiResponse | undefined): TelegramApiError {
  if (response.status === 429) {
    return new TelegramApiError("Telegram rate limit persisted.", {
      statusCode: response.status,
      errorCode: body?.error_code,
      code: "telegram_rate_limited",
      deliveryState: "not_delivered",
      ...(body?.parameters?.retry_after === undefined
        ? {}
        : { retryAfterSeconds: body.parameters.retry_after })
    });
  }

  if (response.status >= 500) {
    return new TelegramApiError("Telegram service unavailable.", {
      statusCode: response.status,
      errorCode: body?.error_code,
      code: "telegram_unavailable",
      deliveryState: "unknown"
    });
  }

  return new TelegramApiError(body?.description ?? "Telegram rejected the notification.", {
    statusCode: response.status,
    errorCode: body?.error_code,
    code: "telegram_rejected",
    deliveryState: "not_delivered"
  });
}

function toTransportError(error: unknown): TelegramApiError {
  const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return new TelegramApiError(isTimeout ? "Telegram request timed out." : "Telegram request failed.", {
    statusCode: 0,
    errorCode: undefined,
    code: isTimeout ? "telegram_timeout" : "telegram_transport_error",
    deliveryState: "unknown"
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
