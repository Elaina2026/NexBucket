PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  ticket TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ticket) AND json_type(ticket) = 'object'),
  welcome TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(welcome) AND json_type(welcome) = 'object'),
  jtc TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(jtc) AND json_type(jtc) = 'object'),
  moderation TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(moderation) AND json_type(moderation) = 'object'),
  bank TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(bank) AND json_type(bank) = 'object'),
  card TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(card) AND json_type(card) = 'object'),
  server_stats TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(server_stats) AND json_type(server_stats) = 'object'),
  minecraft TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(minecraft) AND json_type(minecraft) = 'object'),
  utility TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(utility) AND json_type(utility) = 'object'),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS giveaways (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  winners_count INTEGER NOT NULL CHECK (winners_count > 0),
  end_time INTEGER NOT NULL,
  host_id TEXT NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0 CHECK (ended IN (0, 1)),
  entries TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(entries) AND json_type(entries) = 'array'),
  duration_str TEXT
);
CREATE INDEX IF NOT EXISTS idx_giveaways_pending ON giveaways (end_time) WHERE ended = 0;

CREATE TABLE IF NOT EXISTS blacklist (
  user_id TEXT PRIMARY KEY,
  reason TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS jtc_profiles (
  guild_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL,
  name TEXT,
  "limit" INTEGER NOT NULL DEFAULT 0 CHECK ("limit" BETWEEN 0 AND 99),
  bitrate INTEGER NOT NULL DEFAULT 64000 CHECK (bitrate >= 8000),
  status TEXT,
  rtc_region TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  is_nsfw INTEGER NOT NULL DEFAULT 0 CHECK (is_nsfw IN (0, 1)),
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_jtc_profiles_user ON jtc_profiles (user_id);

CREATE TABLE IF NOT EXISTS jtc_active (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  control_message_id TEXT,
  status TEXT,
  last_lfm_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jtc_active_guild ON jtc_active (guild_id);

CREATE TABLE IF NOT EXISTS afk_data (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  reason TEXT,
  timestamp INTEGER,
  PRIMARY KEY (user_id, guild_id)
);

CREATE TABLE IF NOT EXISTS autoresponder_data (
  guild_id TEXT PRIMARY KEY,
  triggers_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(triggers_json) AND json_type(triggers_json) = 'object')
);

CREATE TABLE IF NOT EXISTS bot_whitelist (
  guild_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  added_by TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (guild_id, bot_id)
);

CREATE TABLE IF NOT EXISTS moderation (
  guild_id TEXT PRIMARY KEY,
  warnings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(warnings_json) AND json_type(warnings_json) = 'object'),
  tempbans_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tempbans_json) AND json_type(tempbans_json) = 'object'),
  hardmutes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(hardmutes_json) AND json_type(hardmutes_json) = 'object'),
  mutes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(mutes_json) AND json_type(mutes_json) = 'object')
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  end_time INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  processing_at INTEGER,
  target_type TEXT NOT NULL DEFAULT 'dm' CHECK (target_type IN ('dm', 'channel')),
  guild_id TEXT,
  channel_id TEXT,
  recurrence TEXT CHECK (recurrence IS NULL OR recurrence IN ('once', 'daily', 'weekly', 'monthly')),
  time_zone TEXT,
  local_time TEXT,
  weekdays TEXT CHECK (weekdays IS NULL OR (json_valid(weekdays) AND json_type(weekdays) = 'array')),
  day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28),
  embed TEXT CHECK (embed IS NULL OR (json_valid(embed) AND json_type(embed) = 'object')),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_run_at INTEGER,
  CHECK (
    (target_type = 'dm' AND guild_id IS NULL AND channel_id IS NULL AND recurrence IS NULL AND time_zone IS NULL AND local_time IS NULL AND weekdays IS NULL AND day_of_month IS NULL AND embed IS NULL)
    OR
    (target_type = 'channel' AND guild_id IS NOT NULL AND channel_id IS NOT NULL AND recurrence IN ('once', 'daily', 'weekly', 'monthly') AND time_zone IS NOT NULL AND local_time IS NOT NULL
      AND (recurrence <> 'weekly' OR weekdays IS NOT NULL)
      AND (recurrence <> 'monthly' OR day_of_month IS NOT NULL))
  )
);
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (end_time) WHERE done = 0;
CREATE INDEX IF NOT EXISTS idx_reminders_user_pending ON reminders (user_id, end_time) WHERE done = 0;
CREATE INDEX IF NOT EXISTS idx_reminders_channel_pending ON reminders (guild_id, channel_id, end_time) WHERE done = 0 AND target_type = 'channel';
CREATE INDEX IF NOT EXISTS idx_reminders_due_active ON reminders (end_time) WHERE done = 0 AND paused = 0;

