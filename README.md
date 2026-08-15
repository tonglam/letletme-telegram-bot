# letletme-telegram-bot

`letletme-telegram-bot` is a Bun + TypeScript + Elysia notification service. Other systems call one authenticated HTTP endpoint, and the service forwards text or image notifications through the Telegram Bot API.

## Current role

- `POST /telegramBot/letletme/notification` sends text or image notifications.
- Text is prefixed as `[letletme-telegram-bot] <content>`.
- Text may omit `targets` only when `DEFAULT_TEXT_NOTIFICATION_TARGET` is configured.
- The service is intentionally stateless and does not implement commands, polling, queues, Redis, or idempotency storage.

## API

### Notification endpoint

```http
POST /telegramBot/letletme/notification
Content-Type: application/json
Authorization: Bearer <NOTIFICATION_API_TOKEN>
X-Request-ID: optional-client-id
```

Text requests accept up to 50 targets and 4072 characters. Image requests accept up to 50 targets, an HTTP(S) image URL, and a caption up to 1024 characters.

```json
{
  "type": "text",
  "text": "deployment finished",
  "targets": ["<chat-id>"]
}
```

When `targets` is omitted, the service uses `DEFAULT_TEXT_NOTIFICATION_TARGET`:

```json
{
  "type": "text",
  "text": "deployment finished"
}
```

Image example:

```json
{
  "type": "image",
  "imageUrl": "https://example.com/chart.png",
  "caption": "daily update",
  "targets": ["<chat-id>"]
}
```

Successful processing returns HTTP 200 with per-target delivery results:

```json
{
  "status": "success",
  "notificationType": "text",
  "requestedCount": 1,
  "deliveredCount": 1,
  "failedCount": 0,
  "failures": []
}
```

`status` is `success`, `partial_failure`, or `failure`. Delivery outcomes remain HTTP 200 so callers do not retry an entire batch and duplicate targets that already succeeded. Retry only failures whose delivery state is known to be `not_delivered`; `unknown` means the transport outcome is ambiguous.

Missing/invalid bearer tokens return `401`. Invalid payloads and a text request with neither targets nor a configured default return `422` with a stable `code`.

### Health endpoint

```http
GET /healthz
```

Returns `200 {"status":"ok"}` and does not call Telegram. It is intended for local deployment and monitoring checks.

## Environment

Required:

```bash
TELEGRAM_BOT_TOKEN=...
NOTIFICATION_API_TOKEN=...
```

Optional:

```bash
HOST=127.0.0.1
PORT=8026
DEFAULT_TEXT_NOTIFICATION_TARGET=<chat-id>
BUN_CMD=/home/deploy/.bun/bin/bun
```

The default host is loopback. Keep it that way when callers run on the same VPS; use a separately secured TLS proxy or tunnel before exposing the service to another machine.

## Local development

```bash
bun install
bun run dev
bun test
bun run typecheck
bun run build
```

## Deployment

The repository includes:

- `scripts/start.sh`, `stop.sh`, `rerun.sh`, `monitor.sh`, `healthcheck.sh`
- `.github/workflows/ci-cd.yml`
- `deploy/logrotate/letletme-telegram-bot`

Deployments unpack into `releases/<commit-sha>` and switch the `current` symlink only after the release is validated. A failed health check restores the previous release. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the VPS layout, env file, caller migration, and rollback procedure.

## Deferred scope

- Bot commands and polling runtime
- Redis-backed fan-out or a message queue
- Durable audit records and idempotency keys
- OpenAI/FPL integrations
