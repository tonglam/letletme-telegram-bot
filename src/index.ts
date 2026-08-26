import { NotificationService } from "./application/services/notification-service.ts";
import { loadEnv } from "./config/env.ts";
import { createApp } from "./http/create-app.ts";
import { TelegramBotApiClient } from "./integrations/telegram/telegram-client.ts";
import { installGracefulShutdown } from "./runtime/shutdown.ts";

const env = loadEnv();

const telegramClient = new TelegramBotApiClient({
  botToken: env.telegramBotToken
});

const notificationService = new NotificationService(telegramClient, {
  defaultTextTarget: env.defaultTextNotificationTarget,
  configReady: Boolean(env.telegramBotToken && env.notificationApiToken),
  release: process.env.LETLETME_RELEASE_SHA?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "unknown"
});

const app = createApp({
  notificationService,
  apiToken: env.notificationApiToken
});

app.listen({
  hostname: env.host,
  port: env.port,
  maxRequestBodySize: 64 * 1024
});
installGracefulShutdown(app);

console.log(
  JSON.stringify({
    event: "service_started",
    timestamp: new Date().toISOString(),
    service: "letletme-telegram-bot",
    host: env.host,
    port: env.port
  })
);
