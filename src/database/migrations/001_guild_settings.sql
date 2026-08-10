


DO $$
BEGIN
  IF to_regclass('public.ticket_config') IS NOT NULL THEN
    INSERT INTO guild_settings (guild_id, ticket)
    SELECT guild_id, COALESCE(config_data, '{}'::jsonb) FROM ticket_config
    ON CONFLICT (guild_id) DO UPDATE SET ticket = EXCLUDED.ticket
      WHERE guild_settings.ticket = '{}'::jsonb;
  END IF;

  IF to_regclass('public.welcome_config') IS NOT NULL THEN
    INSERT INTO guild_settings (guild_id, welcome)
    SELECT guild_id, jsonb_strip_nulls(jsonb_build_object(
      'welcomeChannel', welcome_channel,
      'goodbyeChannel', goodbye_channel,
      'welcomeText', welcome_text,
      'goodbyeText', goodbye_text,
      'welcomeBg', welcome_bg,
      'goodbyeBg', goodbye_bg,
      'welcomeMessageContent', welcome_message_content,
      'goodbyeMessageContent', goodbye_message_content
    )) FROM welcome_config
    ON CONFLICT (guild_id) DO UPDATE SET welcome = EXCLUDED.welcome
      WHERE guild_settings.welcome = '{}'::jsonb;
  END IF;

  IF to_regclass('public.jtc_config') IS NOT NULL THEN
    INSERT INTO guild_settings (guild_id, jtc)
    SELECT guild_id, jsonb_build_object('hubChannelId', hub_channel_id) FROM jtc_config
    ON CONFLICT (guild_id) DO UPDATE SET jtc = EXCLUDED.jtc
      WHERE guild_settings.jtc = '{}'::jsonb;
  END IF;

  IF to_regclass('public.bank_config') IS NOT NULL THEN
    INSERT INTO guild_settings (guild_id, bank)
    SELECT guild_id, jsonb_strip_nulls(jsonb_build_object(
      'bankBin', bank_bin,
      'accountNo', account_no,
      'accountName', account_name,
      'payosClientId', payos_client_id,
      'payosApiKey', payos_api_key,
      'payosChecksumKey', payos_checksum_key,
      'notificationChannelId', notification_channel_id
    )) FROM bank_config
    ON CONFLICT (guild_id) DO UPDATE SET bank = EXCLUDED.bank
      WHERE guild_settings.bank = '{}'::jsonb;
  END IF;

  IF to_regclass('public.card_config') IS NOT NULL THEN
    INSERT INTO guild_settings (guild_id, card)
    SELECT guild_id, jsonb_strip_nulls(jsonb_build_object(
      'partnerId', partner_id,
      'partnerKey', partner_key,
      'domain', domain
    )) FROM card_config
    ON CONFLICT (guild_id) DO UPDATE SET card = EXCLUDED.card
      WHERE guild_settings.card = '{}'::jsonb;
  END IF;

  IF to_regclass('public.serverstats_config') IS NOT NULL THEN
    INSERT INTO guild_settings (guild_id, server_stats)
    SELECT guild_id, jsonb_strip_nulls(jsonb_build_object(
      'categoryId', category_id,
      'allMembersId', all_members_id,
      'humansId', humans_id,
      'staffOnlineId', staff_online_id,
      'botCountId', bot_count_id
    )) FROM serverstats_config
    ON CONFLICT (guild_id) DO UPDATE SET server_stats = EXCLUDED.server_stats
      WHERE guild_settings.server_stats = '{}'::jsonb;
  END IF;

  IF to_regclass('public.guild_configs') IS NOT NULL THEN
    INSERT INTO guild_settings (guild_id, ticket, welcome, jtc, moderation, bank, server_stats, minecraft, utility)
    SELECT guild_id,
      COALESCE(ticket_config, '{}'::jsonb),
      COALESCE(welcome_config, '{}'::jsonb),
      COALESCE(jtc_config, '{}'::jsonb),
      COALESCE(mod_config, '{}'::jsonb),
      COALESCE(bank_config, '{}'::jsonb),
      COALESCE(stats_config, '{}'::jsonb),
      COALESCE(status_config, '{}'::jsonb),
      jsonb_strip_nulls(jsonb_build_object('autoroleId', autorole_id))
    FROM guild_configs
    ON CONFLICT (guild_id) DO UPDATE SET
      ticket = CASE WHEN guild_settings.ticket = '{}'::jsonb THEN EXCLUDED.ticket ELSE guild_settings.ticket END,
      welcome = CASE WHEN guild_settings.welcome = '{}'::jsonb THEN EXCLUDED.welcome ELSE guild_settings.welcome END,
      jtc = CASE WHEN guild_settings.jtc = '{}'::jsonb THEN EXCLUDED.jtc ELSE guild_settings.jtc END,
      moderation = CASE WHEN guild_settings.moderation = '{}'::jsonb THEN EXCLUDED.moderation ELSE guild_settings.moderation END,
      bank = CASE WHEN guild_settings.bank = '{}'::jsonb THEN EXCLUDED.bank ELSE guild_settings.bank END,
      server_stats = CASE WHEN guild_settings.server_stats = '{}'::jsonb THEN EXCLUDED.server_stats ELSE guild_settings.server_stats END,
      minecraft = CASE WHEN guild_settings.minecraft = '{}'::jsonb THEN EXCLUDED.minecraft ELSE guild_settings.minecraft END,
      utility = CASE WHEN guild_settings.utility = '{}'::jsonb THEN EXCLUDED.utility ELSE guild_settings.utility END;
  END IF;

  IF to_regclass('public.guild_config_versions') IS NOT NULL THEN
    UPDATE guild_settings AS settings
      SET version = versions.version, updated_at = versions.updated_at
    FROM guild_config_versions AS versions
    WHERE settings.guild_id = versions.guild_id AND settings.version = 0;
  END IF;

  IF to_regclass('public.mc_servers') IS NOT NULL THEN
    INSERT INTO guild_settings (guild_id, minecraft)
    SELECT guild_id, jsonb_build_object(
      'servers', jsonb_agg(jsonb_build_object(
        'channelId', channel_id,
        'ip', ip,
        'port', port,
        'messageId', message_id
      ) ORDER BY channel_id)
    )
    FROM mc_servers
    GROUP BY guild_id
    ON CONFLICT (guild_id) DO UPDATE SET minecraft = EXCLUDED.minecraft
      WHERE guild_settings.minecraft = '{}'::jsonb;
  END IF;
END;
$$;


NOTIFY pgrst, 'reload schema';
