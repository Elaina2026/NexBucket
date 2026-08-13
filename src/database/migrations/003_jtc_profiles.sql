ALTER TABLE jtc_profiles ADD COLUMN IF NOT EXISTS guild_id TEXT NOT NULL DEFAULT '';
ALTER TABLE jtc_profiles ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE jtc_profiles ADD COLUMN IF NOT EXISTS rtc_region TEXT;
ALTER TABLE jtc_profiles ADD COLUMN IF NOT EXISTS is_nsfw BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'jtc_profiles'::regclass AND c.contype = 'p';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE jtc_profiles DROP CONSTRAINT %I', constraint_name);
  END IF;
END;
$$;

ALTER TABLE jtc_profiles ADD PRIMARY KEY (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_jtc_profiles_user ON jtc_profiles (user_id);

ALTER TABLE jtc_active ADD COLUMN IF NOT EXISTS control_message_id TEXT;
ALTER TABLE jtc_active ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE jtc_active ADD COLUMN IF NOT EXISTS last_lfm_at BIGINT NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
