import { describe, expect, test } from "bun:test";

import { parseEnv } from "../../src/config/env.ts";

describe("parseEnv", () => {
  test("throws when the telegram bot token is missing", () => {
    expect(() => parseEnv({})).toThrow("TELEGRAM_BOT_TOKEN is required.");
  });

  test("throws when the notification API token is missing", () => {
    expect(() => parseEnv({ TELEGRAM_BOT_TOKEN: "token" })).toThrow("NOTIFICATION_API_TOKEN is required.");
  });

  test("parses valid env values and secure defaults", () => {
    expect(
      parseEnv({
        TELEGRAM_BOT_TOKEN: "token",
        PORT: "8026",
        NOTIFICATION_API_TOKEN: "secret",
        DEFAULT_TEXT_NOTIFICATION_TARGET: "123456789"
      })
    ).toEqual({
      telegramBotToken: "token",
      notificationApiToken: "secret",
      host: "127.0.0.1",
      port: 8026,
      defaultTextNotificationTarget: "123456789"
    });
  });

  test("accepts an explicit host and rejects ports outside the TCP range", () => {
    expect(
      parseEnv({
        TELEGRAM_BOT_TOKEN: "token",
        NOTIFICATION_API_TOKEN: "secret",
        HOST: "localhost",
        PORT: "65535"
      }).host
    ).toBe("localhost");

    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: "token",
        NOTIFICATION_API_TOKEN: "secret",
        PORT: "65536"
      })
    ).toThrow("PORT must be an integer between 1 and 65535.");
  });
});
