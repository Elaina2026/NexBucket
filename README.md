### NexBucket

<p align="center">
  <strong>Discord server management, payments, moderation, tickets, Minecraft status, and automation in one Node.js bot.</strong>
</p>

<p align="center">
  <a href="https://github.com/Elaina2026/NexBucket"><img alt="Repository" src="https://img.shields.io/badge/GitHub-Elaina2026%2FNexBucket-181717?logo=github"></a>
  <a href="https://nodejs.org/"><img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white"></a>
  <a href="https://discord.js.org/"><img alt="Discord.js 14" src="https://img.shields.io/badge/discord.js-14-5865F2?logo=discord&logoColor=white"></a>
  <a href="https://supabase.com/"><img alt="Supabase" src="https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?logo=supabase&logoColor=white"></a>
  <a href="https://expressjs.com/"><img alt="Express 5" src="https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-CC--BY--NC--4.0-ef9421?logo=creativecommons&logoColor=white"></a>
</p>

## Overview

NexBucket is a multi-server Discord bot and web dashboard. Each Discord server has isolated configuration stored in Supabase. Discord OAuth2 controls dashboard access, while the backend service-role client performs database operations.

### Main capabilities

| Module | Capabilities |
| --- | --- |
| Tickets | Category-based tickets, staff claims, editing, access control, password-protected web transcripts, automatic expiry |
| Moderation | Warn, mute, hard mute, temporary ban, ban list, anti-spam, anti-raid, anti-link, banned words, warning-threshold auto-ban |
| Welcome | Welcome and goodbye cards, custom backgrounds and messages, auto-role |
| Voice JTC | Join-to-Create hubs, temporary rooms, user limits, bitrate, locking, personal room profiles |
| Payments | VietQR, PayOS payment links and signed webhooks, Card2K top-ups and polling |
| Minecraft | Java server ping, MOTD/font rendering, favicon fallback, local backgrounds, cached Discord status banners |
| Server tools | Giveaways, reminders, AFK, autoresponder, statistics channels, backups, blacklist and bot whitelist |
| Dashboard | Discord OAuth2, per-guild permission checks, bilingual UI, public service status, owner-only administration |

## Architecture

```text
Discord events / commands
          |
          v
       index.js
          |
   +------+------+----------------+----------------+
   |             |                |                |
Tickets      Moderation       Utilities        Status
   |             |                |                |
   +-------------+-------+--------+----------------+
                         |
                  guildSettings.js
                         |
               Supabase / PostgreSQL

Browser --> Express dashboard --> Discord OAuth2
                |       |
                |       +--> Discord API and guild cache
                +----------> backend-only Supabase client
```

Important paths:

- `index.js` — process startup, Discord event routing, command registration, periodic jobs.
- `src/dashboard/server.js` — Express dashboard, OAuth2, sessions, APIs, payment callbacks.
- `src/database/` — Supabase client, canonical schema, migrations, guild settings cache.
- `src/ticket/`, `src/moderation/`, `src/welcome/`, `src/giveaway/` — Discord modules.
- `src/status/` — Minecraft status, server statistics, renderer adapter.
- `src/utils/` — JTC, backups, reminders, permissions, logging and shared features.
- `assets/banners/` — optional local Minecraft banner backgrounds.

## Requirements

- Node.js 24 or newer.
- npm.
- Discord application and bot token.
- Supabase project with a backend `service_role` key.
- PostgreSQL session or transaction pooler URL for schema migrations.
- HTTPS domain for production dashboard and OAuth callback.

## Installation

```bash
git clone https://github.com/Elaina2026/NexBucket.git
cd NexBucket
npm install
npm run assets:prepare
```

Create the environment file:

```bash
cp .env.example .env
```

Windows users can copy `.env.example` to `.env` manually.

Start development mode:

```bash
npm run dev
```

Start production mode:

```bash
npm start
```

Run tests:

```bash
npm test
```

## Discord application setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a bot and enable the gateway intents required by the enabled modules.
3. Copy the bot token to `DISCORD_TOKEN`.
4. Copy the application ID to `CLIENT_ID`.
5. Copy the OAuth2 client secret to `CLIENT_SECRET`.
6. Set the OAuth2 redirect URL to:

```text
https://your-domain.example/api/auth/callback
```

For local development:

```text
http://localhost:3000/api/auth/callback
```

The dashboard only displays servers where the user has Administrator or Manage Server permission and the bot is present.

## Supabase setup

Set these values in `.env`:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-backend-service-role-key

# Runtime transaction pooler
DATABASE_URL=postgresql://postgres.your-project-id:ENCODED_PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true

# Migration session pooler, preferred
DIRECT_URL=postgresql://postgres.your-project-id:ENCODED_PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres
```

`SUPABASE_KEY` must never be sent to browser code, committed, or used as a public `anon` key. Runtime table access is backend-only; Row Level Security is enabled by the canonical schema.

Special characters in PostgreSQL passwords must be URL-encoded:

| Character | Encoding |
| --- | --- |
| `/` | `%2F` |
| `@` | `%40` |
| `:` | `%3A` |
| `#` | `%23` |
| `%` | `%25` |

### Schema and migrations

Startup executes the canonical schema and pending files from `src/database/migrations/`. Applied migrations are recorded in `schema_migrations`; `DIRECT_URL` is preferred over `DATABASE_URL`.

Before applying migrations to an existing database:

1. Back up PostgreSQL.
2. Apply and verify on staging.
3. Inspect query plans and application logs.
4. Approve the production rollout separately.

The repository contains migration SQL only. Its presence does not mean it has been applied to production.

Use `src/database/security_policies.sql` in the Supabase SQL Editor when RLS policies need reconciliation.

