


CREATE INDEX IF NOT EXISTS idx_ticket_transcripts_guild_created
  ON ticket_transcripts (guild_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
