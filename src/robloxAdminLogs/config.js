// Roblox admin logs → Discord: configuration (Railway environment variables only).
//
// ROBLOX_LOG_CHANNEL_ID      the Discord channel every Roblox admin log goes to (never taken from requests)
// ROBLOX_LOG_SHARED_SECRET   the dedicated secret Roblox servers send as "Authorization: Bearer <secret>"
//                            (NOT the Discord bot token; at least 32 characters)
// ROBLOX_LOG_ALLOWED_UNIVERSE_IDS  optional, comma separated: only accept events from these Roblox
//                            universes (the game's GameId), e.g. 10769457423
//
// Everything else has safe defaults and rarely needs changing.

const DEFAULT_CHANNEL_ID = '1563413821954068480';

function intFromEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

export function loadRobloxLogConfig(env = process.env) {
  const channelId = (env.ROBLOX_LOG_CHANNEL_ID || DEFAULT_CHANNEL_ID).trim();
  const secret = (env.ROBLOX_LOG_SHARED_SECRET || '').trim();
  const allowedUniverseIds = (env.ROBLOX_LOG_ALLOWED_UNIVERSE_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{1,20}$/.test(id))
    .map(Number);

  const problems = [];
  if (!/^\d{17,20}$/.test(channelId)) {
    problems.push('ROBLOX_LOG_CHANNEL_ID is not a Discord channel ID');
  }
  if (secret.length < 32) {
    problems.push('ROBLOX_LOG_SHARED_SECRET is missing or shorter than 32 characters');
  }
  if (secret && (secret === (env.DISCORD_TOKEN || '').trim() || secret === (env.TOKEN || '').trim())) {
    problems.push('ROBLOX_LOG_SHARED_SECRET must not be the Discord bot token');
  }

  return Object.freeze({
    channelId,
    secret,
    allowedUniverseIds,
    enabled: problems.length === 0,
    problems,

    route: '/api/roblox/admin-logs',
    maxBodyBytes: 64 * 1024,
    maxEventsPerRequest: 25,
    // a request's sentAt must be this close to the bot's clock (replay protection)
    maxRequestSkewSeconds: intFromEnv('ROBLOX_LOG_MAX_SKEW_SECONDS', 300, { min: 30, max: 3600 }),
    // an event older than this is refused (Roblox retries for a few minutes at most)
    maxEventAgeSeconds: intFromEnv('ROBLOX_LOG_MAX_EVENT_AGE_SECONDS', 6 * 3600, { min: 300, max: 7 * 86400 }),
    maxFutureSeconds: 300,

    // rate limits
    eventsPerMinutePerServer: intFromEnv('ROBLOX_LOG_EVENTS_PER_MINUTE_PER_SERVER', 600, { min: 10 }),
    eventsPerMinuteTotal: intFromEnv('ROBLOX_LOG_EVENTS_PER_MINUTE_TOTAL', 3000, { min: 10 }),
    authFailuresPerMinutePerIp: 10,
    authFailuresPerMinuteTotal: 120,

    // delivery to Discord
    deliveryIntervalMs: intFromEnv('ROBLOX_LOG_DELIVERY_INTERVAL_MS', 1000, { min: 250, max: 60000 }),
    embedsPerMessage: 10,
    maxDeliveryAttempts: intFromEnv('ROBLOX_LOG_MAX_DELIVERY_ATTEMPTS', 20, { min: 1, max: 100 }),
    staleSendingMs: 2 * 60 * 1000,
    retentionDays: intFromEnv('ROBLOX_LOG_RETENTION_DAYS', 30, { min: 1, max: 365 }),
  });
}