## Environment variables

See `.env.example` for the complete template.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `CLIENT_ID` | Yes | Discord application ID and OAuth client ID |
| `CLIENT_SECRET` | Yes | Discord OAuth2 client secret |
| `BOT_OWNER_ID` | Recommended | Owner-only dashboard and administrative access |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Backend-only Supabase service-role key |
| `DATABASE_URL` | Yes | Runtime PostgreSQL pooler and migration fallback |
| `DIRECT_URL` | Recommended | PostgreSQL session pooler for migrations |
| `ENCRYPTION_SECRET` | Yes | AES-256-GCM key source for OAuth and payment secrets |
| `DASHBOARD_PORT` | No | Express port; defaults to `3000` |
| `DASHBOARD_URL` | Production | Canonical dashboard origin; use HTTPS in production |
| `UPDATE_INTERVAL` | No | Minecraft message refresh interval in milliseconds |
| `GUILD_SETTINGS_CACHE_MS` | No | Short per-guild settings cache lifetime |
| `MINECRAFT_CONFIG_CACHE_MS` | No | Minecraft tracked-server cache lifetime |
| `TOPGG_TOKEN` | No | Top.gg lookup used by automatic bot verification |
| `DEBUG_WEBHOOKS` | No | Card2K debugging; keep `0` in production |

Do not change `ENCRYPTION_SECRET` after encrypted data exists unless existing ciphertext has been migrated. Changing it makes saved OAuth, PayOS, and Card2K secrets unreadable.

## Minecraft banner renderer

Prepare verified Minecraft assets once per deployment:

```bash
npm run assets:prepare
```

Relevant configuration:

```env
MC_BANNER_ASSET_DIR=MCServerBanner/node-assets
MINECRAFT_ASSET_VERSION=1.21.10
MC_BANNER_CACHE_SECONDS=300
MC_BANNER_MAX_CACHE_ENTRIES=300
MC_BANNER_CONNECT_TIMEOUT_MS=4000
MC_BANNER_READ_TIMEOUT_MS=5000
MC_BANNER_MAX_CONCURRENT_RENDERS=1
MC_BANNER_ALLOW_PRIVATE_HOSTS=false
MC_BANNER_STRIP_PRIVATE_GLYPHS=true
```

Place optional PNG/JPEG/WebP backgrounds in `assets/banners/`. Selection is stable per server. Missing or offline favicons fall back to `assets/unknown_server.png`.

Keep `MC_BANNER_ALLOW_PRIVATE_HOSTS=false` on public deployments. Enabling it allows the bot to connect to private/LAN targets and should only be used for explicitly trusted servers.

## Dashboard and API security

Production checklist:

- Serve only through HTTPS and set `DASHBOARD_URL` to the exact public origin.
- Keep Discord, Supabase, PostgreSQL, OAuth, PayOS, Card2K and encryption secrets backend-only.
- Restrict proxy trust to the deployment topology; the app currently expects one trusted reverse proxy.
- Keep OAuth state, HttpOnly session cookies, SameSite cookies and origin checks enabled.
- Verify PayOS and Card2K signatures before state changes.
- Never log card codes, card serials, webhook signatures or payment secrets.
- Keep `DEBUG_WEBHOOKS=0` in production.
- Rotate exposed secrets immediately.
- Review owner-only incidents, activities, sessions and security logs through authenticated admin routes.
- Back up data before restore or migration operations. Restore remains intentionally destructive and requires confirmation.

Security headers include CSP, HSTS on HTTPS, frame denial, MIME sniffing protection, referrer policy and restrictive permissions policy. The image proxy accepts HTTPS images only from an explicit allowlist, blocks redirects and limits response type and size.

## Performance notes

NexBucket reduces Supabase load with:

- short TTL caches and concurrent-read coalescing for guild settings;
- one bulk uptime insert per cycle;
- one grouped uptime history query per cache window;
- due-only giveaway and reminder queries;
- adaptive Card2K polling backoff;
- bounded transcript, incident and activity queries;
- Minecraft render caching, pending-render deduplication and concurrency limits;
- optimistic guild configuration writes through versioned PostgreSQL RPC.

Measure real production results with Supabase Observability or `pg_stat_statements`; do not infer production CPU changes from local code alone.

## Troubleshooting

### OAuth callback fails

- Confirm `DASHBOARD_URL` exactly matches the configured Discord redirect origin.
- Confirm the redirect path is `/api/auth/callback`.
- Check `CLIENT_ID`, `CLIENT_SECRET`, HTTPS proxy forwarding and cookie settings.

### Database is paused or slow

- Check Supabase project state and API latency.
- Verify pooler credentials and URL-encoded password characters.
- Inspect `pg_stat_statements` and indexes before increasing polling frequency.
- Keep settings and uptime caches enabled.

### Minecraft banner assets are missing

```bash
npm run assets:prepare
```

Then verify `MC_BANNER_ASSET_DIR` is persistent and writable in the deployment environment.

### Saved secrets cannot be decrypted

Restore the original `ENCRYPTION_SECRET`. If the key was intentionally rotated, migrate existing ciphertext before removing the old key.

### Payment callback is rejected

- Verify the provider callback URL uses HTTPS.
- Confirm the saved per-guild PayOS or Card2K credentials.
- Check transaction order code, amount and callback signature.
- Do not enable secret-bearing request logs in production.

## License and notices

NexBucket is licensed under [Creative Commons Attribution-NonCommercial 4.0 International](LICENSE).

The Minecraft banner integration has separate dual-license permission for use in NexBucket and carries upstream attribution. See [NOTICE.md](NOTICE.md). Third-party dependencies and downloaded Mojang assets retain their respective terms and trademarks.
