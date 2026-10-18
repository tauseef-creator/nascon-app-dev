'use strict';
// Notification bus delivery with bounded exponential retry and a persistent Dead-Letter Queue
// (spec Part II FR-5.2, 5.8 rule 4). A delivery is attempted at most MAX_ATTEMPTS times with
// backoff base, 2*base between attempts; when every attempt fails the event is written to
// dlq_events (wiped by /audit/v1/reset) and stays there for inspection.
const crypto = require('crypto');
const db = require('../../db/pool');
const { hub } = require('../../lib/realtime');
const { backoffDelayMs } = require('../../domain/day2/moderation');

const MAX_ATTEMPTS = 3;
// Kept small so the synchronous audit probe stays fast; override with NOTIFY_BACKOFF_BASE_MS.
const BASE_DELAY_MS = Number.parseInt(process.env.NOTIFY_BACKOFF_BASE_MS || '', 10) || 10;
const DLQ_LIST_LIMIT = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Default transport: in-process fan-out to WebSocket / SSE subscribers.
async function hubTransport(event) {
  hub.emit('notification', event);
}

/**
 * Deliver one notification event.
 * options.simulateFailure: every attempt fails (audit probe and tests).
 * options.transport: async (event) => void, throws on failure.
 * Returns { delivered, attempts, event_id, dlq, last_error }.
 */
async function deliver(event, options = {}) {
  const {
    simulateFailure = false,
    transport = hubTransport,
    maxAttempts = MAX_ATTEMPTS,
    baseDelayMs = BASE_DELAY_MS,
    query = db.query,
  } = options;
  const eventId = event.event_id || `evt_${crypto.randomUUID()}`;
  const payload = { ...event, event_id: eventId };

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (simulateFailure) throw new Error('simulated downstream delivery failure');
      await transport(payload);
      return { delivered: true, attempts: attempt, event_id: eventId, dlq: false, last_error: null };
    } catch (err) {
      lastError = (err && err.message) || String(err);
      if (attempt < maxAttempts) await sleep(backoffDelayMs(attempt, baseDelayMs));
    }
  }

  await query(
    'INSERT INTO dlq_events (event_id, event, attempts, last_error) VALUES ($1, $2::jsonb, $3, $4)',
    [eventId, JSON.stringify(payload), maxAttempts, lastError],
  );
  return { delivered: false, attempts: maxAttempts, event_id: eventId, dlq: true, last_error: lastError };
}

/** Number of events currently parked in the DLQ (also exported as nascon_dlq_depth). */
async function dlqDepth(query = db.query) {
  const { rows } = await query('SELECT count(*)::int AS depth FROM dlq_events');
  return rows[0].depth;
}

/** DLQ snapshot for the audit probe: { queue_depth, undelivered_events: [{event_id, attempts, last_error}] }. */
async function dlqStatus({ limit = DLQ_LIST_LIMIT, query = db.query } = {}) {
  const { rows } = await query(
    `SELECT event_id, attempts, last_error, count(*) OVER ()::int AS depth
       FROM dlq_events ORDER BY id LIMIT $1`,
    [limit],
  );
  return {
    queue_depth: rows.length ? rows[0].depth : 0,
    undelivered_events: rows.map((r) => ({ event_id: r.event_id, attempts: r.attempts, last_error: r.last_error })),
  };
}

module.exports = { MAX_ATTEMPTS, BASE_DELAY_MS, deliver, dlqDepth, dlqStatus };
