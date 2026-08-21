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

NOTIFY pgrst, 'reload schema';
