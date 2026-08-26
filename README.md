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
  <a href="https://turso.tech/"><img alt="Turso" src="https://img.shields.io/badge/Turso-libSQL-4FF8D2"></a>
  <a href="https://expressjs.com/"><img alt="Express 5" src="https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-CC--BY--NC--4.0-ef9421?logo=creativecommons&logoColor=white"></a>
</p>

## Overview

NexBucket combines a multi-server Discord bot with an OAuth2-protected management dashboard. Turso/libSQL stores guild-isolated structured data. Persistent local storage holds Learn images and videos. Credentials and data APIs remain server-side.

Stack: Node.js ESM, Discord.js 14, Express 5, Turso/libSQL, local filesystem storage, Sharp, and `@napi-rs/canvas`.

## Features

| Area | Highlights |
| --- | --- |
| Tickets | Category-based ticket panels, staff claims, access controls, editing, ratings, password-protected web transcripts, and automatic expiry |
| Moderation | Ban, temporary ban, kick, timeout, mute, warnings, anti-spam, anti-link, anti-raid, banned words, and threshold-based auto-ban |
| Learn manager | Text, image, video, or mixed automatic responses; dashboard search, preview, duplicate warnings, enable/disable state, metadata, and Administrator-only CRUD |
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
| `/avatar` | Show avatar, decoration, banner, and direct asset links |
| `/mcserver` | Query a Minecraft server and render its status banner |
| `/giveaway` | Start, edit, end, or reroll giveaways |
| `/setup-welcome`, `/setup-goodbye` | Configure member arrival and departure cards |
| `/setup-jtc` | Configure temporary Join-to-Create voice rooms |
| `/qrbank`, `/setup-card` | Configure payment and card top-up workflows |
| `/status`, `/setup-serverstats` | Monitor services and publish live guild statistics |

Run `/help` and `/botguide` in Discord for full command list. Discord permission checks remain enforced.

## Architecture

```text
index.js                         Composition root
   |
   +-- src/runtime/              Startup, jobs, event registration
   +-- src/events/               Discord routing
   |      |
   |      +-- feature modules    Tickets, moderation, welcome, JTC, payments, status
   |      +-- src/network/       RDAP, DNS, safe availability checks
   |
   +-- src/dashboard/server.js   Express, OAuth2, sessions, APIs, callbacks
          |
          +-- Turso/libSQL       Structured data and transcripts
          +-- Local media        Learn images and videos
          +-- Discord API and guild cache
```

```text
NexBucket/
├── index.js
├── src/
│   ├── runtime/
│   ├── events/
│   ├── network/
│   ├── dashboard/
│   ├── database/                libSQL client, schema, migrations, settings
│   ├── storage/                 Persistent local media adapter
│   ├── ticket/
│   ├── moderation/
│   ├── status/
│   ├── banking/
│   ├── welcome/
│   ├── giveaway/
│   ├── utils/
│   └── test/
├── scripts/migrate/             Supabase-to-Turso/local migration tooling
├── assets/
├── .env.example
├── LICENSE
└── NOTICE.md
```

## Requirements

- Node.js 24 or newer
- npm
- Discord application and bot token
- Turso database and private auth token
- Persistent writable volume for `LOCAL_MEDIA_DIR` in production
- HTTPS dashboard origin in production

PostgreSQL and Supabase credentials are needed only for one-time migration from an existing deployment.

## Quick start

```bash
git clone https://github.com/Elaina2026/NexBucket.git
cd NexBucket
npm install
npm run assets:prepare
cp .env.example .env
npm test
npm run dev
```

Production:

```bash
npm start
```

## Discord application setup

