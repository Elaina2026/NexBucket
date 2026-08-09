-- NexBucket database schema — JavaScript backend, Supabase service-role access only.
-- Per-guild module configuration has one source: guild_settings.

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  ticket JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ticket) = 'object'),
  welcome JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(welcome) = 'object'),
  jtc JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(jtc) = 'object'),
  moderation JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(moderation) = 'object'),
  bank JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(bank) = 'object'),
  card JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(card) = 'object'),
  server_stats JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(server_stats) = 'object'),
  minecraft JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(minecraft) = 'object'),
  utility JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(utility) = 'object'),
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS giveaways (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  winners_count INTEGER NOT NULL CHECK (winners_count > 0),
  end_time BIGINT NOT NULL,
  host_id TEXT NOT NULL,
  ended BOOLEAN NOT NULL DEFAULT FALSE,
  entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_str TEXT
);
CREATE INDEX IF NOT EXISTS idx_giveaways_pending ON giveaways (end_time) WHERE ended = FALSE;

CREATE TABLE IF NOT EXISTS blacklist (
  user_id TEXT PRIMARY KEY,
  reason TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jtc_profiles (
  user_id TEXT PRIMARY KEY,
  name TEXT,
  "limit" INTEGER NOT NULL DEFAULT 0 CHECK ("limit" BETWEEN 0 AND 99),
  bitrate INTEGER NOT NULL DEFAULT 64000 CHECK (bitrate > 0),
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS jtc_active (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jtc_active_guild ON jtc_active (guild_id);

CREATE TABLE IF NOT EXISTS afk_data (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  reason TEXT,
  timestamp BIGINT,
  PRIMARY KEY (user_id, guild_id)
);

CREATE TABLE IF NOT EXISTS autoresponder_data (
  guild_id TEXT PRIMARY KEY,
  triggers_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS bot_whitelist (
  guild_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, bot_id)
);

-- Runtime moderation state. Module settings live in guild_settings.moderation.
CREATE TABLE IF NOT EXISTS moderation (
  guild_id TEXT PRIMARY KEY,
  warnings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  tempbans_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  hardmutes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  mutes_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS reminders (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  end_time BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (end_time) WHERE done = FALSE;

CREATE TABLE IF NOT EXISTS user_economy (
  user_id TEXT PRIMARY KEY,
  balance BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS card_transactions (
  request_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  telco TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  serial TEXT NOT NULL,
  code TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 99,
  declared_value BIGINT,
  card_value BIGINT,
  card_actual_value BIGINT,
  received_amount BIGINT,
  message TEXT,
  channel_id TEXT,
  message_id TEXT,
  trans_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_card_transactions_pending
  ON card_transactions (created_at) WHERE status IN (0, 99);
CREATE INDEX IF NOT EXISTS idx_card_transactions_guild ON card_transactions (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bot_roles (
  guild_id TEXT PRIMARY KEY,
  owner_role_id TEXT,
  admin_role_id TEXT,
  dev_role_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity TEXT NOT NULL,
  module TEXT NOT NULL,
  message TEXT NOT NULL,
  guild_id TEXT,
  guild_name TEXT,
  stack TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON incidents (timestamp DESC);

CREATE TABLE IF NOT EXISTS uptime_checks (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  service_id TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uptime_service_time ON uptime_checks (service_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id BIGSERIAL PRIMARY KEY,
  order_code BIGINT UNIQUE NOT NULL,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  channel_id TEXT,
  message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_guild ON bank_transactions (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_pending
  ON bank_transactions (created_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS bot_activities (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  guild_id TEXT,
  guild_name TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_bot_activities_timestamp ON bot_activities (timestamp DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  discriminator TEXT,
  avatar TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS ticket_transcripts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  ticket_name TEXT NOT NULL,
  password TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  claimed_by TEXT,
  creator_id TEXT,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);
CREATE INDEX IF NOT EXISTS idx_ticket_transcripts_expires ON ticket_transcripts (expires_at);
CREATE INDEX IF NOT EXISTS idx_ticket_transcripts_guild_created
  ON ticket_transcripts (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_logs_timestamp ON security_logs (timestamp DESC);

CREATE TABLE IF NOT EXISTS bot_growth_snapshots (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  guild_count INTEGER NOT NULL DEFAULT 0,
  user_count INTEGER NOT NULL DEFAULT 0,
  memory_mb REAL NOT NULL DEFAULT 0,
  avg_ping INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_growth_timestamp ON bot_growth_snapshots (timestamp ASC);

CREATE OR REPLACE FUNCTION bump_guild_settings_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_guild_settings_version ON guild_settings;
CREATE TRIGGER trg_bump_guild_settings_version
  BEFORE UPDATE ON guild_settings
  FOR EACH ROW EXECUTE FUNCTION bump_guild_settings_version();

CREATE OR REPLACE FUNCTION save_guild_section(
  p_guild_id TEXT,
  p_section TEXT,
  p_value JSONB,
  p_expected_version BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_version BIGINT;
  next_version BIGINT;
BEGIN
  IF p_section NOT IN ('ticket', 'welcome', 'jtc', 'moderation', 'bank', 'card', 'server_stats', 'minecraft', 'utility') THEN
    RAISE EXCEPTION 'INVALID_CONFIG_SECTION %', p_section USING ERRCODE = '22023';
  END IF;
  IF COALESCE(jsonb_typeof(p_value), 'null') <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CONFIG_VALUE' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_guild_id, 0));
  INSERT INTO guild_settings (guild_id) VALUES (p_guild_id) ON CONFLICT DO NOTHING;
  SELECT version INTO current_version FROM guild_settings WHERE guild_id = p_guild_id FOR UPDATE;

  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION 'CONFIG_VERSION_CONFLICT expected %, current %', p_expected_version, current_version
      USING ERRCODE = '40001';
  END IF;

  EXECUTE format('UPDATE guild_settings SET %I = $1 WHERE guild_id = $2 RETURNING version', p_section)
    INTO next_version USING p_value, p_guild_id;
  RETURN next_version;
END;
$$;

CREATE OR REPLACE FUNCTION save_guild_sections(
  p_guild_id TEXT,
  p_sections JSONB,
  p_expected_version BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_version BIGINT;
  next_version BIGINT;
  section_name TEXT;
  section_value JSONB;
BEGIN
  IF COALESCE(jsonb_typeof(p_sections), 'null') <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CONFIG_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  FOR section_name, section_value IN SELECT * FROM jsonb_each(p_sections) LOOP
    IF section_name NOT IN ('ticket', 'welcome', 'jtc', 'moderation', 'bank', 'card', 'server_stats', 'minecraft', 'utility')
      OR jsonb_typeof(section_value) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_CONFIG_SECTION %', section_name USING ERRCODE = '22023';
    END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_guild_id, 0));
  INSERT INTO guild_settings (guild_id) VALUES (p_guild_id) ON CONFLICT DO NOTHING;
  SELECT version INTO current_version FROM guild_settings WHERE guild_id = p_guild_id FOR UPDATE;

  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION 'CONFIG_VERSION_CONFLICT expected %, current %', p_expected_version, current_version
      USING ERRCODE = '40001';
  END IF;

  UPDATE guild_settings SET
    ticket = CASE WHEN p_sections ? 'ticket' THEN p_sections -> 'ticket' ELSE ticket END,
    welcome = CASE WHEN p_sections ? 'welcome' THEN p_sections -> 'welcome' ELSE welcome END,
    jtc = CASE WHEN p_sections ? 'jtc' THEN p_sections -> 'jtc' ELSE jtc END,
    moderation = CASE WHEN p_sections ? 'moderation' THEN p_sections -> 'moderation' ELSE moderation END,
    bank = CASE WHEN p_sections ? 'bank' THEN p_sections -> 'bank' ELSE bank END,
    card = CASE WHEN p_sections ? 'card' THEN p_sections -> 'card' ELSE card END,
    server_stats = CASE WHEN p_sections ? 'server_stats' THEN p_sections -> 'server_stats' ELSE server_stats END,
    minecraft = CASE WHEN p_sections ? 'minecraft' THEN p_sections -> 'minecraft' ELSE minecraft END,
    utility = CASE WHEN p_sections ? 'utility' THEN p_sections -> 'utility' ELSE utility END
  WHERE guild_id = p_guild_id
  RETURNING version INTO next_version;

  RETURN next_version;
END;
$$;

REVOKE ALL ON FUNCTION save_guild_section(TEXT, TEXT, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION save_guild_sections(TEXT, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_guild_section(TEXT, TEXT, JSONB, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION save_guild_sections(TEXT, JSONB, BIGINT) TO service_role;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'guild_settings', 'giveaways', 'blacklist', 'jtc_profiles', 'jtc_active',
    'afk_data', 'autoresponder_data', 'bot_whitelist', 'moderation', 'reminders',
    'user_economy', 'card_transactions', 'bot_roles', 'incidents', 'uptime_checks',
    'bank_transactions', 'bot_activities', 'user_sessions', 'ticket_transcripts',
    'security_logs', 'bot_growth_snapshots'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', table_name);
  END LOOP;
END;
$$;

-- Status page is served by backend, so browser roles need no direct table access.
NOTIFY pgrst, 'reload schema';
