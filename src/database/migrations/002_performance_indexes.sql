-- Migration 002: indexes matching bounded runtime queries.
-- Apply on staging first and inspect EXPLAIN plans before production rollout.

CREATE INDEX IF NOT EXISTS idx_ticket_transcripts_guild_created
  ON ticket_transcripts (guild_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
