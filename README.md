<p align="center">
  <img src="https://cdn.discordapp.com/avatars/1532351525563666533/16ed1c332d9c4f9ee7f029bd86918421.png?size=1024" alt="NexBucket Bot Avatar" width="120">
</p>

<h1 align="center">NexBucket</h1>

<p align="center">
  <strong>A unified Discord bot and web dashboard for moderation, tickets, automation, payments, server monitoring, and community management.</strong>
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

NexBucket combines a multi-server Discord bot with an OAuth2-protected management dashboard. Each guild has isolated configuration backed by Supabase/PostgreSQL, while sensitive credentials and database access remain on the server.

The project uses Node.js ESM, Discord.js 14, Express 5, Supabase, Sharp, and `@napi-rs/canvas`.

## Features

| Area | Highlights |
| --- | --- |
| Tickets | Category-based ticket panels, staff claims, access controls, editing, ratings, password-protected web transcripts, and automatic expiry |
| Moderation | Ban, temporary ban, kick, timeout, mute, warnings, anti-spam, anti-link, anti-raid, banned words, and threshold-based auto-ban |
| Learn manager | Text, image, or mixed automatic responses; dashboard search, preview, duplicate warnings, enable/disable state, metadata, and Administrator-only CRUD |
| AI tools | Claude chat integration and a local SWE-bench Verified AI coding leaderboard rendered as a chart |
| Network tools | RDAP-powered WHOIS summaries, DNS records, public IP/domain availability checks, ISP/location metadata, and private-network protection |
| Minecraft | Java server ping, SRV resolution, MOTD rendering, favicon support, local backgrounds, caching, and Discord-ready status banners |
| Community | Welcome/goodbye cards, auto-role, Join-to-Create rooms, giveaways, reminders, AFK status, statistics channels, and backups |
| Payments | VietQR, PayOS payment links and signed callbacks, Card2K top-ups, encrypted provider credentials, and status polling |
| Dashboard | Discord OAuth2, per-guild authorization, dark/light themes, configuration APIs, activity views, owner administration, and public service status |

## Command highlights

| Command | Purpose |
| --- | --- |
| `/ticket` | Configure and publish the ticket system |
| `/dns whois domain:<domain>` | Show concise registration and essential DNS information |
| `/check ip-domain:<target>` | Check a public IP/domain, HTTP/HTTPS availability, latency, ISP, and location |
| `/aimodel` | Render the local SWE-bench Verified AI coding leaderboard |
| `/avatar` | Show avatar, decoration, banner, and direct asset links |
| `/mcserver` | Query a Minecraft server and render its status banner |
| `/giveaway` | Start, edit, end, or reroll giveaways |
| `/setup-welcome`, `/setup-goodbye` | Configure member arrival and departure cards |
| `/setup-jtc` | Configure temporary Join-to-Create voice rooms |
| `/qrbank`, `/setup-card` | Configure payment and card top-up workflows |
| `/status`, `/setup-serverstats` | Monitor services and publish live guild statistics |

Run `/help` and `/botguide` in Discord for the complete command list. Administrative commands still enforce their Discord permission requirements.

## Architecture

```text
index.js                         Composition root
   |
   +-- src/runtime/              Startup, scheduled jobs, event registration
   +-- src/events/               Discord interaction, message, guild, and member routing
   |      |
   |      +-- feature modules    Tickets, moderation, welcome, JTC, payments, status
   |      +-- src/network/       RDAP, DNS, and safe availability checks
   |
   +-- src/dashboard/server.js   Express, OAuth2, sessions, APIs, callbacks
          |
          +-- Supabase/PostgreSQL
          +-- Discord API and guild cache
```

### Project structure

