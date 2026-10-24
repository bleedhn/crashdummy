// Roblox admin logs → Discord: what the endpoint does with a request (no Express here, so it can be
// tested on its own; router.js connects it to the web server).

import { envelopeSchema, eventSchema, describeZodError } from './schema.js';
import { isAuthorized, WindowCounter } from './auth.js';

export function createRobloxLogHandler({ config, outbox, logger, now = () => Date.now() }) {
  const authFailures = new WindowCounter(60_000);
  const eventLimits = new WindowCounter(60_000);

  // -> null when the request may go on, otherwise the answer to send ({ status, body })
  function authenticate(headers, address) {
    if (!config.enabled) {
      return { status: 503, body: { error: 'not_configured' } };
    }
    const time = now();
    if (authFailures.peek(`ip:${address}`, time) >= config.authFailuresPerMinutePerIp
      || authFailures.peek('total', time) >= config.authFailuresPerMinuteTotal) {
      return { status: 429, body: { error: 'too_many_failed_attempts' } };
    }
    if (!isAuthorized(headers?.authorization, config.secret)) {
      authFailures.take(`ip:${address}`, 1, Infinity, time);
      authFailures.take('total', 1, Infinity, time);
      logger?.warn?.(`[RobloxLogs] Refused a request with a missing or wrong secret from ${address}.`);
      return { status: 401, body: { error: 'unauthorized' } };
    }
    return null;
  }

  // the parsed JSON body of an authenticated request -> { status, body }
  async function handle(rawBody) {
    const envelope = envelopeSchema.safeParse(rawBody);
    if (!envelope.success) {
      return { status: 400, body: { error: 'invalid_body', detail: describeZodError(envelope.error) } };
    }
    const time = now();
    const nowSeconds = Math.floor(time / 1000);
    if (Math.abs(nowSeconds - envelope.data.sentAt) > config.maxRequestSkewSeconds) {
      return { status: 400, body: { error: 'stale_request', detail: 'sentAt is too far from the current time' } };
    }

    const accepted = [];
    const rejected = [];
    const seen = new Set();
    let duplicatesInRequest = 0;
    for (const raw of envelope.data.events) {
      const eventId = typeof raw?.eventId === 'string' ? raw.eventId.slice(0, 100) : null;
      const parsed = eventSchema.safeParse(raw);
      if (!parsed.success) {
        rejected.push({ eventId, reason: describeZodError(parsed.error) });
        continue;
      }
      const event = parsed.data;
      if (seen.has(event.eventId)) {
        duplicatesInRequest += 1;
        continue;
      }
      seen.add(event.eventId);
      if (event.timestamp > nowSeconds + config.maxFutureSeconds) {
        rejected.push({ eventId, reason: 'timestamp is in the future' });
      } else if (event.timestamp < nowSeconds - config.maxEventAgeSeconds) {
        rejected.push({ eventId, reason: 'timestamp is too old' });
      } else if (config.allowedUniverseIds.length > 0 && !config.allowedUniverseIds.includes(event.server.universeId)) {
        rejected.push({ eventId, reason: 'universe not allowed' });
      } else {
        accepted.push(event);
      }
    }

    // rate limits count events, per Roblox server (JobId) and in total; moderation is never held back
    const limited = accepted.filter((event) => event.category !== 'Moderation');
    if (limited.length > 0) {
      const perServer = new Map();
      for (const event of limited) {
        perServer.set(event.server.jobId, (perServer.get(event.server.jobId) || 0) + 1);
      }
      const overServer = [...perServer].some(([jobId, count]) => eventLimits.peek(`job:${jobId}`, time) + count > config.eventsPerMinutePerServer);
      if (overServer || eventLimits.peek('total', time) + limited.length > config.eventsPerMinuteTotal) {
        return { status: 429, body: { error: 'rate_limited' } };
      }
      for (const [jobId, count] of perServer) {
        eventLimits.take(`job:${jobId}`, count, Infinity, time);
      }
      eventLimits.take('total', limited.length, Infinity, time);
    }

    let stored = { inserted: [], duplicates: [] };
    if (accepted.length > 0) {
      try {
        stored = await outbox.insert(accepted);
      } catch (error) {
        logger?.error?.(`[RobloxLogs] Could not store ${accepted.length} event(s): ${error?.message || error}`);
        return { status: 503, body: { error: 'storage_unavailable' } };
      }
    }
    if (rejected.length > 0) {
      logger?.warn?.(`[RobloxLogs] Refused ${rejected.length} invalid event(s) from a Roblox server: ${rejected[0].reason}`);
    }
    return {
      status: 202,
      body: { accepted: stored.inserted.length, duplicates: stored.duplicates.length + duplicatesInRequest, rejected },
    };
  }

  return { authenticate, handle };
}
