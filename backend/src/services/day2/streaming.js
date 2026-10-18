'use strict';
// Stream key lifecycle, MediaMTX integration and VOD indexing (spec Part II 5.4, FR-3.2).
const crypto = require('crypto');
const { query, tx } = require('../../db/pool');
const { signDay2 } = require('../../lib/signing');
const { validation, notFound } = require('../../lib/errors');
const domain = require('../../domain/day2/streaming');
const bus = require('./bus');

const KICK_BUDGET_MS = 1500;

function mediaApiBase() {
  const v = process.env.MEDIAMTX_API;
  if (v === 'off' || v === '') return null;
  return (v || 'http://mediamtx:9997').replace(/\/+$/, '');
}

// ---------------------------------------------------------------- MediaMTX control API (best effort)

async function mediaFetch(path, { method = 'GET', timeoutMs = KICK_BUDGET_MS } = {}) {
  const base = mediaApiBase();
  if (!base) return null;
  try {
    const res = await fetch(base + path, { method, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (e) {
    return null;
  }
}

// GET /v3/paths/list (all pages). Returns null when the media server is unreachable.
async function listPaths(timeoutMs = 1000) {
  const first = await mediaFetch('/v3/paths/list?itemsPerPage=1000', { timeoutMs });
  if (!first) return null;
  return Array.isArray(first.items) ? first.items : [];
}

// Source type reported by /v3/paths -> kick endpoint of that connection kind.
const KICK_BY_SOURCE = {
  rtmpConn: 'rtmpconns', rtmpsConn: 'rtmpconns',
  webRTCSession: 'webrtcsessions',
  rtspSession: 'rtspsessions', rtspsSession: 'rtspsessions',
  srtConn: 'srtconns',
};

/**
 * Severs every active publisher on live/<key> (FR-3.2: within 2 s of revoke/rotate). Never throws and
 * never takes longer than KICK_BUDGET_MS. Returns the number of kicked sessions.
 */
async function kickPublishers(keys) {
  return kickPaths(keys.map((k) => `live/${k}`));
}

// Severs the publishers of the given media paths (also used to restart a co-stream compositor).
async function kickPaths(pathNames) {
  if (!mediaApiBase() || !pathNames.length) return 0;
  const names = new Set(pathNames);
  const work = (async () => {
    const targets = new Map();
    const [paths, ...lists] = await Promise.all([
      Promise.all([...names].map((n) => mediaFetch(`/v3/paths/get/${n}`))),
      ...['rtmpconns', 'webrtcsessions', 'rtspsessions', 'srtconns'].map((kind) =>
        mediaFetch(`/v3/${kind}/list?itemsPerPage=1000`).then((r) => ({ kind, items: (r && r.items) || [] }))),
    ]);
    for (const p of paths) {
      const src = p && p.source;
      if (src && src.id && KICK_BY_SOURCE[src.type]) targets.set(src.id, KICK_BY_SOURCE[src.type]);
    }
    for (const { kind, items } of lists) {
      for (const it of items) if (it && it.state === 'publish' && names.has(it.path)) targets.set(it.id, kind);
    }
    const results = await Promise.all([...targets].map(([id, kind]) =>
      mediaFetch(`/v3/${kind}/kick/${encodeURIComponent(id)}`, { method: 'POST' })));
    return results.filter(Boolean).length;
  })().catch(() => 0);
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(0), KICK_BUDGET_MS).unref(); });
  return Promise.race([work, timeout]);
}

// ---------------------------------------------------------------- key lifecycle (5.4)

const randomHex = (n) => crypto.randomBytes(n).toString('hex');

async function upsertActiveKey(c, key, playerId, label, isOverride) {
  if (isOverride) {
    // The override is used verbatim (spec 5.4); it is (re)assigned to this player and reactivated.
    await c.query(
      `INSERT INTO stream_keys (stream_key, player_id, label, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (stream_key) DO UPDATE SET player_id = EXCLUDED.player_id, label = EXCLUDED.label,
         status = 'active', created_at = now(), revoked_at = NULL`, [key, playerId, label]);
    return key;
  }
  for (let candidate = key, i = 0; i < 5; i += 1, candidate = domain.newStreamKey(randomHex)) {
    const r = await c.query(
      `INSERT INTO stream_keys (stream_key, player_id, label, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (stream_key) DO NOTHING`, [candidate, playerId, label]);
    if (r.rowCount === 1) return candidate;
  }
  throw new Error('could not allocate a unique stream key');
}