```text
NexBucket/
├── index.js                     Bot entrypoint and dependency wiring
├── src/
│   ├── runtime/                 Startup jobs and event registration
│   ├── events/                  Discord event handlers and routing
│   ├── network/                 DNS, RDAP, IP metadata, and availability checks
│   ├── dashboard/               Express server and browser interface
│   ├── database/                Supabase client, schema, migrations, and settings
│   ├── ticket/                  Ticket commands, components, and transcripts
│   ├── moderation/              Moderation and automatic protection
│   ├── status/                  Minecraft and service monitoring
│   ├── banking/                 VietQR, PayOS, and Card2K integrations
│   ├── welcome/                 Welcome/goodbye cards and auto-role
│   ├── giveaway/                Giveaway lifecycle
│   ├── utils/                   Shared utilities and community features
│   └── test/                    Central Node.js test suite
├── scripts/                     Asset preparation scripts
├── assets/                      Runtime images and optional banner backgrounds
├── .env.example                 Environment template
├── LICENSE
└── NOTICE.md
```

## Requirements

- Node.js 24 or newer
- npm
- A Discord application and bot token
- A Supabase project with a backend `service_role` key
- A PostgreSQL session or transaction pooler URL for migrations
- An HTTPS origin for the production dashboard and OAuth callback

## Quick start

```bash
git clone https://github.com/Elaina2026/NexBucket.git
cd NexBucket
npm install
npm run assets:prepare
cp .env.example .env
```

Windows users can copy `.env.example` to `.env` manually. Fill in the required credentials, then validate and start the project:

```bash
npm test
npm run dev
```

Production mode:

```bash
npm start
```

## Discord application setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create its bot user and enable **Server Members Intent**, **Presence Intent**, and **Message Content Intent**. Presence Intent is required for JTC's Game action.
3. Set `DISCORD_TOKEN`, `CLIENT_ID`, and `CLIENT_SECRET` in `.env`.
4. Add the production OAuth2 redirect URL:

```text
https://your-domain.example/api/auth/callback
```

For local development:

```text
http://localhost:3000/api/auth/callback
```

The dashboard only exposes guilds where the signed-in user has Administrator or Manage Server permission and the bot is present. Learn management requires Discord Administrator permission.

## Join-to-Create voice rooms

Run `/setup-jtc`, then select the temporary-room category and LFM text channel in the server dashboard. Room owners receive Discord-native controls for name, limit, status, current game, LFM posts, bitrate, region, native text chat, NSFW, claim, lock, permit/reject, invite, visibility, and ownership transfer.

**Save Current** stores the room as the member's private profile for that server. **Load Settings** applies it to an active room. **Dashboard** opens `/jtc/:guildId`, where any authenticated guild member can edit only their own profile; it does not grant access to server administration.

Grant the bot View Channels, Manage Channels, Create Invite, Move Members, Manage Roles, Send Messages, and Embed Links. Enable Presence Intent for automatic Game naming. When an owner leaves, ownership transfers to another non-bot member; the room is deleted only after it becomes empty.

## Supabase and migrations

