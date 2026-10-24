// Roblox admin logs → Discord: request authentication and rate limiting.

import crypto from 'crypto';

// Constant-time comparison of the presented bearer token with the configured secret.
// Both are hashed first so the comparison never depends on (or leaks) their lengths.
export function isAuthorized(authorizationHeader, secret) {
  if (typeof authorizationHeader !== 'string' || !secret) {
    return false;
  }
  const match = /^Bearer (.+)$/.exec(authorizationHeader.trim());
  if (!match) {
    return false;
  }
  const presented = crypto.createHash('sha256').update(match[1], 'utf8').digest();
  const expected = crypto.createHash('sha256').update(secret, 'utf8').digest();
  return crypto.timingSafeEqual(presented, expected);
}

// The caller's address for rate limiting failed attempts (Railway sits behind a proxy).
export function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

// A fixed-window counter: take(key, amount, limit) -> true while under the limit.
export class WindowCounter {
  constructor(windowMs = 60_000, maxKeys = 10_000) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.entries = new Map();
  }

  take(key, amount, limit, now = Date.now()) {
    let entry = this.entries.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      entry = { start: now, count: 0 };
      this.entries.delete(key);
      this.entries.set(key, entry);
      if (this.entries.size > this.maxKeys) {
        this.entries.delete(this.entries.keys().next().value);
      }
    }
    if (entry.count + amount > limit) {
      return false;
    }
    entry.count += amount;
    return true;
  }

  peek(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      return 0;
    }
    return entry.count;
  }
}
