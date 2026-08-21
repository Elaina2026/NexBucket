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

NOTIFY pgrst, 'reload schema';
