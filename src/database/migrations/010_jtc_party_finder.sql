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

NOTIFY pgrst, 'reload schema';
