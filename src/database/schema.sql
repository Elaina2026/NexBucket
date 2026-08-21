


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
  guild_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL,
  name TEXT,
  "limit" INTEGER NOT NULL DEFAULT 0 CHECK ("limit" BETWEEN 0 AND 99),
  bitrate INTEGER NOT NULL DEFAULT 64000 CHECK (bitrate >= 8000),
  status TEXT,
  rtc_region TEXT,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  is_nsfw BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_jtc_profiles_user ON jtc_profiles (user_id);

CREATE TABLE IF NOT EXISTS jtc_active (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  control_message_id TEXT,
  status TEXT,
  last_lfm_at BIGINT NOT NULL DEFAULT 0
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
  done BOOLEAN NOT NULL DEFAULT FALSE,
  processing_at BIGINT,
  target_type TEXT NOT NULL DEFAULT 'dm' CHECK (target_type IN ('dm', 'channel')),
  guild_id TEXT,
  channel_id TEXT,
  recurrence TEXT CHECK (recurrence IS NULL OR recurrence = 'daily'),
  time_zone TEXT,
  local_time TEXT CHECK (local_time IS NULL OR local_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  CHECK (
    (target_type = 'dm' AND guild_id IS NULL AND channel_id IS NULL AND recurrence IS NULL AND time_zone IS NULL AND local_time IS NULL)
    OR
    (target_type = 'channel' AND guild_id IS NOT NULL AND channel_id IS NOT NULL AND recurrence = 'daily' AND time_zone IS NOT NULL AND local_time IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (end_time) WHERE done = FALSE;
CREATE INDEX IF NOT EXISTS idx_reminders_user_pending ON reminders (user_id, end_time) WHERE done = FALSE;

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


CREATE TABLE IF NOT EXISTS guild_config_history (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK (version >= 0),
  previous_version BIGINT NOT NULL CHECK (previous_version >= 0),
  changed_sections TEXT[] NOT NULL DEFAULT '{}',
  before_config JSONB NOT NULL CHECK (jsonb_typeof(before_config) = 'object'),
  after_config JSONB NOT NULL CHECK (jsonb_typeof(after_config) = 'object'),
  actor_id TEXT,
  actor_name TEXT,
  source TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('dashboard', 'discord', 'system', 'rollback', 'import', 'wizard')),
  rollback_from_id BIGINT REFERENCES guild_config_history(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guild_config_history_guild_version
  ON guild_config_history (guild_id, version DESC, id DESC);

CREATE OR REPLACE FUNCTION redact_guild_config_snapshot(p_config JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ticket', COALESCE(p_config -> 'ticket', '{}'::jsonb),
    'welcome', COALESCE(p_config -> 'welcome', '{}'::jsonb),
    'jtc', COALESCE(p_config -> 'jtc', '{}'::jsonb),
    'moderation', COALESCE(p_config -> 'moderation', '{}'::jsonb),
    'bank',
      (COALESCE(p_config -> 'bank', '{}'::jsonb)
        - ARRAY['payosClientId', 'payosApiKey', 'payosChecksumKey', 'payosConfigured']::text[])
      || jsonb_build_object(
        'payosConfigured',
        COALESCE(p_config -> 'bank' ->> 'payosConfigured', '') = 'true'
        OR (
          COALESCE(p_config -> 'bank' ->> 'payosClientId', '') <> ''
          AND COALESCE(p_config -> 'bank' ->> 'payosApiKey', '') <> ''
          AND COALESCE(p_config -> 'bank' ->> 'payosChecksumKey', '') <> ''
        )
      ),
    'card',
      (COALESCE(p_config -> 'card', '{}'::jsonb)
        - ARRAY['partnerKey', 'cardConfigured']::text[])
      || jsonb_build_object(
        'cardConfigured',
        COALESCE(p_config -> 'card' ->> 'cardConfigured', '') = 'true'
        OR COALESCE(p_config -> 'card' ->> 'partnerKey', '') <> ''
      ),
    'server_stats', COALESCE(p_config -> 'server_stats', '{}'::jsonb),
    'minecraft', COALESCE(p_config -> 'minecraft', '{}'::jsonb),
    'utility', COALESCE(p_config -> 'utility', '{}'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION save_guild_section_with_history(
  p_guild_id TEXT,
  p_section TEXT,
  p_value JSONB,
  p_expected_version BIGINT DEFAULT NULL,
  p_actor_id TEXT DEFAULT NULL,
  p_actor_name TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'system'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row guild_settings%ROWTYPE;
  updated_row guild_settings%ROWTYPE;
  before_snapshot JSONB;
  after_snapshot JSONB;
BEGIN
  IF p_section NOT IN ('ticket', 'welcome', 'jtc', 'moderation', 'bank', 'card', 'server_stats', 'minecraft', 'utility') THEN
    RAISE EXCEPTION 'INVALID_CONFIG_SECTION %', p_section USING ERRCODE = '22023';
  END IF;
  IF COALESCE(jsonb_typeof(p_value), 'null') <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CONFIG_VALUE' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('dashboard', 'discord', 'system', 'rollback', 'import', 'wizard') THEN
    RAISE EXCEPTION 'INVALID_CONFIG_SOURCE' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_guild_id, 0));
  INSERT INTO guild_settings (guild_id) VALUES (p_guild_id) ON CONFLICT DO NOTHING;
  SELECT * INTO current_row FROM guild_settings WHERE guild_id = p_guild_id FOR UPDATE;

  IF p_expected_version IS NOT NULL AND current_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'CONFIG_VERSION_CONFLICT expected %, current %', p_expected_version, current_row.version
      USING ERRCODE = '40001';
  END IF;

  before_snapshot := redact_guild_config_snapshot(jsonb_build_object(
    'ticket', current_row.ticket,
    'welcome', current_row.welcome,
    'jtc', current_row.jtc,
    'moderation', current_row.moderation,
    'bank', current_row.bank,
    'card', current_row.card,
    'server_stats', current_row.server_stats,
    'minecraft', current_row.minecraft,
    'utility', current_row.utility
  ));

  EXECUTE format('UPDATE guild_settings SET %I = $1 WHERE guild_id = $2 RETURNING *', p_section)
    INTO updated_row USING p_value, p_guild_id;

  after_snapshot := redact_guild_config_snapshot(jsonb_build_object(
    'ticket', updated_row.ticket,
    'welcome', updated_row.welcome,
    'jtc', updated_row.jtc,
    'moderation', updated_row.moderation,
    'bank', updated_row.bank,
    'card', updated_row.card,
    'server_stats', updated_row.server_stats,
    'minecraft', updated_row.minecraft,
    'utility', updated_row.utility
  ));

  INSERT INTO guild_config_history (
    guild_id, version, previous_version, changed_sections, before_config, after_config,
    actor_id, actor_name, source
  ) VALUES (
    p_guild_id, updated_row.version, current_row.version, ARRAY[p_section], before_snapshot, after_snapshot,
    NULLIF(left(p_actor_id, 64), ''), NULLIF(left(p_actor_name, 100), ''), p_source
  );

  DELETE FROM guild_config_history
  WHERE guild_id = p_guild_id
    AND id NOT IN (
      SELECT id FROM guild_config_history
      WHERE guild_id = p_guild_id
      ORDER BY id DESC
      LIMIT 100
    );

  RETURN updated_row.version;
END;
$$;

CREATE OR REPLACE FUNCTION save_guild_sections_with_history(
  p_guild_id TEXT,
  p_sections JSONB,
  p_expected_version BIGINT,
  p_actor_id TEXT DEFAULT NULL,
  p_actor_name TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'dashboard'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row guild_settings%ROWTYPE;
  updated_row guild_settings%ROWTYPE;
  before_snapshot JSONB;
  after_snapshot JSONB;
  section_name TEXT;
  section_value JSONB;
  changed TEXT[];
BEGIN
  IF COALESCE(jsonb_typeof(p_sections), 'null') <> 'object' OR p_sections = '{}'::jsonb THEN
    RAISE EXCEPTION 'INVALID_CONFIG_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  FOR section_name, section_value IN SELECT * FROM jsonb_each(p_sections) LOOP
    IF section_name NOT IN ('ticket', 'welcome', 'jtc', 'moderation', 'bank', 'card', 'server_stats', 'minecraft', 'utility')
      OR jsonb_typeof(section_value) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_CONFIG_SECTION %', section_name USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_source NOT IN ('dashboard', 'discord', 'system', 'rollback', 'import', 'wizard') THEN
    RAISE EXCEPTION 'INVALID_CONFIG_SOURCE' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_guild_id, 0));
  INSERT INTO guild_settings (guild_id) VALUES (p_guild_id) ON CONFLICT DO NOTHING;
  SELECT * INTO current_row FROM guild_settings WHERE guild_id = p_guild_id FOR UPDATE;

  IF current_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'CONFIG_VERSION_CONFLICT expected %, current %', p_expected_version, current_row.version
      USING ERRCODE = '40001';
  END IF;

  before_snapshot := redact_guild_config_snapshot(jsonb_build_object(
    'ticket', current_row.ticket,
    'welcome', current_row.welcome,
    'jtc', current_row.jtc,
    'moderation', current_row.moderation,
    'bank', current_row.bank,
    'card', current_row.card,
    'server_stats', current_row.server_stats,
    'minecraft', current_row.minecraft,
    'utility', current_row.utility
  ));

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
  RETURNING * INTO updated_row;

  after_snapshot := redact_guild_config_snapshot(jsonb_build_object(
    'ticket', updated_row.ticket,
    'welcome', updated_row.welcome,
    'jtc', updated_row.jtc,
    'moderation', updated_row.moderation,
    'bank', updated_row.bank,
    'card', updated_row.card,
    'server_stats', updated_row.server_stats,
    'minecraft', updated_row.minecraft,
    'utility', updated_row.utility
  ));
  SELECT array_agg(key ORDER BY key) INTO changed FROM jsonb_object_keys(p_sections) AS keys(key);

  INSERT INTO guild_config_history (
    guild_id, version, previous_version, changed_sections, before_config, after_config,
    actor_id, actor_name, source
  ) VALUES (
    p_guild_id, updated_row.version, current_row.version, changed, before_snapshot, after_snapshot,
    NULLIF(left(p_actor_id, 64), ''), NULLIF(left(p_actor_name, 100), ''), p_source
  );

  DELETE FROM guild_config_history
  WHERE guild_id = p_guild_id
    AND id NOT IN (
      SELECT id FROM guild_config_history
      WHERE guild_id = p_guild_id
      ORDER BY id DESC
      LIMIT 100
    );

  RETURN updated_row.version;
END;
$$;

CREATE OR REPLACE FUNCTION rollback_guild_config(
  p_guild_id TEXT,
  p_history_id BIGINT,
  p_expected_version BIGINT,
  p_actor_id TEXT DEFAULT NULL,
  p_actor_name TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row guild_settings%ROWTYPE;
  updated_row guild_settings%ROWTYPE;
  history_row guild_config_history%ROWTYPE;
  target_snapshot JSONB;
  before_snapshot JSONB;
  after_snapshot JSONB;
  target_bank JSONB;
  target_card JSONB;
  changed TEXT[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_guild_id, 0));
  SELECT * INTO history_row
  FROM guild_config_history
  WHERE id = p_history_id AND guild_id = p_guild_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFIG_HISTORY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO current_row FROM guild_settings WHERE guild_id = p_guild_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUILD_CONFIG_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF current_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'CONFIG_VERSION_CONFLICT expected %, current %', p_expected_version, current_row.version
      USING ERRCODE = '40001';
  END IF;

  target_snapshot := redact_guild_config_snapshot(history_row.after_config);
  before_snapshot := redact_guild_config_snapshot(jsonb_build_object(
    'ticket', current_row.ticket,
    'welcome', current_row.welcome,
    'jtc', current_row.jtc,
    'moderation', current_row.moderation,
    'bank', current_row.bank,
    'card', current_row.card,
    'server_stats', current_row.server_stats,
    'minecraft', current_row.minecraft,
    'utility', current_row.utility
  ));
  target_bank := (target_snapshot -> 'bank') - 'payosConfigured'
    || jsonb_strip_nulls(jsonb_build_object(
      'payosClientId', current_row.bank -> 'payosClientId',
      'payosApiKey', current_row.bank -> 'payosApiKey',
      'payosChecksumKey', current_row.bank -> 'payosChecksumKey'
    ));
  target_card := (target_snapshot -> 'card') - 'cardConfigured'
    || jsonb_strip_nulls(jsonb_build_object('partnerKey', current_row.card -> 'partnerKey'));

  UPDATE guild_settings SET
    ticket = target_snapshot -> 'ticket',
    welcome = target_snapshot -> 'welcome',
    jtc = target_snapshot -> 'jtc',
    moderation = target_snapshot -> 'moderation',
    bank = target_bank,
    card = target_card,
    server_stats = target_snapshot -> 'server_stats',
    minecraft = target_snapshot -> 'minecraft',
    utility = target_snapshot -> 'utility'
  WHERE guild_id = p_guild_id
  RETURNING * INTO updated_row;

  after_snapshot := redact_guild_config_snapshot(jsonb_build_object(
    'ticket', updated_row.ticket,
    'welcome', updated_row.welcome,
    'jtc', updated_row.jtc,
    'moderation', updated_row.moderation,
    'bank', updated_row.bank,
    'card', updated_row.card,
    'server_stats', updated_row.server_stats,
    'minecraft', updated_row.minecraft,
    'utility', updated_row.utility
  ));
  SELECT COALESCE(array_agg(entry_key ORDER BY entry_key), ARRAY[]::TEXT[]) INTO changed
  FROM jsonb_each(after_snapshot) AS entries(entry_key, entry_value)
  WHERE entry_value IS DISTINCT FROM before_snapshot -> entry_key;

  INSERT INTO guild_config_history (
    guild_id, version, previous_version, changed_sections, before_config, after_config,
    actor_id, actor_name, source, rollback_from_id
  ) VALUES (
    p_guild_id, updated_row.version, current_row.version, changed, before_snapshot, after_snapshot,
    NULLIF(left(p_actor_id, 64), ''), NULLIF(left(p_actor_name, 100), ''), 'rollback', p_history_id
  );

  DELETE FROM guild_config_history
  WHERE guild_id = p_guild_id
    AND id NOT IN (
      SELECT id FROM guild_config_history
      WHERE guild_id = p_guild_id
      ORDER BY id DESC
      LIMIT 100
    );

  RETURN updated_row.version;
END;
$$;

ALTER TABLE guild_config_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guild_config_history FROM anon, authenticated;
REVOKE ALL ON SEQUENCE guild_config_history_id_seq FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON guild_config_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE guild_config_history_id_seq TO service_role;
REVOKE ALL ON FUNCTION redact_guild_config_snapshot(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION save_guild_section_with_history(TEXT, TEXT, JSONB, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION save_guild_sections_with_history(TEXT, JSONB, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rollback_guild_config(TEXT, BIGINT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION redact_guild_config_snapshot(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION save_guild_section_with_history(TEXT, TEXT, JSONB, BIGINT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION save_guild_sections_with_history(TEXT, JSONB, BIGINT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION rollback_guild_config(TEXT, BIGINT, BIGINT, TEXT, TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS tickets (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  first_response_at TIMESTAMPTZ,
  first_response_by TEXT,
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  claim_due_at TIMESTAMPTZ,
  first_response_due_at TIMESTAMPTZ,
  sla_state TEXT NOT NULL DEFAULT 'pending' CHECK (sla_state IN ('pending', 'met', 'breached', 'disabled')),
  last_escalated_at TIMESTAMPTZ,
  escalation_claimed_at TIMESTAMPTZ,
  CHECK ((status = 'open' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL)),
  CHECK ((claimed_at IS NULL AND claimed_by IS NULL) OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_created ON tickets (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_open_claim_due ON tickets (claim_due_at) WHERE status = 'open' AND claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_open_response_due ON tickets (first_response_due_at) WHERE status = 'open' AND first_response_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_escalation_claim ON tickets (escalation_claimed_at) WHERE status = 'open';

CREATE OR REPLACE FUNCTION claim_ticket(p_channel_id TEXT, p_claimed_by TEXT)
RETURNS SETOF tickets
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE tickets
  SET claimed_at = NOW(), claimed_by = p_claimed_by,
      sla_state = CASE WHEN claim_due_at IS NOT NULL AND NOW() > claim_due_at THEN 'breached' ELSE sla_state END
  WHERE channel_id = p_channel_id AND status = 'open' AND claimed_at IS NULL
  RETURNING *;
$$;

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tickets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tickets TO service_role;
REVOKE ALL ON FUNCTION claim_ticket(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_ticket(TEXT, TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS moderation_case_counters (
  guild_id TEXT PRIMARY KEY,
  next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number > 0)
);

CREATE TABLE IF NOT EXISTS moderation_cases (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  case_number BIGINT NOT NULL CHECK (case_number > 0),
  action TEXT NOT NULL CHECK (action IN ('warn', 'ban', 'tempban', 'unban', 'kick', 'timeout', 'removetimeout', 'mute', 'unmute', 'hardmute', 'revoke')),
  target_id TEXT NOT NULL,
  moderator_id TEXT,
  reason TEXT NOT NULL DEFAULT 'No reason provided',
  duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms > 0),
  expires_at TIMESTAMPTZ,
  evidence_url TEXT,
  evidence_text TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  source TEXT NOT NULL DEFAULT 'discord' CHECK (source IN ('discord', 'prefix', 'dashboard', 'system')),
  revoked_by TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, case_number)
);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_guild_created ON moderation_cases (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_target ON moderation_cases (guild_id, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_expiry ON moderation_cases (expires_at) WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION create_moderation_case(
  p_guild_id TEXT,
  p_action TEXT,
  p_target_id TEXT,
  p_moderator_id TEXT,
  p_reason TEXT,
  p_duration_ms BIGINT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_evidence_url TEXT DEFAULT NULL,
  p_evidence_text TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'active',
  p_source TEXT DEFAULT 'discord'
)
RETURNS SETOF moderation_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assigned_number BIGINT;
BEGIN
  INSERT INTO moderation_case_counters (guild_id, next_number) VALUES (p_guild_id, 2)
  ON CONFLICT (guild_id) DO UPDATE SET next_number = moderation_case_counters.next_number + 1
  RETURNING next_number - 1 INTO assigned_number;

  RETURN QUERY INSERT INTO moderation_cases (
    guild_id, case_number, action, target_id, moderator_id, reason, duration_ms,
    expires_at, evidence_url, evidence_text, status, source
  ) VALUES (
    p_guild_id, assigned_number, p_action, p_target_id, p_moderator_id,
    left(COALESCE(NULLIF(p_reason, ''), 'No reason provided'), 1000), p_duration_ms,
    p_expires_at, p_evidence_url, p_evidence_text, p_status, p_source
  ) RETURNING *;
END;
$$;

ALTER TABLE moderation_case_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON moderation_case_counters, moderation_cases FROM anon, authenticated;
REVOKE ALL ON SEQUENCE moderation_cases_id_seq FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON moderation_case_counters, moderation_cases TO service_role;
GRANT USAGE, SELECT ON SEQUENCE moderation_cases_id_seq TO service_role;
REVOKE ALL ON FUNCTION create_moderation_case(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_moderation_case(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) TO service_role;

ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_recurrence_check;
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_check;
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_target_fields_check;
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_weekdays_check;
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_day_of_month_check;
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_embed_check;
ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_target_shape_check;
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS weekdays INTEGER[],
  ADD COLUMN IF NOT EXISTS day_of_month INTEGER,
  ADD COLUMN IF NOT EXISTS embed JSONB,
  ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_run_at BIGINT;
ALTER TABLE reminders ADD CONSTRAINT reminders_recurrence_check
  CHECK (recurrence IS NULL OR recurrence IN ('once', 'daily', 'weekly', 'monthly'));
ALTER TABLE reminders ADD CONSTRAINT reminders_weekdays_check
  CHECK (weekdays IS NULL OR (weekdays <@ ARRAY[0,1,2,3,4,5,6] AND cardinality(weekdays) BETWEEN 1 AND 7));
ALTER TABLE reminders ADD CONSTRAINT reminders_day_of_month_check
  CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28);
ALTER TABLE reminders ADD CONSTRAINT reminders_embed_check
  CHECK (embed IS NULL OR jsonb_typeof(embed) = 'object');
ALTER TABLE reminders ADD CONSTRAINT reminders_target_shape_check CHECK (
  (target_type = 'dm' AND guild_id IS NULL AND channel_id IS NULL AND recurrence IS NULL AND time_zone IS NULL AND local_time IS NULL AND weekdays IS NULL AND day_of_month IS NULL AND embed IS NULL)
  OR
  (target_type = 'channel' AND guild_id IS NOT NULL AND channel_id IS NOT NULL AND recurrence IN ('once', 'daily', 'weekly', 'monthly') AND time_zone IS NOT NULL AND local_time IS NOT NULL
    AND (recurrence <> 'weekly' OR weekdays IS NOT NULL)
    AND (recurrence <> 'monthly' OR day_of_month IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id BIGSERIAL PRIMARY KEY,
  reminder_id BIGINT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  scheduled_for BIGINT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'sent', 'failed')),
  error TEXT,
  UNIQUE (reminder_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_reminder ON schedule_runs (reminder_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_due_active ON reminders (end_time) WHERE done = FALSE AND paused = FALSE;

ALTER TABLE schedule_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON schedule_runs FROM anon, authenticated;
REVOKE ALL ON SEQUENCE schedule_runs_id_seq FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE schedule_runs_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS jtc_party_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  game TEXT NOT NULL,
  rank TEXT,
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 2 AND 10),
  members JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(members) = 'array'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_confirmation', 'confirming', 'confirmed', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmation_expires_at TIMESTAMPTZ,
  lfm_channel_id TEXT NOT NULL,
  message_id TEXT,
  voice_channel_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jtc_party_queue_pending ON jtc_party_queue (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_jtc_party_queue_guild ON jtc_party_queue (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jtc_party_members (
  queue_id UUID NOT NULL REFERENCES jtc_party_queue(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (queue_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jtc_party_member_active
  ON jtc_party_members (guild_id, user_id) WHERE active = TRUE;

CREATE OR REPLACE FUNCTION join_jtc_party(p_queue_id UUID, p_user_id TEXT)
RETURNS SETOF jtc_party_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queue_row jtc_party_queue%ROWTYPE;
  member_count INTEGER;
BEGIN
  SELECT * INTO queue_row FROM jtc_party_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND OR queue_row.status <> 'open' OR queue_row.expires_at <= NOW() THEN
    RAISE EXCEPTION 'PARTY_NOT_OPEN' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id = queue_row.owner_id THEN RETURN QUERY SELECT * FROM jtc_party_queue WHERE id = p_queue_id; RETURN; END IF;
  INSERT INTO jtc_party_members (queue_id, guild_id, user_id) VALUES (p_queue_id, queue_row.guild_id, p_user_id)
  ON CONFLICT (queue_id, user_id) DO UPDATE SET active = TRUE, joined_at = NOW();
  SELECT count(*) INTO member_count FROM jtc_party_members WHERE queue_id = p_queue_id AND active = TRUE;
  IF member_count >= queue_row.party_size THEN
    UPDATE jtc_party_queue SET status = 'awaiting_confirmation', confirmation_expires_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
    WHERE id = p_queue_id;
  END IF;
  RETURN QUERY SELECT * FROM jtc_party_queue WHERE id = p_queue_id;
END;
$$;

CREATE OR REPLACE FUNCTION leave_jtc_party(p_queue_id UUID, p_user_id TEXT)
RETURNS SETOF jtc_party_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE jtc_party_members SET active = FALSE WHERE queue_id = p_queue_id AND user_id = p_user_id;
  UPDATE jtc_party_queue SET status = 'open', confirmation_expires_at = NULL, updated_at = NOW()
  WHERE id = p_queue_id AND status = 'awaiting_confirmation';
  RETURN QUERY SELECT * FROM jtc_party_queue WHERE id = p_queue_id;
END;
$$;

ALTER TABLE jtc_party_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE jtc_party_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jtc_party_queue, jtc_party_members FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON jtc_party_queue, jtc_party_members TO service_role;
REVOKE ALL ON FUNCTION join_jtc_party(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION leave_jtc_party(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION join_jtc_party(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION leave_jtc_party(UUID, TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS privacy_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('export', 'delete')),
  categories TEXT[] NOT NULL DEFAULT '{}',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  owner_note TEXT,
  result JSONB,
  CHECK (cardinality(categories) BETWEEN 1 AND 8)
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests (status, requested_at);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_user ON privacy_requests (user_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_requests_pending_delete
  ON privacy_requests (user_id) WHERE status = 'pending' AND request_type = 'delete';

CREATE OR REPLACE FUNCTION decide_privacy_request(
  p_request_id BIGINT,
  p_expected_user_id TEXT,
  p_expected_categories TEXT[],
  p_status TEXT,
  p_reviewed_at TIMESTAMPTZ,
  p_reviewed_by TEXT,
  p_owner_note TEXT,
  p_result JSONB
)
RETURNS SETOF privacy_requests
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE privacy_requests SET
    status = p_status,
    reviewed_at = p_reviewed_at,
    reviewed_by = p_reviewed_by,
    owner_note = p_owner_note,
    result = p_result
  WHERE id = p_request_id
    AND status = 'pending'
    AND user_id = p_expected_user_id
    AND categories = p_expected_categories
    AND p_status IN ('approved', 'rejected')
  RETURNING *;
$$;

ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_requests FROM anon, authenticated;
REVOKE ALL ON SEQUENCE privacy_requests_id_seq FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON privacy_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE privacy_requests_id_seq TO service_role;
REVOKE ALL ON FUNCTION decide_privacy_request(BIGINT, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION decide_privacy_request(BIGINT, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
