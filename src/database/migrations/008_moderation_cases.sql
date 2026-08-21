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

NOTIFY pgrst, 'reload schema';
