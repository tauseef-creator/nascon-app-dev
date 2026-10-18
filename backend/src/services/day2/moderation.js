'use strict';
// Chat moderation service (spec Part II FR-5.3, FR-3.3 unified chat, 5.8 probe).
// Runs the pure engine in domain/day2/moderation, stores accepted messages with a per-room
// monotonically increasing seq, records kick / mute actions idempotently, and fans accepted
// messages out to live subscribers through the realtime hub ('chat', roomId, message).
//
// Concurrency: every write for a room is ONE simple-protocol query string executed by Postgres as
// a single implicit transaction:
//   SELECT pg_advisory_xact_lock(...); INSERT chat_messages ...; INSERT moderation_actions ...
// The room lock is therefore held only for server-side execution (never across Node round trips or
// event-loop lag, and with asynchronous commit not across the WAL fsync either), each statement takes a fresh READ COMMITTED snapshot after the lock, and any
// error rolls the whole batch back. All values are escaped with pg.escapeLiteral; ids are also
// pre-validated against the ID regex. Rooms never block each other; actions are written in sorted
// key order under the room lock, so concurrent identical requests cannot deadlock.
const crypto = require('crypto');
const { escapeLiteral } = require('pg');
const db = require('../../db/pool');
const { hub } = require('../../lib/realtime');
const { validation } = require('../../lib/errors');
const { isId, isStr, isInt } = require('../../lib/validate');
const engine = require('../../domain/day2/moderation');

const MAX_TEXT = 2000;
const MUTE_MS = 60 * 1000; // production mute duration after a flood / rate-limit violation
const LIST_LIMIT_MAX = 200;
// A message_id already among the room's last REPLAY_WINDOW messages is treated as a replay and not
// stored again. The window is read through the (room_id, seq) primary key, so the cost inside the
// room lock stays constant as the table grows (chat_messages has no message_id index).
const REPLAY_WINDOW = 64;

const lit = (v) => (v === null || v === undefined ? 'NULL' : escapeLiteral(String(v)));

function iso(d) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toMessage(roomId, row) {
  return {
    chat_room_id: roomId,
    seq: Number(row.seq),
    message_id: row.message_id,
    sender: row.sender,
    text: row.text,
    flagged: row.flagged,
    reason: row.reason,
    created_at: iso(row.created_at),
  };
}

function sortedActions(room, actions) {
  const keyed = new Map(actions.map((a) => [`${a.user_id}|${a.action}`, a]));
  return [...keyed.values()]
    .sort((a, b) => (a.user_id === b.user_id ? a.action.localeCompare(b.action) : a.user_id < b.user_id ? -1 : 1))
    .map((a) => `(${room}, ${lit(a.user_id)}, ${lit(a.action)})`)
    .join(', ');
}

/**
 * One atomic write for a room: messages (first occurrence of each message_id, arrival order),
 * actions recorded once (ON CONFLICT DO NOTHING) and refreshed mutes (restart the mute clock).
 * Returns the stored rows (DB shape).
 */
async function writeRoom(roomId, messages, actions, refreshed, query) {
  const room = lit(roomId);
  const statements = [
    // Asynchronous commit: the room lock is released without waiting for the WAL fsync, which
    // otherwise caps one room at roughly 1 / fsync-latency writes per second. A crash can lose the
    // last few hundred ms of chat, never corrupt it or reorder seq.
    'SET LOCAL synchronous_commit = off',
    `SELECT pg_advisory_xact_lock(hashtext(${lit(`chat:${roomId}`)}))`,
  ];
  let insertAt = -1;
  if (messages.length) {
    const values = messages
      .map((m, i) => `(${i + 1}, ${lit(m.message_id)}::text, ${lit(m.sender)}::text, ${lit(m.text)}::text, ${m.flagged ? 'true' : 'false'}, ${lit(m.reason)}::text)`)
      .join(', ');
    insertAt = statements.length;
    statements.push(`INSERT INTO chat_messages (room_id, seq, message_id, sender, text, flagged, reason)
SELECT ${room}, (SELECT COALESCE(MAX(seq), 0) FROM chat_messages WHERE room_id = ${room}) + row_number() OVER (ORDER BY v.ord),
       v.message_id, v.sender, v.text, v.flagged, v.reason
  FROM (VALUES ${values}) AS v(ord, message_id, sender, text, flagged, reason)
 WHERE v.message_id NOT IN (SELECT message_id FROM chat_messages WHERE room_id = ${room} ORDER BY seq DESC LIMIT ${REPLAY_WINDOW})
RETURNING seq, message_id, sender, text, flagged, reason, created_at`);
  }
  // Rows are written in sorted key order, so concurrent writers never deadlock on the unique index.
  if (actions.length) {
    statements.push(`INSERT INTO moderation_actions (room_id, user_id, action) VALUES ${sortedActions(room, actions)}
ON CONFLICT (room_id, user_id, action) DO NOTHING`);
  }
  if (refreshed.length) {
    statements.push(`INSERT INTO moderation_actions (room_id, user_id, action) VALUES ${sortedActions(room, refreshed)}
ON CONFLICT (room_id, user_id, action) DO UPDATE SET created_at = now()`);
  }
  const result = await query(statements.join(';\n'));
  if (insertAt < 0) return [];
  const results = Array.isArray(result) ? result : [result];
  return results[insertAt].rows;
}

