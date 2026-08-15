import { afterEach, describe, expect, mock, test } from "bun:test";

import { TelegramApiError, TelegramBotApiClient } from "../../src/integrations/telegram/telegram-client.ts";

describe("TelegramBotApiClient", () => {
  afterEach(() => {
    mock.restore();
  });

  test("sends text notifications with the Telegram sendMessage payload", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.telegram.org/bottoken/sendMessage");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        "content-type": "application/json"
      });
      expect(init?.body).toBe(
        JSON.stringify({
          chat_id: "1001",
          text: "hello"
        })
      );
      expect(init?.signal).toBeInstanceOf(AbortSignal);

      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const client = new TelegramBotApiClient({ botToken: "token", fetcher: fetchMock });

    await client.sendText({
      target: "1001",
      text: "hello"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("sends image notifications with the Telegram sendPhoto payload", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBe(
        JSON.stringify({
          chat_id: "1001",
          photo: "https://example.com/chart.png",
          caption: "chart"
        })
      );

      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const client = new TelegramBotApiClient({ botToken: "token", fetcher: fetchMock });

    await client.sendPhoto({
      target: "1001",
      imageUrl: "https://example.com/chart.png",
      caption: "chart"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries one explicit 429 using retry_after", async () => {
    const responses = [
      new Response(JSON.stringify({ ok: false, description: "Too Many Requests", error_code: 429, parameters: { retry_after: 2 } }), {
        status: 429,
        headers: { "content-type": "application/json" }
      }),
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ];
    const fetchMock = mock(async () => responses.shift() as Response);
    const delays: number[] = [];
    const client = new TelegramBotApiClient({
      botToken: "token",
      fetcher: fetchMock,
      sleeper: async (milliseconds) => {
        delays.push(milliseconds);
      }
    });

    await client.sendText({ target: "1001", text: "hello" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
  });

  test("does not retry ambiguous 5xx failures", async () => {
    const fetchMock = mock(async () =>
      new Response("upstream unavailable", {
        status: 503,
        headers: { "content-type": "text/plain" }
      })
    );
    const client = new TelegramBotApiClient({ botToken: "token", fetcher: fetchMock });

    await expect(client.sendText({ target: "1001", text: "hello" })).rejects.toEqual(
      new TelegramApiError("Telegram service unavailable.", {
        statusCode: 503,
        errorCode: undefined,
        code: "telegram_unavailable",
        deliveryState: "unknown"
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("does not retry a 429 whose retry_after exceeds the retry budget", async () => {
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 11 } }), {
        status: 429,
        headers: { "content-type": "application/json" }
      })
    );
    const client = new TelegramBotApiClient({ botToken: "token", fetcher: fetchMock });

    await expect(client.sendText({ target: "1001", text: "hello" })).rejects.toEqual(
      new TelegramApiError("Telegram rate limit persisted.", {
        statusCode: 429,
        errorCode: 429,
        code: "telegram_rate_limited",
        deliveryState: "not_delivered",
        retryAfterSeconds: 11
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("sanitizes timeout failures", async () => {
    const fetchMock = mock(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const client = new TelegramBotApiClient({ botToken: "secret-token", fetcher: fetchMock });

    await expect(client.sendText({ target: "1001", text: "hello" })).rejects.toEqual(
      new TelegramApiError("Telegram request timed out.", {
        statusCode: 0,
        errorCode: undefined,
        code: "telegram_timeout",
        deliveryState: "unknown"
      })
    );
  });

  test("raises a typed error when Telegram rejects a request", async () => {
    const fetchMock = mock(async () => {
      return new Response(JSON.stringify({ ok: false, description: "chat not found" }), {
        status: 400,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const client = new TelegramBotApiClient({ botToken: "token", fetcher: fetchMock });

    await expect(
      client.sendText({
        target: "1001",
        text: "hello"
      })
    ).rejects.toEqual(
      new TelegramApiError("chat not found", {
        statusCode: 400,
        errorCode: undefined,
        code: "telegram_rejected",
        deliveryState: "not_delivered"
      })
    );
  });
});
