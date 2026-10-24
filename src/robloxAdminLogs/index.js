// Roblox admin logs → Discord (2026-10-24)
//
// Every Roblox game server posts its admin-panel, moderation and anti-cheat logs to
// POST /api/roblox/admin-logs on this bot's existing web server (Railway's public domain). They are
// validated, stored in the outbox and posted by Crashdummy as embeds in ROBLOX_LOG_CHANNEL_ID.
//
//   app.js:  mountRobloxAdminLogs(app, client)   in startWebServer, before the other middleware
//            startRobloxAdminLogDelivery(client)   after the Discord login
//            stopRobloxAdminLogDelivery()          on shutdown
//
// Setup and tests: see README.md, "Roblox admin logs".

import { loadRobloxLogConfig } from './config.js';
import { createOutbox } from './store.js';
import { createRobloxLogRouter } from './router.js';
import { RobloxLogDelivery } from './delivery.js';
import { logger } from '../../utils/logger.js';

let state = null;

function init(client) {
  if (!state) {
    const config = loadRobloxLogConfig();
    const outbox = createOutbox(client, config, logger);
    state = { config, outbox, delivery: null };
    if (!config.enabled) {
      logger.warn(`[RobloxLogs] Roblox admin logs are OFF: ${config.problems.join('; ')}.`);
    } else {
      outbox.ready().catch((error) => logger.error(`[RobloxLogs] Could not prepare the outbox table: ${error?.message || error}`));
    }
  }
  return state;
}

export function mountRobloxAdminLogs(app, client) {
  const { config, outbox } = init(client);
  app.use(config.route, createRobloxLogRouter({ config, outbox, logger }));
}

export function startRobloxAdminLogDelivery(client) {
  const current = init(client);
  if (!current.config.enabled || current.delivery) return;
  current.delivery = new RobloxLogDelivery({ client, outbox: current.outbox, config: current.config, logger });
  current.delivery.start();
  logger.info(`[RobloxLogs] Delivery started (${current.outbox.kind} outbox) to channel ${current.config.channelId}.`);
}

export function stopRobloxAdminLogDelivery() {
  state?.delivery?.stop();
}