// Per-room write coalescing. While one write for a room is in flight, later writes for the same
// room queue in memory and are flushed together as one statement. Each room therefore holds at
// most one pool connection per process (lock waiters never starve other endpoints of connections)
// and a busy room commits many messages per lock acquisition.
const roomQueues = new Map();
const MAX_COALESCED_MESSAGES = 500;

async function drainRoom(roomId, q) {
  while (q.pending.length) {
    const jobs = [];
    let count = 0;
    while (q.pending.length && (jobs.length === 0 || count + q.pending[0].messages.length <= MAX_COALESCED_MESSAGES)) {
      const job = q.pending.shift();
      count += job.messages.length;
      jobs.push(job);
    }
    // First occurrence of a message_id wins, across every coalesced job.
    const owner = new Map();
    const messages = [];
    const actions = [];
    const refreshed = [];
    jobs.forEach((job, j) => {
      for (const m of job.messages) {
        if (owner.has(m.message_id)) continue;
        owner.set(m.message_id, j);
        messages.push(m);
      }
      (job.refreshMute ? refreshed : actions).push(...job.actions);
    });
    try {
      const rows = await writeRoom(roomId, messages, actions, refreshed, jobs[0].query);
      const perJob = jobs.map(() => []);
      for (const r of rows) perJob[owner.get(r.message_id)].push(toMessage(roomId, r));
      jobs.forEach((job, j) => job.resolve(perJob[j].sort((a, b) => a.seq - b.seq)));
    } catch (err) {
      for (const job of jobs) job.reject(err);
    }
  }
  roomQueues.delete(roomId);
}

/**
 * Persist messages (already moderated) and moderation actions for one room atomically.
 * messages: [{message_id, sender, text, flagged, reason}] in arrival order. A message_id found in
 * the room's last REPLAY_WINDOW messages (or earlier in the same write) is skipped as a replay.
 * actions: [{user_id, action}], recorded once per (room, user, action).
 * refreshMute: upsert the actions and restart their clock (production mutes).
 * Resolves to the newly stored messages of this call, in seq order.
 */
function storeBatch(roomId, messages, actions = [], { refreshMute = false, query = db.query } = {}) {
  if (!messages.length && !actions.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    let q = roomQueues.get(roomId);
    const start = !q;
    if (!q) {
      q = { pending: [] };
      roomQueues.set(roomId, q);
    }
    q.pending.push({ messages, actions, refreshMute, query, resolve, reject });
    if (start) drainRoom(roomId, q);
  });
}

function actionsFor(evaluation) {
  return [
    ...evaluation.kicked_users.map((user_id) => ({ user_id, action: 'kick' })),
    ...evaluation.muted_users.map((user_id) => ({ user_id, action: 'mute' })),
  ];
}

function emitAll(roomId, stored) {
  for (const m of stored) hub.emit('chat', roomId, m);
}

/**
 * Audit probe core (spec 5.8): moderate a batch, persist it, broadcast accepted messages.
 * Rate limiting is evaluated within the batch only (see route notes). Returns the evaluation.
 */
async function moderateBatch(roomId, incoming, { query = db.query } = {}) {
  const evaluation = engine.evaluate(incoming, { rateLimit: true });
  const stored = await storeBatch(roomId, evaluation.filtered_messages, actionsFor(evaluation), { query });
  emitAll(roomId, stored);
  return evaluation;
}

// ---- production chat (POST /api/v1/chat, mounted by the public router) ----

// Sliding-window history per room+sender. Single API process (ADR-001); pruned when it grows.
const rateHistory = new Map();
const RATE_PRUNE_AT = 10000;

function rateKey(roomId, sender) {
  return `${roomId}\u0000${sender}`;
}

