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

NOTIFY pgrst, 'reload schema';
