ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS processing_at BIGINT;

CREATE INDEX IF NOT EXISTS idx_reminders_user_pending
  ON reminders (user_id, end_time)
  WHERE done = FALSE;

NOTIFY pgrst, 'reload schema';