/** POST /audit/v1/stream/key. Returns { statusCode, body }; throws ApiError. */
async function manageKey(body) {
  const v = domain.validateKeyRequest(body);
  if (!v.ok) throw validation(v.fields);
  const req = v.value;
  const out = await tx(async (c) => {
    // Serialize every key operation of one player (concurrent rotate/revoke never leaves two active keys).
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`stream-key:${req.player_id}`]);
    const player = await c.query('SELECT 1 FROM players WHERE player_id = $1', [req.player_id]);
    if (!player.rowCount) {
      throw notFound('PLAYER_NOT_FOUND', `Player ${req.player_id} does not exist.`, { player_id: req.player_id });
    }
    const { rows: existing } = await c.query(
      `SELECT stream_key, label, status FROM stream_keys WHERE player_id = $1
       ORDER BY (status = 'active') DESC, created_at DESC`, [req.player_id]);
    const plan = domain.planKeyAction(req, existing, { newKey: domain.newStreamKey(randomHex) });
    if (plan.kind === 'error') {
      throw notFound('STREAM_NOT_FOUND', `Player ${req.player_id} has no stream key.`, { player_id: req.player_id });
    }
    if (plan.revoke.length) {
      await c.query(
        `UPDATE stream_keys SET status = 'revoked', revoked_at = now() WHERE stream_key = ANY($1) AND status = 'active'`,
        [plan.revoke]);
    }
    let key = plan.key;
    let status = 'revoked';
    if (plan.kind === 'issue') {
      key = await upsertActiveKey(c, plan.key, req.player_id, plan.label, Boolean(req.stream_key_override));
      status = 'active';
    }
    const resBody = domain.keyResponse(
      { action: req.action, player_id: req.player_id, label: plan.label, stream_key: key, status }, signDay2);
    return { statusCode: plan.httpStatus, body: resBody, revoked: plan.kind === 'revoke' ? [key] : plan.revoke };
  });
  // After commit: cut live ingest on every invalidated key, then notify listeners.
  if (out.revoked.length) await kickPublishers(out.revoked);
  bus.emitStream(req.player_id, { stream_key: out.body.stream_key, status: out.body.status });
  return { statusCode: out.statusCode, body: out.body };
}

async function keyStatus(key) {
  if (typeof key !== 'string' || !key) return null;
  const { rows } = await query('SELECT status, player_id FROM stream_keys WHERE stream_key = $1', [key]);
  return rows[0] || null;
}

/** POST /audit/v1/stream/publish-check {stream_key}: 200 active, 409 KEY_REVOKED, 404 STREAM_NOT_FOUND. */
async function publishCheck(body) {
  const key = body && body.stream_key;
  if (typeof key !== 'string' || key.length === 0 || key.length > 256) throw validation(['stream_key']);
  const row = await keyStatus(key);
  const d = domain.publishCheck(row && row.status);
  return { decision: d, row, key };
}

async function sessionStatus(sessionId) {
  const { rows } = await query("SELECT response->>'status' AS status FROM costream_sessions WHERE session_id = $1", [sessionId]);
  return rows[0] || null;
}

/** MediaMTX authHTTPAddress hook body: {user,password,ip,action,path,protocol,id,query}. */
async function mediaAuth(body) {
  const input = body && typeof body === 'object' ? body : {};
  const target = domain.parseMediaPath(input.path);
  let status = null;
  let session = null;
  if (target && target.kind === 'live') status = (await keyStatus(target.key))?.status || null;
  if (target && target.kind === 'costream') session = await sessionStatus(target.id);
  return domain.mediaAuthDecision(input, status, session);
}

// ---------------------------------------------------------------- VOD indexing (FR-3.2)

const liveSince = new Map(); // path -> { at: Date, key, player_id }

/** runOnReady hook. The hook is only a signal: the stream key must exist before anything is tracked. */
async function onPathReady(path) {
  const t = domain.parseMediaPath(path);
  if (!t || t.kind !== 'live') return { tracked: false };
  const row = await keyStatus(t.key);
  if (!row || row.status !== 'active') return { tracked: false };
  liveSince.set(`live/${t.key}`, { at: new Date(), key: t.key, player_id: row.player_id });
  bus.emitStream(row.player_id, { stream_key: t.key, status: 'live' });
  // A broadcaster came online: restart the compositor of every active co-stream they belong to.
  const { rows } = await query(
    `SELECT session_id FROM costream_sessions
     WHERE response->>'status' = 'active' AND response->'active_participants' ? $1`, [row.player_id]);
  if (rows.length) kickPaths(rows.map((r) => `costream/${r.session_id}`));
  return { tracked: true };
}

/** runOnNotReady hook: indexes the finished broadcast as a VOD (recorded by MediaMTX recordPath). */
async function onPathNotReady(path) {
  const t = domain.parseMediaPath(path);
  if (!t || t.kind !== 'live') return { indexed: false };
  const name = `live/${t.key}`;
  const started = liveSince.get(name);
  if (!started) return { indexed: false };
  liveSince.delete(name);
  const durationS = Math.max(0, Math.ceil((Date.now() - started.at.getTime()) / 1000));
  // Millisecond precision: the hook fires just after recording starts, so this instant lies inside it.
  const startIso = started.at.toISOString();
  const vodId = `vod-${t.key}-${Math.floor(started.at.getTime() / 1000)}`;
  await query(
    `INSERT INTO vods (vod_id, stream_key, player_id, object_key, duration_s) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (vod_id) DO NOTHING`,
    [vodId, t.key, started.player_id, `${name}?start=${startIso}`, durationS]);
  bus.emitStream(started.player_id, { stream_key: t.key, status: 'ended', vod_id: vodId });
  return { indexed: true, vod_id: vodId };
}

const PLAYBACK_BASE = 'http://localhost:9996';
function vodPlaybackUrl(objectKey, durationS) {
  const [path, qs] = String(objectKey).split('?');
  const start = new URLSearchParams(qs || '').get('start');
  if (!start) return null;
  return `${PLAYBACK_BASE}/get?path=${encodeURIComponent(path)}&start=${encodeURIComponent(start)}&duration=${durationS || 0}s&format=mp4`;
}

async function activeKeyCount() {
  const { rows } = await query("SELECT count(*)::int AS n FROM stream_keys WHERE status = 'active'");
  return rows[0].n;
}

module.exports = {
  manageKey, publishCheck, mediaAuth, kickPublishers, kickPaths, listPaths, keyStatus,
  onPathReady, onPathNotReady, vodPlaybackUrl, activeKeyCount, mediaApiBase,
};