function checkRate(roomId, sender, now) {
  const key = rateKey(roomId, sender);
  const { limited, history } = engine.rateCheck(rateHistory.get(key), now);
  rateHistory.set(key, history);
  if (rateHistory.size > RATE_PRUNE_AT) {
    for (const [k, h] of rateHistory) if (!h.length || now - h[h.length - 1] >= engine.RATE_WINDOW_MS) rateHistory.delete(k);
  }
  return limited;
}

function resetRateLimits() {
  rateHistory.clear();
}

function blocked(status, code, reason, message, extra = {}) {
  return { accepted: false, blocked: { status, code, reason, message, ...extra } };
}

/**
 * Moderate and post one chat message from an authenticated member.
 * Returns { accepted: true, message } (message has seq; text may be masked, flagged true) or
 * { accepted: false, blocked: { status, code, reason, message, retry_after_s? } } where status is
 * 403 FORBIDDEN (sender kicked from the room) or 429 RATE_LIMITED (muted, flood, rate window).
 * Throws a 400 VALIDATION_ERROR ApiError on malformed input.
 */
async function postChat({ roomId, sender, text, messageId } = {}, { now = Date.now(), query = db.query } = {}) {
  const bad = [];
  if (!isId(roomId)) bad.push('chat_room_id');
  if (!isId(sender)) bad.push('sender');
  if (!isStr(text) || text.length < 1 || text.length > MAX_TEXT || text.includes('\u0000')) bad.push('text');
  if (messageId !== undefined && messageId !== null && !isId(messageId)) bad.push('message_id');
  if (bad.length) throw validation(bad);
  const id = messageId || `msg_${crypto.randomUUID()}`;

  const { rows } = await query(
    'SELECT action, created_at FROM moderation_actions WHERE room_id = $1 AND user_id = $2',
    [roomId, sender],
  );
  if (rows.some((r) => r.action === 'kick')) {
    return blocked(403, 'FORBIDDEN', 'kicked', 'You were removed from this chat room by moderation.');
  }
  const mute = rows.find((r) => r.action === 'mute');
  if (mute) {
    const left = new Date(mute.created_at).getTime() + MUTE_MS - now;
    if (left > 0) return blocked(429, 'RATE_LIMITED', 'muted', 'You are muted in this chat room.', { retry_after_s: Math.ceil(left / 1000) });
  }

  const d = engine.classify(text);
  if (d.action === 'drop') {
    await storeBatch(roomId, [], [{ user_id: sender, action: 'mute' }], { refreshMute: true, query });
    return blocked(429, 'RATE_LIMITED', d.reason, 'Message blocked: character flood.', { retry_after_s: MUTE_MS / 1000 });
  }
  if (checkRate(roomId, sender, now)) {
    await storeBatch(roomId, [], [{ user_id: sender, action: 'mute' }], { refreshMute: true, query });
    return blocked(429, 'RATE_LIMITED', engine.REASON_RATE, 'Too many messages: at most 3 per 2 seconds.', { retry_after_s: MUTE_MS / 1000 });
  }

  const msg = { message_id: id, sender, text: d.text, flagged: d.flagged, reason: d.reason };
  const actions = d.action === 'mask' ? [{ user_id: sender, action: 'kick' }] : [];
  const stored = await storeBatch(roomId, [msg], actions, { query });
  if (!stored.length) {
    // Replay of an already stored message_id: return the original row.
    const prev = await query(
      'SELECT seq, message_id, sender, text, flagged, reason, created_at FROM chat_messages WHERE room_id = $1 AND message_id = $2 ORDER BY seq LIMIT 1',
      [roomId, id],
    );
    return { accepted: true, replay: true, message: toMessage(roomId, prev.rows[0]) };
  }
  emitAll(roomId, stored);
  return { accepted: true, message: stored[0] };
}

/** Chat history for a room in seq order: { chat_room_id, messages, last_seq }. */
async function listChat(roomId, { afterSeq = 0, limit = 100, query = db.query } = {}) {
  const bad = [];
  if (!isId(roomId)) bad.push('chat_room_id');
  const after = Number(afterSeq);
  if (!Number.isSafeInteger(after) || after < 0) bad.push('after_seq');
  const lim = Number(limit);
  if (!isInt(lim) || lim < 1 || lim > LIST_LIMIT_MAX) bad.push('limit');
  if (bad.length) throw validation(bad);
  const { rows } = await query(
    `SELECT seq, message_id, sender, text, flagged, reason, created_at FROM chat_messages
      WHERE room_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [roomId, after, lim],
  );
  const messages = rows.map((r) => toMessage(roomId, r));
  return { chat_room_id: roomId, messages, last_seq: messages.length ? messages[messages.length - 1].seq : after };
}

module.exports = { MAX_TEXT, MUTE_MS, storeBatch, moderateBatch, postChat, listChat, resetRateLimits };
