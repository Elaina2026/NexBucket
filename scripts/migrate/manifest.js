export const TABLES = [
  table('guild_settings', ['guild_id'], {
    json: ['ticket', 'welcome', 'jtc', 'moderation', 'bank', 'card', 'server_stats', 'minecraft', 'utility'],
    integers: ['version'], timestamps: ['updated_at'],
  }),
  table('giveaways', ['message_id'], {
    json: ['entries'], booleans: ['ended'], integers: ['winners_count', 'end_time'],
  }),
  table('blacklist', ['user_id'], { timestamps: ['added_at'] }),
  table('jtc_profiles', ['guild_id', 'user_id'], {
    booleans: ['is_locked', 'is_hidden', 'is_nsfw'], integers: ['limit', 'bitrate'],
  }),
  table('jtc_active', ['channel_id'], { integers: ['last_lfm_at'] }),
  table('afk_data', ['user_id', 'guild_id'], { integers: ['timestamp'] }),
  table('autoresponder_data', ['guild_id'], { json: ['triggers_json'], transform: rewriteLearnMedia }),
  table('bot_whitelist', ['guild_id', 'bot_id'], { timestamps: ['added_at'] }),
  table('moderation', ['guild_id'], { json: ['warnings_json', 'tempbans_json', 'hardmutes_json', 'mutes_json'] }),
  table('reminders', ['id'], {
    json: ['weekdays', 'embed'], booleans: ['done', 'paused'],
    integers: ['id', 'end_time', 'created_at', 'processing_at', 'day_of_month', 'retry_count', 'last_run_at'],
  }),
  table('user_economy', ['user_id'], { integers: ['balance'], timestamps: ['updated_at'] }),
  table('card_transactions', ['request_id'], {
    integers: ['amount', 'status', 'declared_value', 'card_value', 'card_actual_value', 'received_amount'],
    timestamps: ['created_at', 'updated_at'],
  }),
  table('bot_roles', ['guild_id'], { timestamps: ['created_at'] }),
  table('incidents', ['id'], { timestamps: ['timestamp'] }),
  table('uptime_checks', ['id'], { integers: ['id'], timestamps: ['timestamp'] }),
  table('bank_transactions', ['id'], {
    integers: ['id', 'order_code', 'amount'], timestamps: ['created_at', 'updated_at', 'paid_at'],
  }),
  table('bot_activities', ['id'], { integers: ['id'], timestamps: ['timestamp'] }),
  table('user_sessions', ['session_id'], { timestamps: ['expires_at', 'created_at', 'updated_at'] }),
  table('ticket_transcripts', ['id'], { json: ['messages'], timestamps: ['created_at', 'expires_at'] }),
  table('security_logs', ['id'], { integers: ['id'], timestamps: ['timestamp'] }),
  table('bot_growth_snapshots', ['id'], {
    integers: ['id', 'guild_count', 'user_count', 'avg_ping'], timestamps: ['timestamp'],
  }),
  table('guild_config_history', ['id'], {
    json: ['changed_sections', 'before_config', 'after_config'],
    integers: ['id', 'version', 'previous_version', 'rollback_from_id'], timestamps: ['created_at'],
  }),
  table('tickets', ['channel_id'], {
    timestamps: [
      'created_at', 'claimed_at', 'first_response_at', 'closed_at', 'claim_due_at',
      'first_response_due_at', 'last_escalated_at', 'escalation_claimed_at',
    ],
  }),
  table('moderation_case_counters', ['guild_id'], { integers: ['next_number'] }),
  table('moderation_cases', ['id'], {
    integers: ['id', 'case_number', 'duration_ms'],
    timestamps: ['expires_at', 'revoked_at', 'created_at', 'updated_at'],
  }),
  table('schedule_runs', ['id'], {
    integers: ['id', 'reminder_id', 'scheduled_for'], timestamps: ['started_at', 'completed_at'],
  }),
  table('jtc_party_queue', ['id'], {
    json: ['members'], integers: ['party_size'],
    timestamps: ['expires_at', 'confirmation_expires_at', 'created_at', 'updated_at'],
  }),
  table('jtc_party_members', ['queue_id', 'user_id'], {
    booleans: ['active'], timestamps: ['joined_at'],
  }),
  table('privacy_requests', ['id'], {
    json: ['categories', 'result'], integers: ['id'], timestamps: ['requested_at', 'reviewed_at'],
  }),
];

export const TABLE_BY_NAME = new Map(TABLES.map(entry => [entry.name, entry]));
export const SOURCE_INFRASTRUCTURE_TABLES = new Set(['schema_migrations']);
export const TARGET_INFRASTRUCTURE_TABLES = new Set(['schema_migrations', 'migration_state', 'sqlite_sequence']);

function table(name, primaryKey, options = {}) {
  return Object.freeze({
    name,
    primaryKey: Object.freeze(primaryKey),
    json: new Set(options.json || []),
    booleans: new Set(options.booleans || []),
    integers: new Set(options.integers || []),
    timestamps: new Set(options.timestamps || []),
    transform: options.transform || null,
  });
}

function validLocalMediaKey(key) {
  const segments = String(key || '').split('/');
  return segments.length === 2
    && /^\d{17,20}$/.test(segments[0])
    && /^[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif|mp4|webm)$/i.test(segments[1])
    && !segments.some(segment => !segment || segment === '.' || segment === '..');
}

export function objectPublicUrl(key) {
  if (!validLocalMediaKey(key)) throw new TypeError('Invalid local media key');
  return `/media/${String(key).split('/').map(encodeURIComponent).join('/')}`;
}

function mediaPathFromSourceUrl(value, context) {
  if (!value || !context.sourceSupabaseUrl) return '';
  try {
    const source = new URL(context.sourceSupabaseUrl);
    const url = new URL(value);
    const bucket = encodeURIComponent(context.sourceBucket || 'learn-images');
    const prefixes = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
    ];
    const prefix = prefixes.find(candidate => url.pathname.startsWith(candidate));
    if (url.origin !== source.origin || !prefix) return '';
    return url.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
  } catch {
    return '';
  }
}

function mediaMimeType(key, fallback = '') {
  const extension = String(key).match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  return {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', webm: 'video/webm',
  }[extension] || fallback;
}

export function rewriteLearnMedia(row, context = {}) {
  const triggers = row.triggers_json;
  if (!triggers || typeof triggers !== 'object' || Array.isArray(triggers)) return row;
  const rewritten = {};
  for (const [trigger, rawEntry] of Object.entries(triggers)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      rewritten[trigger] = rawEntry;
      continue;
    }
    const mediaPath = String(
      rawEntry.mediaPath
      || rawEntry.imagePath
      || mediaPathFromSourceUrl(rawEntry.mediaUrl || rawEntry.imageUrl, context)
    );
    if (!mediaPath) {
      if (rawEntry.mediaUrl || rawEntry.imageUrl) {
        throw new TypeError(`Unmigratable Learn media URL for trigger: ${trigger}`);
      }
      rewritten[trigger] = rawEntry;
      continue;
    }
    if (!validLocalMediaKey(mediaPath)) throw new TypeError(`Invalid Learn media key for trigger: ${trigger}`);
    const { imagePath, imageUrl, ...neutral } = rawEntry;
    rewritten[trigger] = {
      ...neutral,
      mediaPath,
      mediaUrl: objectPublicUrl(mediaPath),
      mediaType: mediaMimeType(mediaPath, rawEntry.mediaType),
    };
  }
  return { ...row, triggers_json: rewritten };
}
