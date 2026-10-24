// Roblox admin logs → Discord: the HTTPS endpoint Roblox servers post to.
//
//   POST /api/roblox/admin-logs
//   Authorization: Bearer <ROBLOX_LOG_SHARED_SECRET>
//   Content-Type: application/json
//   { "v": 1, "sentAt": <unix seconds>, "events": [ ... ] }
//
// Answers:
//   202 { accepted, duplicates, rejected: [{ eventId, reason }] }   stored; Discord delivery follows
//   400 malformed body / stale or future sentAt          (Roblox does not retry these)
//   401 missing or wrong secret                          (never says which)
//   413 body over 64 KB
//   429 rate limited                                     (Roblox retries with backoff)
//   503 not configured, or the outbox is unavailable     (Roblox retries with backoff)
//
// The secret is checked before the body is read. The Discord channel is never taken from a request:
// it is ROBLOX_LOG_CHANNEL_ID on Railway.

import express from 'express';
import { clientAddress } from './auth.js';
import { createRobloxLogHandler } from './handler.js';

export function createRobloxLogRouter({ config, outbox, logger }) {
  const router = express.Router();
  const handler = createRobloxLogHandler({ config, outbox, logger });

  const authenticate = (req, res, next) => {
    const refused = handler.authenticate(req.headers, clientAddress(req));
    if (refused) {
      return res.status(refused.status).json(refused.body);
    }
    return next();
  };

  const parseBody = express.json({ limit: config.maxBodyBytes, strict: true, type: ['application/json'] });

  router.post('/', authenticate, parseBody, async (req, res) => {
    const answer = await handler.handle(req.body);
    return res.status(answer.status).json(answer.body);
  });

  router.all('/', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed' }));

  // body errors (too large, broken JSON) answered without details
  // eslint-disable-next-line no-unused-vars
  router.use((error, req, res, next) => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'body_too_large' });
    }
    if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
      return res.status(400).json({ error: 'invalid_json' });
    }
    logger?.error?.(`[RobloxLogs] Endpoint error: ${error?.message || error}`);
    return res.status(500).json({ error: 'internal_error' });
  });

  return router;
}