CREATE TABLE IF NOT EXISTS user_economy (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS card_transactions (
  request_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  telco TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  serial TEXT NOT NULL,
  code TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 99,
  declared_value INTEGER,
  card_value INTEGER,
  card_actual_value INTEGER,
  received_amount INTEGER,
  message TEXT,
  channel_id TEXT,
  message_id TEXT,
  trans_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_card_transactions_pending ON card_transactions (created_at) WHERE status IN (0, 4, 99);
CREATE INDEX IF NOT EXISTS idx_card_transactions_guild ON card_transactions (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bot_roles (
  guild_id TEXT PRIMARY KEY,
  owner_role_id TEXT,
  admin_role_id TEXT,
  dev_role_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  severity TEXT NOT NULL,
  module TEXT NOT NULL,
  message TEXT NOT NULL,
  guild_id TEXT,
  guild_name TEXT,
  stack TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON incidents (timestamp DESC);

CREATE TABLE IF NOT EXISTS uptime_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  service_id TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uptime_service_time ON uptime_checks (service_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code INTEGER UNIQUE NOT NULL,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  channel_id TEXT,
  message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_guild ON bank_transactions (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_pending ON bank_transactions (created_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS bot_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  guild_id TEXT,
  guild_name TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_bot_activities_timestamp ON bot_activities (timestamp DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  discriminator TEXT,
  avatar TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS ticket_transcripts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  ticket_name TEXT NOT NULL,
  password TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  claimed_by TEXT,
  creator_id TEXT,
  messages TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(messages) AND json_type(messages) = 'array'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_transcripts_expires ON ticket_transcripts (expires_at);
CREATE INDEX IF NOT EXISTS idx_ticket_transcripts_guild_created ON ticket_transcripts (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_logs_timestamp ON security_logs (timestamp DESC);

CREATE TABLE IF NOT EXISTS bot_growth_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  guild_count INTEGER NOT NULL DEFAULT 0,
  user_count INTEGER NOT NULL DEFAULT 0,
  memory_mb REAL NOT NULL DEFAULT 0,
  avg_ping INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_growth_timestamp ON bot_growth_snapshots (timestamp ASC);

CREATE TABLE IF NOT EXISTS guild_config_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  previous_version INTEGER NOT NULL CHECK (previous_version >= 0),
  changed_sections TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(changed_sections) AND json_type(changed_sections) = 'array'),
  before_config TEXT NOT NULL CHECK (json_valid(before_config) AND json_type(before_config) = 'object'),
  after_config TEXT NOT NULL CHECK (json_valid(after_config) AND json_type(after_config) = 'object'),
  actor_id TEXT,
  actor_name TEXT,
  source TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('dashboard', 'discord', 'system', 'rollback', 'import', 'wizard')),
  rollback_from_id INTEGER REFERENCES guild_config_history(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_guild_config_history_guild_version ON guild_config_history (guild_id, version DESC, id DESC);

CREATE TABLE IF NOT EXISTS tickets (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  claimed_at TEXT,
  claimed_by TEXT,
  first_response_at TEXT,
  first_response_by TEXT,
  closed_at TEXT,
  closed_by TEXT,
  claim_due_at TEXT,
  first_response_due_at TEXT,
  sla_state TEXT NOT NULL DEFAULT 'pending' CHECK (sla_state IN ('pending', 'met', 'breached', 'disabled')),
  last_escalated_at TEXT,
  escalation_claimed_at TEXT,
  CHECK ((status = 'open' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL)),
  CHECK ((claimed_at IS NULL AND claimed_by IS NULL) OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_created ON tickets (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_open_claim_due ON tickets (claim_due_at) WHERE status = 'open' AND claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_open_response_due ON tickets (first_response_due_at) WHERE status = 'open' AND first_response_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_escalation_claim ON tickets (escalation_claimed_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS moderation_case_counters (
  guild_id TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0)
);

CREATE TABLE IF NOT EXISTS moderation_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  case_number INTEGER NOT NULL CHECK (case_number > 0),
  action TEXT NOT NULL CHECK (action IN ('warn', 'ban', 'tempban', 'unban', 'kick', 'timeout', 'removetimeout', 'mute', 'unmute', 'hardmute', 'revoke')),
  target_id TEXT NOT NULL,
  moderator_id TEXT,
  reason TEXT NOT NULL DEFAULT 'No reason provided',
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0),
  expires_at TEXT,
  evidence_url TEXT,
  evidence_text TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  source TEXT NOT NULL DEFAULT 'discord' CHECK (source IN ('discord', 'prefix', 'dashboard', 'system')),
  revoked_by TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (guild_id, case_number)
);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_guild_created ON moderation_cases (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_target ON moderation_cases (guild_id, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_cases_expiry ON moderation_cases (expires_at) WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  scheduled_for INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'sent', 'failed')),
  error TEXT,
  UNIQUE (reminder_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_reminder ON schedule_runs (reminder_id, started_at DESC);

CREATE TABLE IF NOT EXISTS jtc_party_queue (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  game TEXT NOT NULL,
  rank TEXT,
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 2 AND 10),
  members TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(members) AND json_type(members) = 'array'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_confirmation', 'confirming', 'confirmed', 'cancelled', 'expired')),
  expires_at TEXT NOT NULL,
  confirmation_expires_at TEXT,
  lfm_channel_id TEXT NOT NULL,
  message_id TEXT,
  voice_channel_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_jtc_party_queue_pending ON jtc_party_queue (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_jtc_party_queue_guild ON jtc_party_queue (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jtc_party_members (
  queue_id TEXT NOT NULL REFERENCES jtc_party_queue(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (queue_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jtc_party_member_active ON jtc_party_members (guild_id, user_id) WHERE active = 1;

CREATE TABLE IF NOT EXISTS privacy_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('export', 'delete')),
  categories TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories) AND json_type(categories) = 'array' AND json_array_length(categories) BETWEEN 1 AND 8),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reviewed_at TEXT,
  reviewed_by TEXT,
  owner_note TEXT,
  result TEXT CHECK (result IS NULL OR json_valid(result))
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests (status, requested_at);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_user ON privacy_requests (user_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_requests_pending_delete ON privacy_requests (user_id) WHERE status = 'pending' AND request_type = 'delete';
