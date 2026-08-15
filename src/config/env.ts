export type AppEnv = {
  telegramBotToken: string;
  notificationApiToken: string;
  host: string;
  port: number;
  defaultTextNotificationTarget: string | undefined;
};

type EnvSource = Record<string, string | undefined>;

export function parseEnv(source: EnvSource): AppEnv {
  const telegramBotToken = source.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const notificationApiToken = source.NOTIFICATION_API_TOKEN?.trim();
  if (!notificationApiToken) {
    throw new Error("NOTIFICATION_API_TOKEN is required.");
  }

  const port = parseOptionalPort(source.PORT);
  const host = source.HOST?.trim() || "127.0.0.1";

  return {
    telegramBotToken,
    notificationApiToken,
    host,
    port,
    defaultTextNotificationTarget: source.DEFAULT_TEXT_NOTIFICATION_TARGET?.trim() || undefined
  };
}

export function loadEnv(): AppEnv {
  return parseEnv(process.env);
}

function parseOptionalPort(value: string | undefined): number {
  if (!value) {
    return 3000;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return parsed;
}