1. Create application in [Discord Developer Portal](https://discord.com/developers/applications).
2. Create bot user. Enable **Server Members Intent**, **Presence Intent**, and **Message Content Intent**. Presence Intent supports JTC Game action.
3. Set `DISCORD_TOKEN`, `CLIENT_ID`, and `CLIENT_SECRET`.
4. Add callback URL:

```text
https://your-domain.example/api/auth/callback
```

Local callback:

```text
http://localhost:3000/api/auth/callback
```

Dashboard exposes only guilds where signed-in user has Administrator or Manage Server permission and bot is present. Learn management requires Administrator permission.

## Turso and local media

Runtime configuration:

```env
TURSO_DATABASE_URL=libsql://your-database-your-org.turso.io
TURSO_AUTH_TOKEN=your-private-token
LOCAL_MEDIA_DIR=data/media
```

Keep Turso credentials backend-only. Runtime applies ordered SQL under `src/database/libsql/`; `schema_migrations` records applied versions. `LOCAL_MEDIA_DIR` defaults to `data/media`. Production must mount it on persistent writable storage and back up it with Turso data; ephemeral container filesystems lose uploaded media after redeploy.

## Existing Supabase migration

Migration tooling supports `dry-run`, `apply`, and strict `verify` for all active tables plus every object in source `learn-images` bucket.

Migration-only credentials:

```env
SOURCE_DATABASE_URL=postgresql://...
SOURCE_SUPABASE_URL=https://your-project.supabase.co
SOURCE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SOURCE_SUPABASE_BUCKET=learn-images
```

Run only during planned migration:

```bash
npm run migrate:data -- dry-run all
npm run migrate:data -- apply all
npm run migrate:data -- verify all
```

Database import pages by deterministic primary key, upserts resumably, rewrites Learn entries to local `/media/...` URLs, preserves explicit IDs, and checks canonical SHA-256 hashes, row counts, `PRAGMA integrity_check`, foreign keys, and SQLite sequences. Object import writes atomically under `LOCAL_MEDIA_DIR`, preserves every source key, skips exact byte/hash matches, and verifies missing, extra, size, and checksum drift. Reports contain keys, counts, and hashes, not row contents.

Production cutover:

1. Provision empty staging Turso database and persistent `LOCAL_MEDIA_DIR`, then run `dry-run`.
2. Test new runtime against staging.
3. Stop every production bot/dashboard instance to freeze writes.
4. Run final `apply`, then `verify`; do not start new runtime if any check fails.
5. Switch runtime secrets, start one instance, test Discord events, dashboard, payments, jobs, transcripts, Learn images, and health.
6. Keep old Supabase resources intact and read-only through retention window. Delete them only after separate confirmation.

Rollback before new runtime accepts writes: restart previous release with untouched Supabase credentials. Rollback after Turso accepts writes needs explicit reconciliation; one-time import does not provide dual writes.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `CLIENT_ID` | Yes | Discord application and OAuth client ID |
| `CLIENT_SECRET` | Yes | Discord OAuth2 client secret |
| `BOT_OWNER_ID` | Recommended | Owner-only bot and dashboard access |
| `TURSO_DATABASE_URL` | Yes | Runtime libSQL database URL |
| `TURSO_AUTH_TOKEN` | Cloud Turso | Private runtime database token |
| `LOCAL_MEDIA_DIR` | Production media | Persistent writable directory; defaults to `data/media` |
| `SOURCE_SUPABASE_BUCKET` | Migration only | Source media bucket; defaults to `learn-images` |
| `SOURCE_DATABASE_URL` | Migration only | Source PostgreSQL connection |
| `SOURCE_SUPABASE_URL` | Migration only | Source Storage API URL |
| `SOURCE_SUPABASE_SERVICE_ROLE_KEY` | Migration only | Source Storage service-role key |
| `ENCRYPTION_SECRET` | Yes | AES-256-GCM key source for OAuth/payment secrets |
| `DASHBOARD_PORT` | No | Express port; defaults to `3000` |
| `DASHBOARD_URL` | Production | Exact public dashboard origin; use HTTPS |
| `UPDATE_INTERVAL` | No | Minecraft refresh interval in milliseconds |
| `GUILD_SETTINGS_CACHE_MS` | No | Guild settings cache lifetime |
| `MINECRAFT_CONFIG_CACHE_MS` | No | Tracked Minecraft cache lifetime |
| `DEBUG_WEBHOOKS` | No | Card2K diagnostics; keep disabled in production |

Do not change `ENCRYPTION_SECRET` after encrypted data exists unless ciphertext is migrated. Losing it makes saved OAuth, PayOS, and Card2K credentials unreadable.

## Join-to-Create voice rooms

Run `/setup-jtc`, select temporary-room category and LFM channel. Grant bot View Channels, Manage Channels, Create Invite, Move Members, Manage Roles, Send Messages, and Embed Links. Enable Presence Intent for automatic Game naming.

**Save Current** stores member profile per guild. **Load Settings** applies it to active room. `/jtc/:guildId` lets authenticated members edit only their own profile. Ownership transfers when owner leaves; room deletes only when empty.

## Minecraft banner assets

```bash
npm run assets:prepare
```

Options live in `.env.example`. Put optional PNG/JPEG/WebP backgrounds in `assets/banners/`. Keep `MC_BANNER_ALLOW_PRIVATE_HOSTS=false` on public deployments.

## Security notes

- Serve dashboard through HTTPS; set exact `DASHBOARD_URL`.
- Keep Discord, Turso, migration-source, PayOS, Card2K, and encryption secrets server-side.
- Preserve OAuth state validation, HttpOnly/SameSite cookies, origin checks, CSP, HSTS, frame denial, and MIME sniffing protection.
- Verify payment signatures before transaction changes.
- Never log card codes, serials, signatures, OAuth tokens, provider secrets, transcripts, or config payloads.
- Keep `DEBUG_WEBHOOKS=0` in production.
- Restrict public network checks to public addresses.
- Back up data before migrations or restore operations.

Image proxy accepts allowlisted HTTPS domains, blocks redirects, and limits type/size. Learn images validate MIME, decoded format, dimensions, and a 5 MB limit. Learn MP4/WebM videos validate container signatures and a 25 MB limit before atomic local write.

## Testing

```bash
npm test
```

Tests cover database transactions, migration transforms, local media behavior, dashboard helpers, payments, moderation, Learn text/images/videos, network boundaries, Minecraft rendering, welcome cards, tickets, and shared utilities.

## Troubleshooting

### OAuth callback fails

- Confirm `DASHBOARD_URL` exactly matches Discord redirect origin.
- Confirm callback path `/api/auth/callback`.
- Check `CLIENT_ID`, `CLIENT_SECRET`, reverse proxy, HTTPS, and cookie settings.

### Database is unavailable or slow

- Check `TURSO_DATABASE_URL`, token, and Turso service status.
- Use dashboard data-service health view.
- Confirm schema migrations succeeded at startup.

### Learn media fails

- Confirm `LOCAL_MEDIA_DIR` exists on a persistent volume and bot process can read, write, rename, and delete files there.
- Confirm reverse proxy forwards `/media/...` requests and HTTP Range headers for video playback.
- Check available disk space, local-media health, and volume backup/restore policy.

### Saved secrets cannot be decrypted

Restore original `ENCRYPTION_SECRET`. For rotation, migrate existing ciphertext before removing old key.

## Contributors

- **Elaina2026** — Management and Synthesis
- **Claude** — Core Coding and Implementation
- **Codex** — Analysis and Bug Finding
- **Gemini** — Sub-agent Operations and Task Support

## License and notices

Created and maintained by **Elaina2026**.

NexBucket is licensed under [Creative Commons Attribution-NonCommercial 4.0 International](LICENSE).

Minecraft banner integration has separate dual-license permission for NexBucket and retains upstream attribution. See [NOTICE.md](NOTICE.md). Third-party dependencies and downloaded Mojang assets retain respective terms and trademarks.
