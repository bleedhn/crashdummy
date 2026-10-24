// Roblox admin logs → Discord: the delivery outbox.
//
// Every accepted event is written here BEFORE the HTTP request is answered, and the delivery worker
// sends from here. With PostgreSQL (the bot's normal database on Railway) the outbox survives bot
// restarts and redeploys, and the event id is the primary key, so the same event can never be stored
// twice (a retry from Roblox is recognised as a duplicate). Without PostgreSQL (degraded mode) it falls
// back to memory: nothing survives a restart then, and a warning says so.

const TABLE = 'roblox_admin_log_events';

export class PostgresOutbox {
  constructor(pool, { staleSendingMs, retentionDays }) {
    this.pool = pool;
    this.staleSendingMs = staleSendingMs;
    this.retentionDays = retentionDays;
    this.kind = 'postgres';
    this.readyPromise = null;
  }

  ready() {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS ${TABLE} (
            event_id VARCHAR(100) PRIMARY KEY,
            payload JSONB NOT NULL,
            category VARCHAR(20) NOT NULL,
            job_id VARCHAR(64),
            status VARCHAR(12) NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            claimed_at TIMESTAMPTZ,
            last_error TEXT,
            message_id VARCHAR(20),
            received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            sent_at TIMESTAMPTZ
          )`);
        await this.pool.query(
          `CREATE INDEX IF NOT EXISTS idx_${TABLE}_due ON ${TABLE} (status, next_attempt_at)`,
        );
      })().catch((error) => {
        this.readyPromise = null; // try again next time
        throw error;
      });
    }
    return this.readyPromise;
  }

  // -> { inserted: [eventId], duplicates: [eventId] }
  async insert(events) {
    await this.ready();
    const inserted = [];
    const duplicates = [];
    for (const event of events) {
      const result = await this.pool.query(
        `INSERT INTO ${TABLE} (event_id, payload, category, job_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.eventId, JSON.stringify(event), event.category, event.server.jobId],
      );
      (result.rowCount > 0 ? inserted : duplicates).push(event.eventId);
    }
    return { inserted, duplicates };
  }

  // Takes up to `limit` due events (oldest first) and marks them as being sent. An event stuck in
  // "sending" (the bot stopped mid-send) becomes due again after staleSendingMs.
  async claim(limit) {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE ${TABLE} SET status = 'sending', claimed_at = NOW()
       WHERE event_id IN (
         SELECT event_id FROM ${TABLE}
         WHERE (status = 'pending' AND next_attempt_at <= NOW())
            OR (status = 'sending' AND claimed_at < NOW() - ($2::text || ' milliseconds')::interval)
         ORDER BY received_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING event_id, payload, attempts, received_at`,
      [limit, String(this.staleSendingMs)],
    );
    return result.rows
      .map((row) => ({
        eventId: row.event_id,
        event: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        attempts: row.attempts,
        receivedAt: new Date(row.received_at).getTime(),
      }))
      .sort((a, b) => a.receivedAt - b.receivedAt);
  }

  async markSent(eventIds, messageId) {
    if (eventIds.length === 0) return;
    await this.pool.query(
      `UPDATE ${TABLE} SET status = 'sent', sent_at = NOW(), message_id = $2, last_error = NULL
       WHERE event_id = ANY($1::varchar[])`,
      [eventIds, messageId || null],
    );
  }

  async markRetry(eventId, attempts, delayMs, error) {
    await this.pool.query(
      `UPDATE ${TABLE} SET status = 'pending', attempts = $2,
         next_attempt_at = NOW() + ($3::text || ' milliseconds')::interval, last_error = $4, claimed_at = NULL
       WHERE event_id = $1`,
      [eventId, attempts, String(Math.max(0, Math.round(delayMs))), String(error || '').slice(0, 500)],
    );
  }

  async markFailed(eventId, attempts, error) {
    await this.pool.query(
      `UPDATE ${TABLE} SET status = 'failed', attempts = $2, last_error = $3, claimed_at = NULL WHERE event_id = $1`,
      [eventId, attempts, String(error || '').slice(0, 500)],
    );
  }

  // Sent and failed rows are kept for retentionDays (that is also how long duplicates are recognised).
  async prune() {
    await this.ready();
    await this.pool.query(
      `DELETE FROM ${TABLE} WHERE status IN ('sent', 'failed')
       AND received_at < NOW() - ($1::text || ' days')::interval`,
      [String(this.retentionDays)],
    );
  }

  async stats() {
    await this.ready();
    const result = await this.pool.query(`SELECT status, COUNT(*)::int AS n FROM ${TABLE} GROUP BY status`);
    return Object.fromEntries(result.rows.map((row) => [row.status, row.n]));
  }
}

export class MemoryOutbox {
  constructor({ staleSendingMs, maxRemembered = 50_000, maxPending = 5_000 } = {}) {
    this.kind = 'memory';
    this.staleSendingMs = staleSendingMs ?? 120_000;
    this.maxRemembered = maxRemembered;
    this.maxPending = maxPending;
    this.rows = new Map(); // eventId -> row (insertion order = received order)
  }

  async ready() {}

  async insert(events) {
    const inserted = [];
    const duplicates = [];
    for (const event of events) {
      if (this.rows.has(event.eventId)) {
        duplicates.push(event.eventId);
        continue;
      }
      this.rows.set(event.eventId, {
        eventId: event.eventId,
        event,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
        claimedAt: 0,
        receivedAt: Date.now(),
      });
      inserted.push(event.eventId);
    }
    this.trim();
    return { inserted, duplicates };
  }

  trim() {
    // forget the oldest finished rows first, then (only if memory must be protected) the oldest pending
    while (this.rows.size > this.maxRemembered) {
      const oldestDone = [...this.rows.values()].find((row) => row.status === 'sent' || row.status === 'failed');
      this.rows.delete((oldestDone || this.rows.values().next().value).eventId);
    }
    let pending = [...this.rows.values()].filter((row) => row.status !== 'sent' && row.status !== 'failed');
    while (pending.length > this.maxPending) {
      const dropped = pending.shift();
      dropped.status = 'failed';
      dropped.lastError = 'memory outbox full';
    }
  }

  async claim(limit, now = Date.now()) {
    const due = [];
    for (const row of this.rows.values()) {
      if (due.length >= limit) break;
      const isDue = (row.status === 'pending' && row.nextAttemptAt <= now)
        || (row.status === 'sending' && now - row.claimedAt > this.staleSendingMs);
      if (isDue) {
        row.status = 'sending';
        row.claimedAt = now;
        due.push({ eventId: row.eventId, event: row.event, attempts: row.attempts, receivedAt: row.receivedAt });
      }
    }
    return due;
  }

  async markSent(eventIds, messageId) {
    for (const id of eventIds) {
      const row = this.rows.get(id);
      if (row) {
        row.status = 'sent';
        row.messageId = messageId;
      }
    }
  }

  async markRetry(eventId, attempts, delayMs, error) {
    const row = this.rows.get(eventId);
    if (row) {
      row.status = 'pending';
      row.attempts = attempts;
      row.nextAttemptAt = Date.now() + delayMs;
      row.lastError = String(error || '');
    }
  }

  async markFailed(eventId, attempts, error) {
    const row = this.rows.get(eventId);
    if (row) {
      row.status = 'failed';
      row.attempts = attempts;
      row.lastError = String(error || '');
    }
  }

  async prune() {}

  async stats() {
    const counts = {};
    for (const row of this.rows.values()) {
      counts[row.status] = (counts[row.status] || 0) + 1;
    }
    return counts;
  }
}

export function createOutbox(client, config, logger) {
  const database = client?.db?.db;
  const pool = database?.pool;
  const available = Boolean(pool && typeof database.isAvailable === 'function' && database.isAvailable());
  if (available) {
    return new PostgresOutbox(pool, config);
  }
  logger?.warn?.(
    '[RobloxLogs] PostgreSQL is not available: Roblox admin logs are queued in memory and will not survive a restart.',
  );
  return new MemoryOutbox(config);
}
