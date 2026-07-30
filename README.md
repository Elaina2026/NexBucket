# NexBucket

NexBucket is an all-in-one Discord bot with a Discord OAuth2 dashboard, Supabase storage, moderation, tickets, payments, dynamic voice channels, Minecraft status, giveaways, and server utilities.

## Requirements

- Node.js 18+
- Discord application and bot
- Supabase project
- PostgreSQL connection string for migrations

## Install

```bash
npm install
cp .env.example .env
```

Windows users can copy `.env.example` manually to `.env`.

## Environment

Set values in `.env`:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_discord_application_id
CLIENT_SECRET=your_discord_oauth_client_secret
BOT_OWNER_ID=your_discord_user_id

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_service_role_key

# Runtime transaction pooler
DATABASE_URL=postgresql://postgres.your-project:YOUR_ENCODED_PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true

# Session pooler; used first for migrations
DIRECT_URL=postgresql://postgres.your-project:YOUR_ENCODED_PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres

ENCRYPTION_SECRET=generate-a-long-random-secret
DASHBOARD_PORT=3000
DASHBOARD_URL=http://localhost:3000
UPDATE_INTERVAL=60000
```

`SUPABASE_KEY` must be backend-only `service_role`. Never expose it to browser code or commit `.env`.

URL-encode special PostgreSQL password characters:

```text
/ → %2F
@ → %40
: → %3A
# → %23
% → %25
```

`TOPGG_TOKEN` is optional. Set it only when automatic top.gg bot whitelist checks are needed.

## Database

Bot startup runs:

1. `src/database/schema.sql`
2. Pending files in `src/database/migrations/`

Migration uses `DIRECT_URL` first, then `DATABASE_URL`.

For a fresh database:

```bash
npm start
```

For existing data, back up PostgreSQL before first migration. Legacy configuration is copied into `guild_settings`; migration records are stored in `schema_migrations`.

Run RLS reconciliation in Supabase SQL Editor when needed:

```text
src/database/security_policies.sql
```

## Run

Production/startup:

```bash
npm start
```

Development with Node watch mode:

```bash
npm run dev
```

Tests:

```bash
npm test
```

## Dashboard

Set Discord OAuth2 redirect URL to:

```text
http://localhost:3000/api/auth/callback
```

For production, use HTTPS and set `DASHBOARD_URL` to the public HTTPS URL.

Dashboard authentication uses Discord OAuth2. `DASHBOARD_PASSWORD` is not used.

## Main modules

- Ticket support and transcripts
- Welcome and goodbye banners
- Join-to-Create voice channels
- Moderation, anti-spam, anti-raid, anti-link
- Bot roles and bot whitelist
- VietQR and PayOS payments
- Card2K top-ups
- Minecraft server status
- Server statistics channels
- Giveaways, AFK, reminders, autoresponder
- OAuth2 dashboard and admin monitoring

## JTC dashboard settings

Dashboard → Voice JTC supports:

- Hub voice channel
- Temporary voice category
- Default temporary channel name
- `{username}` and `{displayName}` placeholders
- Default user limit
- Default bitrate
- Lock new temporary channels

Personal JTC profiles can override guild defaults.

## Security

- Keep `.env` private.
- Rotate Discord, Supabase, PostgreSQL, OAuth, payment, and encryption secrets if exposed.
- Do not change `ENCRYPTION_SECRET` after encrypted payment data exists unless old data has been migrated to a new key.
- Use `service_role` only on backend.
- Use HTTPS in production.
- Verify payment webhook signatures.
- Do not enable `DEBUG_WEBHOOKS` in production.

## License

NexBucket is licensed under Creative Commons Attribution-NonCommercial 4.0 International. See [LICENSE](LICENSE).
