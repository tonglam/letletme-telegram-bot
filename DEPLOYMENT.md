# Deployment Guide

## Server layout

The service is intended to run on the same VPS as its current caller and bind only to loopback:

```text
/home/workspace/letletme-telegram-bot
├── current -> releases/<commit-sha>
├── releases/<commit-sha>/dist
├── releases/<commit-sha>/scripts
├── logs/console.log
├── run/letletme-telegram-bot.pid
└── .env
```

The deployment user needs Bun 1.2.12 (or the exact version required by `package.json`) and `curl`. Create the shared directories once:

```bash
mkdir -p /home/workspace/letletme-telegram-bot/{releases,logs,run}
```

Do not open port 8026 to the public internet. Verify the effective listener after deployment:

```bash
ss -ltnp | grep ':8026'
```

It must show `127.0.0.1:8026` (or the explicitly configured loopback host).

## Environment

Create `/home/workspace/letletme-telegram-bot/.env` with mode `600`:

```bash
TELEGRAM_BOT_TOKEN=***
NOTIFICATION_API_TOKEN=***
HOST=127.0.0.1
PORT=8026
DEFAULT_TEXT_NOTIFICATION_TARGET=<chat-id>
BUN_CMD=/home/deploy/.bun/bin/bun
```

Before enabling the required API token, update every same-VPS caller to send:

```http
Authorization: Bearer <NOTIFICATION_API_TOKEN>
```

Back up `.env`, the current symlink target, and the current commit before the first hardened deployment.

## Runtime scripts

- `./scripts/start.sh` loads `.env`, starts the current release, and waits up to 10 seconds for `/healthz`.
- `./scripts/stop.sh` sends SIGTERM, waits up to 35 seconds for graceful draining, then uses SIGKILL only as a last resort.
- `./scripts/rerun.sh` performs a stop/start cycle.
- `./scripts/healthcheck.sh` checks the local health endpoint.
- `./scripts/monitor.sh [-f]` reports PID and health state and optionally tails the console log.

## Log rotation

After the application release is healthy, the deployment workflow connects as the privileged `tong` account, installs logrotate when missing, installs [deploy/logrotate/letletme-telegram-bot](./deploy/logrotate/letletme-telegram-bot) as `/etc/logrotate.d/letletme-telegram-bot`, and runs a dry-run validation. The regular deployment account only needs to own the application directories; `tong` must be root or have passwordless sudo/doas for this one-time system configuration:

```bash
sudo install -m 0644 current/deploy/logrotate/letletme-telegram-bot /etc/logrotate.d/letletme-telegram-bot
sudo logrotate -d /etc/logrotate.d/letletme-telegram-bot
```

The policy rotates daily or before 20 MB, keeps 14 rotated files (with the newest compressed on the next cycle because of `delaycompress`), and uses `copytruncate` so the Bun process does not need a restart.

## GitHub Actions secrets

Configure these repository secrets:

```text
DEPLOY_HOST=<deployment host>
DEPLOY_USERNAME=<deployment user>
DEPLOY_SSH_KEY=<deployment private key>
DEPLOY_TONG_USERNAME=tong
DEPLOY_TONG_SSH_KEY=<private key authorized for tong>
NOTIFICATION_API_TOKEN=<high-entropy bearer token>
```

The workflow backs up `.env` and synchronizes `NOTIFICATION_API_TOKEN` from the repository secret before starting the release. Keep the same value in every same-VPS caller. The workflow runs tests, typecheck, build, shellcheck, and actionlint on every branch. Only `main` deploys. Each deployment is unpacked into a commit-named release, health-checked, and retained with the previous releases.

## Rollback

The deploy step automatically restores the previous `current` symlink and restarts it when the new release fails startup or health checks. For a manual rollback:

```bash
cd /home/workspace/letletme-telegram-bot
readlink current
ln -sfn releases/<known-good-commit> current
APP_HOME="$PWD" CURRENT_LINK="$PWD/current" current/scripts/rerun.sh
current/scripts/healthcheck.sh
```

After deployment, verify the caller's authenticated request, `/healthz`, the loopback listener, and `./scripts/monitor.sh` before considering the release complete.
