ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'dm',
  ADD COLUMN IF NOT EXISTS guild_id TEXT,
  ADD COLUMN IF NOT EXISTS channel_id TEXT,
  ADD COLUMN IF NOT EXISTS recurrence TEXT,
  ADD COLUMN IF NOT EXISTS time_zone TEXT,
  ADD COLUMN IF NOT EXISTS local_time TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminders_target_type_check') THEN
    ALTER TABLE reminders ADD CONSTRAINT reminders_target_type_check
      CHECK (target_type IN ('dm', 'channel'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminders_recurrence_check') THEN
    ALTER TABLE reminders ADD CONSTRAINT reminders_recurrence_check
      CHECK (recurrence IS NULL OR recurrence = 'daily');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminders_local_time_check') THEN
    ALTER TABLE reminders ADD CONSTRAINT reminders_local_time_check
      CHECK (local_time IS NULL OR local_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminders_target_fields_check') THEN
    ALTER TABLE reminders ADD CONSTRAINT reminders_target_fields_check CHECK (
      (target_type = 'dm' AND guild_id IS NULL AND channel_id IS NULL AND recurrence IS NULL AND time_zone IS NULL AND local_time IS NULL)
      OR
      (target_type = 'channel' AND guild_id IS NOT NULL AND channel_id IS NOT NULL AND recurrence = 'daily' AND time_zone IS NOT NULL AND local_time IS NOT NULL)
    );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_reminders_channel_pending
  ON reminders (guild_id, channel_id, end_time)
  WHERE done = FALSE AND target_type = 'channel';

NOTIFY pgrst, 'reload schema';
