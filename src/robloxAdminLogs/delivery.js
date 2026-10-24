// Roblox admin logs → Discord: the delivery worker.
//
// Every deliveryIntervalMs it takes due events from the outbox (oldest first), packs up to 10 embeds into
// one message (within Discord's 6000-character message limit) and sends them to the configured channel
// with every mention disabled. discord.js waits out Discord's rate limits by itself.
//
// Failures: a transient one (network, Discord 5xx, timeout) is retried with exponential backoff up to
// maxDeliveryAttempts; a missing channel / missing permission is retried slowly (an admin can fix it);
// an event Discord refuses as invalid is marked failed and never retried.
//
// Guarantee (PostgreSQL outbox): at-least-once. An accepted event is stored before Roblox gets its answer
// and stays until Discord confirms the message. If the bot stops after Discord accepted a message but
// before the outbox recorded it, that message can appear twice after the restart; otherwise each event
// appears exactly once. With the memory outbox (no PostgreSQL), events waiting during a restart are lost.

import { PermissionFlagsBits } from 'discord.js';
import { buildEmbed, buildEmbedData, embedLength } from './formatter.js';

const CONFIG_ERROR_CODES = new Set([10003, 50001, 50013]); // unknown channel, missing access, missing permissions
const INVALID_ERROR_CODES = new Set([50035, 50006]); // invalid form body, empty message
const MESSAGE_TOTAL_LIMIT = 6000;

export function backoffMs(attempts) {
  const base = Math.min(30 * 60 * 1000, 5000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

// Splits rows into messages: at most `perMessage` embeds and MESSAGE_TOTAL_LIMIT characters each.
export function packMessages(rows, perMessage = 10) {
  const messages = [];
  let current = [];
  let currentLength = 0;
  for (const row of rows) {
    const length = embedLength(buildEmbedData(row.event));
    if (current.length > 0 && (current.length >= perMessage || currentLength + length > MESSAGE_TOTAL_LIMIT)) {
      messages.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(row);
    currentLength += length;
  }
  if (current.length > 0) messages.push(current);
  return messages;
}

export class RobloxLogDelivery {
  constructor({ client, outbox, config, logger }) {
    this.client = client;
    this.outbox = outbox;
    this.config = config;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.channel = null;
    this.channelCheckedAt = 0;
    this.lastProblemLog = new Map();
    this.lastPrune = 0;
  }

  logOnce(kind, level, message, everyMs = 10 * 60 * 1000) {
    const now = Date.now();
    if (now - (this.lastProblemLog.get(kind) || 0) < everyMs) return;
    this.lastProblemLog.set(kind, now);
    this.logger?.[level]?.(message);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.logOnce('tick', 'error', `[RobloxLogs] Delivery tick failed: ${error?.message || error}`, 60_000));
    }, this.config.deliveryIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Finds the channel and checks the bot may post embeds there (logged clearly once if not).
  async resolveChannel() {
    const now = Date.now();
    if (this.channel && now - this.channelCheckedAt < 5 * 60 * 1000) return this.channel;
    this.channelCheckedAt = now;
    let channel = null;
    try {
      channel = await this.client.channels.fetch(this.config.channelId);
    } catch (error) {
      this.channel = null;
      this.logOnce('channel', 'error', `[RobloxLogs] Cannot open the Roblox log channel ${this.config.channelId} (${error?.message || error}). Is Crashdummy in that server, and does it have View Channel?`);
      return null;
    }
    if (!channel || typeof channel.send !== 'function' || !channel.isTextBased?.()) {
      this.channel = null;
      this.logOnce('channel', 'error', `[RobloxLogs] ${this.config.channelId} is not a text channel the bot can post in.`);
      return null;
    }
    const me = channel.guild?.members?.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    if (permissions) {
      const missing = [
        ['View Channel', PermissionFlagsBits.ViewChannel],
        ['Send Messages', PermissionFlagsBits.SendMessages],
        ['Embed Links', PermissionFlagsBits.EmbedLinks],
      ].filter(([, flag]) => !permissions.has(flag)).map(([name]) => name);
      if (missing.length > 0) {
        this.logOnce('permissions', 'error', `[RobloxLogs] Crashdummy is missing ${missing.join(', ')} in the Roblox log channel ${this.config.channelId}; logs wait in the outbox until this is fixed.`);
        this.channel = null;
        return null;
      }
    }
    if (!this.channel) {
      this.logger?.info?.(`[RobloxLogs] Delivering Roblox admin logs to #${channel.name || channel.id} (${channel.id}).`);
    }
    this.channel = channel;
    return channel;
  }

  async tick() {
    if (this.running) return;
    if (!this.client?.isReady?.()) return;
    this.running = true;
    try {
      if (Date.now() - this.lastPrune > 60 * 60 * 1000) {
        this.lastPrune = Date.now();
        await this.outbox.prune().catch((error) => this.logOnce('prune', 'warn', `[RobloxLogs] Outbox cleanup failed: ${error?.message || error}`));
      }
      const channel = await this.resolveChannel();
      if (!channel) return;
      const rows = await this.outbox.claim(this.config.embedsPerMessage * 3);
      if (rows.length === 0) return;
      for (const message of packMessages(rows, this.config.embedsPerMessage)) {
        await this.sendMessage(channel, message);
      }
    } finally {
      this.running = false;
    }
  }

  async sendMessage(channel, rows) {
    try {
      const sent = await channel.send({
        embeds: rows.map((row) => buildEmbed(row.event)),
        allowedMentions: { parse: [] },
      });
      await this.outbox.markSent(rows.map((row) => row.eventId), sent?.id);
    } catch (error) {
      await this.handleFailure(channel, rows, error);
    }
  }

  async handleFailure(channel, rows, error) {
    const code = Number(error?.code);
    const status = Number(error?.status);
    const message = `${error?.name || 'Error'} ${Number.isFinite(code) ? code : ''}: ${error?.message || error}`.trim();

    if (INVALID_ERROR_CODES.has(code) || status === 400) {
      if (rows.length > 1) {
        // one bad embed must not hold the others back: send them one by one
        for (const row of rows) {
          await this.sendMessage(channel, [row]);
        }
        return;
      }
      this.logOnce(`invalid-${rows[0].eventId}`, 'warn', `[RobloxLogs] Discord refused event ${rows[0].eventId}: ${message}`, 0);
      await this.outbox.markFailed(rows[0].eventId, rows[0].attempts + 1, message);
      return;
    }

    const configProblem = CONFIG_ERROR_CODES.has(code);
    if (configProblem) {
      this.channel = null; // check the channel and permissions again before the next send
      this.logOnce('config', 'error', `[RobloxLogs] Cannot post in the Roblox log channel (${message}). Check Crashdummy's access and permissions there.`);
    } else {
      this.logOnce('transient', 'warn', `[RobloxLogs] Sending to Discord failed, will retry: ${message}`, 60_000);
    }
    for (const row of rows) {
      const attempts = row.attempts + 1;
      if (!configProblem && attempts >= this.config.maxDeliveryAttempts) {
        await this.outbox.markFailed(row.eventId, attempts, message);
      } else {
        // a permission problem is waited out slowly and never gives the event up
        const delay = configProblem ? 5 * 60 * 1000 : backoffMs(attempts);
        await this.outbox.markRetry(row.eventId, configProblem ? row.attempts : attempts, delay, message);
      }
    }
  }
}
