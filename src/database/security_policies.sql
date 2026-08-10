



DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'guild_settings', 'giveaways', 'blacklist', 'jtc_profiles', 'jtc_active',
    'afk_data', 'autoresponder_data', 'bot_whitelist', 'moderation', 'reminders',
    'user_economy', 'card_transactions', 'bot_roles', 'incidents', 'uptime_checks',
    'bank_transactions', 'bot_activities', 'user_sessions', 'ticket_transcripts',
    'security_logs', 'bot_growth_snapshots', 'schema_migrations',
    -- Legacy tables remain readable only by service_role during rollback window.
    'ticket_config', 'welcome_config', 'jtc_config', 'bank_config', 'card_config',
    'serverstats_config', 'guild_configs', 'guild_config_versions', 'mc_servers'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', table_name);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION save_guild_section(TEXT, TEXT, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION save_guild_sections(TEXT, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_guild_section(TEXT, TEXT, JSONB, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION save_guild_sections(TEXT, JSONB, BIGINT) TO service_role;