Configure the backend service-role client and PostgreSQL poolers:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-backend-service-role-key
DATABASE_URL=postgresql://postgres.your-project-id:ENCODED_PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.your-project-id:ENCODED_PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres
```

`SUPABASE_KEY` is backend-only. Never expose it to browser code, commit it, or substitute it with a public client key.

Startup applies the canonical schema and pending files from `src/database/migrations/`. Applied migrations are recorded in `schema_migrations`; `DIRECT_URL` is preferred over `DATABASE_URL`.

Before applying migrations to an existing deployment:

1. Back up PostgreSQL.
2. Verify the migration on staging.
3. Inspect application logs and query behavior.
4. Approve the production rollout separately.

Use `src/database/security_policies.sql` in the Supabase SQL Editor when RLS policies need reconciliation.

## Environment variables

See `.env.example` for the deployment template.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `CLIENT_ID` | Yes | Discord application and OAuth client ID |
| `CLIENT_SECRET` | Yes | Discord OAuth2 client secret |
| `BOT_OWNER_ID` | Recommended | Owner-only bot and dashboard access |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Backend-only Supabase service-role key |
| `DATABASE_URL` | Yes | Runtime PostgreSQL pooler and migration fallback |
| `DIRECT_URL` | Recommended | PostgreSQL session pooler for migrations |
| `ENCRYPTION_SECRET` | Yes | AES-256-GCM key source for stored OAuth/payment secrets |
| `ANTHROPIC_API_KEY` | Optional | Enables Claude chat requests; not required for the local `/aimodel` leaderboard |
| `DASHBOARD_PORT` | No | Express port; defaults to `3000` |
| `DASHBOARD_URL` | Production | Exact public dashboard origin; use HTTPS |
| `UPDATE_INTERVAL` | No | Minecraft status refresh interval in milliseconds |
| `GUILD_SETTINGS_CACHE_MS` | No | Per-guild settings cache lifetime |
| `MINECRAFT_CONFIG_CACHE_MS` | No | Tracked Minecraft server cache lifetime |
| `DEBUG_WEBHOOKS` | No | Card2K diagnostics; keep disabled in production |

Do not change `ENCRYPTION_SECRET` after encrypted data exists unless existing ciphertext has been migrated. Losing this value makes saved OAuth, PayOS, and Card2K credentials unreadable.

## Minecraft banner assets

Prepare verified assets once per deployment:

```bash
npm run assets:prepare
```

Relevant options are documented in `.env.example`. Place optional PNG, JPEG, or WebP backgrounds in `assets/banners/`.

Keep `MC_BANNER_ALLOW_PRIVATE_HOSTS=false` on public deployments. Enabling it permits connections to private/LAN targets and should only be used in explicitly trusted environments.

## Security notes

- Serve the dashboard through HTTPS and set `DASHBOARD_URL` to the exact public origin.
- Keep Discord, Supabase, PostgreSQL, Anthropic, PayOS, Card2K, and encryption secrets on the backend.
- Preserve OAuth state validation, HttpOnly/SameSite cookies, origin checks, CSP, HSTS, frame denial, and MIME sniffing protection.
- Verify payment signatures before changing transaction state.
- Never log card codes, serials, signatures, access tokens, or provider secrets.
- Keep `DEBUG_WEBHOOKS=0` in production.
- Keep public network checks restricted to public addresses; localhost, private, link-local, and reserved ranges are blocked.
- Back up data before migrations or restore operations. Restore is intentionally destructive and requires confirmation.

The image proxy accepts HTTPS images only from an explicit allowlist, blocks redirects, and limits response type and size. Learn uploads validate declared MIME type, decoded format, file size, and dimensions before storage.

## Testing

The complete Node.js test suite lives in `src/test/`:

```bash
npm test
```

Tests cover dashboard security helpers, payments, moderation, Learn entries and image validation, network input/SSRF boundaries, command embeds, Minecraft resolution/rendering, AI leaderboards, welcome cards, and shared utilities. Network tests use injected dependencies and do not require live Internet access.

## Troubleshooting

### OAuth callback fails

- Confirm `DASHBOARD_URL` exactly matches the Discord redirect origin.
- Confirm the callback path is `/api/auth/callback`.
- Check `CLIENT_ID`, `CLIENT_SECRET`, reverse-proxy forwarding, HTTPS, and cookie settings.

### Database is unavailable or slow

- Check the Supabase project and pooler credentials.
- URL-encode special characters in PostgreSQL passwords.
- Inspect Supabase Observability or `pg_stat_statements` before increasing polling frequency.

### Minecraft banner assets are missing

```bash
npm run assets:prepare
```

Then verify that `MC_BANNER_ASSET_DIR` is persistent and readable by the bot.

### Saved secrets cannot be decrypted

Restore the original `ENCRYPTION_SECRET`. For an intentional rotation, migrate existing ciphertext before removing the old key.

## Contributors

- **Elaina2026** — Management and Synthesis
- **Claude** — Core Coding and Implementation
- **Codex** — Analysis and Bug Finding
- **Gemini** — Sub-agent Operations and Task Support

## License and notices

Created and maintained by **Elaina2026**.

NexBucket is licensed under [Creative Commons Attribution-NonCommercial 4.0 International](LICENSE).

The Minecraft banner integration has separate dual-license permission for use in NexBucket and retains upstream attribution. See [NOTICE.md](NOTICE.md). Third-party dependencies and downloaded Mojang assets retain their respective terms and trademarks.
