'use strict';
// Co-stream session orchestration (spec Part II 5.5, FR-3.3, edge case 1).
const crypto = require('crypto');
const { query, tx } = require('../../db/pool');
const { signDay2, bodyHash } = require('../../lib/signing');
const { ApiError, validation, notFound, conflict, forbidden } = require('../../lib/errors');
const domain = require('../../domain/day2/costream');
const bus = require('./bus');

const lockSession = (c, sessionId) => c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`costream:${sessionId}`]);

// Stored state = response fields + host controls. JSONB does not keep key order, so the public
// response is rebuilt in the exact field order of spec 5.5.
const RESPONSE_FIELDS = ['session_id', 'status', 'active_host', 'handoff_occurred', 'participant_count',
  'active_participants', 'layout', 'composite_playback_url', 'chat_room_id', 'signature'];
function publicView(state) {
  const out = {};
  for (const k of RESPONSE_FIELDS) out[k] = state[k];
  return out;
}

function resign(state) {
  return domain.sessionResponse(state.session_id, state.layout, {
    status: state.status, active_host: state.active_host, handoff_occurred: state.handoff_occurred,
    participant_count: state.participant_count, active_participants: state.active_participants,
  }, signDay2);
}

/**
 * POST /audit/v1/costream/session. Returns { statusCode, body }.
 * Identical replay (same session_id and same normalized body) -> 200 with the stored response.
 * A different body for an existing session_id re-evaluates the session (e.g. the host drops after
 * the session was created) and answers 201 with the new state; chat_room_id and the composite URL
 * are derived from session_id, so they never change.
 */
async function createSession(body) {
  const v = domain.validateSessionRequest(body);
  if (!v.ok) throw validation(v.fields);
  const req = v.value;
  const hash = bodyHash(req);
  const result = await tx(async (c) => {
    await lockSession(c, req.session_id);
    const prev = await c.query('SELECT body_hash, response FROM costream_sessions WHERE session_id = $1', [req.session_id]);
    if (prev.rowCount && prev.rows[0].body_hash === hash) {
      return { statusCode: 200, body: publicView(prev.rows[0].response), changed: false };
    }
    const ids = domain.referencedPlayers(req);
    const found = await c.query('SELECT player_id FROM players WHERE player_id = ANY($1)', [ids]);
    const have = new Set(found.rows.map((r) => r.player_id));
    const rule = domain.checkRules(req, ids.filter((id) => !have.has(id)));
    if (!rule.ok) {
      if (rule.code === 'VALIDATION_ERROR') throw validation(rule.fields, 'host_player_id must be one of participants.');
      const messages = {
        PLAYER_NOT_FOUND: 'One or more players do not exist.',
        COSTREAM_SESSION_FULL: 'A co-stream supports at most 4 concurrent broadcasters.',
        UNSUPPORTED_LAYOUT: `Layout ${req.layout} cannot fit the active participant count.`,
      };
      throw new ApiError(rule.httpStatus, rule.code, messages[rule.code], rule.details);
    }
    const response = domain.sessionResponse(req.session_id, req.layout, domain.resolveSession(req), signDay2);
    const stored = { ...response, host_player_id: req.host_player_id, participants: req.participants, muted: [], spotlight: null };
    await c.query(
      `INSERT INTO costream_sessions (session_id, body_hash, status_code, response) VALUES ($1, $2, 201, $3)
       ON CONFLICT (session_id) DO UPDATE SET body_hash = EXCLUDED.body_hash, status_code = 201,
         response = EXCLUDED.response, created_at = now()`,
      [req.session_id, hash, JSON.stringify(stored)]);
    return { statusCode: 201, body: response, changed: true };
  });
  if (result.changed) {
    bus.emitCostream(req.session_id, result.body);
    restartCompositor(req.session_id);
  }
  return { statusCode: result.statusCode, body: result.body };
}

async function getSession(sessionId) {
  const { rows } = await query('SELECT response FROM costream_sessions WHERE session_id = $1', [sessionId]);
  if (!rows.length) throw notFound('STREAM_NOT_FOUND', `Co-stream session ${sessionId} does not exist.`, { session_id: sessionId });
  return rows[0].response;
}

// Applies `fn(state) -> { changed, state }` to the stored session under the session lock.
async function mutate(sessionId, fn) {
  const out = await tx(async (c) => {
    await lockSession(c, sessionId);
    const { rows } = await c.query('SELECT response FROM costream_sessions WHERE session_id = $1', [sessionId]);
    if (!rows.length) throw notFound('STREAM_NOT_FOUND', `Co-stream session ${sessionId} does not exist.`, { session_id: sessionId });
    const res = fn(rows[0].response);
    if (!res.changed) return { changed: false, state: rows[0].response };
    const next = { ...res.state, ...resign(res.state) };
    await c.query('UPDATE costream_sessions SET response = $2 WHERE session_id = $1', [sessionId, JSON.stringify(next)]);
    return { changed: true, state: next };
  });
  if (out.changed) {
    bus.emitCostream(sessionId, { ...publicView(out.state), muted: out.state.muted || [], spotlight: out.state.spotlight ?? null });
    restartCompositor(sessionId);
  }
  return out;
}

// ---------------------------------------------------------------- composite (FR-3.3)

// The media server re-runs the compositor on demand (runOnDemandRestart), so kicking its publisher
// rebuilds the grid with the new participants; a terminated session gets no new compositor.
function restartCompositor(sessionId) {
  require('./streaming').kickPaths([`costream/${sessionId}`]).catch(() => {});
}

/**
 * FFmpeg arguments for the compositor of costream/<session_id> (called by MediaMTX runOnDemand).
 * Inputs: active participants that are live right now, active host first. Returns null if none.
 */
async function compositePlan(sessionId) {
  const { rows } = await query('SELECT response FROM costream_sessions WHERE session_id = $1', [sessionId]);
  const s = rows[0] && rows[0].response;
  if (!s || s.status !== 'active') return null;
  const order = [s.active_host, ...(s.active_participants || []).filter((p) => p !== s.active_host)].filter(Boolean);
  const keys = await query(
    "SELECT player_id, stream_key FROM stream_keys WHERE status = 'active' AND player_id = ANY($1) ORDER BY created_at DESC",
    [order]);
  const keyOf = new Map();
  for (const r of keys.rows) if (!keyOf.has(r.player_id)) keyOf.set(r.player_id, r.stream_key);
  const paths = await require('./streaming').listPaths(1000);
  const ready = new Set((paths || []).filter((p) => p && p.ready).map((p) => p.name));
  // Read each broadcaster's HLS feed: MediaMTX starts it on a keyframe, so the mix never decodes from a
  // grey base (browser WebRTC publishers send keyframes only on request), and Opus/AAC both decode.
  const url = (pid) => `http://localhost:8888/live/${keyOf.get(pid)}/index.m3u8`;
  const live = order.filter((pid) => keyOf.has(pid) && (paths === null || ready.has(`live/${keyOf.get(pid)}`)));
  const spotlight = s.spotlight && live.includes(s.spotlight) ? url(s.spotlight) : null;
  return domain.compositeArgs({
    inputs: live.map(url), layout: s.layout, spotlight, output: `rtsp://localhost:8554/costream/${sessionId}`,
  });
}

/** Live presence loss of a broadcaster (WebSocket close): deterministic handoff within the request. */
async function handleDisconnect(sessionId, playerId) {
  return mutate(sessionId, (s) => domain.applyDisconnect(s, playerId));
}

// ---------------------------------------------------------------- host controls (FR-3.3)

function inviteSecret() {
  return process.env.DAY2_SALT ?? '';
}

/** Signed invite token for a squad member: base64url(payload) + "." + HMAC (DAY2_SALT). */
function makeInvite(sessionId, playerId, ttlSeconds = 3600) {
  const payload = { session_id: sessionId, player_id: playerId, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${body}.${signDay2(sessionId, payload, inviteSecret())}`, ...payload };
}

function verifyInvite(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload.session_id !== 'string') return null;
  const expected = signDay2(payload.session_id, payload, inviteSecret());
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number.isInteger(payload.exp) || payload.exp < Date.now() / 1000) return null;
  return payload;
}

// Only the current active host (by JWT player_id) may moderate the session.
function assertHost(state, principal) {
  if (!principal || !principal.player_id || principal.player_id !== state.active_host) {
    throw forbidden('Only the active host can perform this action.');
  }
}

async function invite(sessionId, principal, playerId) {
  if (typeof playerId !== 'string' || !playerId) throw validation(['player_id']);
  const state = await getSession(sessionId);
  const p = await query('SELECT 1 FROM players WHERE player_id = $1', [playerId]);
  if (!p.rowCount) throw notFound('PLAYER_NOT_FOUND', `Player ${playerId} does not exist.`, { player_id: playerId });
  assertHost(state, principal);
  if ((state.active_participants || []).length >= domain.MAX_PARTICIPANTS && !state.active_participants.includes(playerId)) {
    throw conflict('COSTREAM_SESSION_FULL', 'A co-stream supports at most 4 concurrent broadcasters.');
  }
  return makeInvite(sessionId, playerId);
}

/** Accepts an invite: the invited player joins the active list (respecting capacity and layout). */
async function join(sessionId, principal, token) {
  const inv = verifyInvite(token);
  if (!inv || inv.session_id !== sessionId) throw validation(['invite_token'], 'Invalid or expired invite token.');
  if (!principal || principal.player_id !== inv.player_id) throw forbidden('This invite belongs to another player.');
  const out = await mutate(sessionId, (s) => {
    if (s.status !== 'active') throw conflict('COSTREAM_TERMINATED', 'The co-stream session has ended.');
    if (s.active_participants.includes(inv.player_id)) return { changed: false, state: s };
    if (s.active_participants.length >= domain.MAX_PARTICIPANTS) {
      throw conflict('COSTREAM_SESSION_FULL', 'A co-stream supports at most 4 concurrent broadcasters.');
    }
    const active = [...s.active_participants, inv.player_id];
    const cap = domain.LAYOUT_CAPACITY[s.layout];
    if (cap !== undefined && active.length > cap) {
      throw new ApiError(400, 'UNSUPPORTED_LAYOUT', `Layout ${s.layout} cannot fit the active participant count.`, {});
    }
    return { changed: true, state: { ...s, active_participants: active, participant_count: active.length } };
  });
  return publicView(out.state);
}

async function control(sessionId, principal, action, playerId) {
  if (!domain.CONTROL_ACTIONS.includes(action)) throw validation(['action']);
  const out = await mutate(sessionId, (s) => {
    assertHost(s, principal);
    const r = domain.applyControl(s, action, playerId);
    if (!r.ok && r.code === 'NOT_PARTICIPANT') throw notFound('PLAYER_NOT_FOUND', `${playerId} is not an active participant.`, { player_id: playerId });
    if (!r.ok) throw conflict('COSTREAM_TERMINATED', 'The co-stream session has ended.');
    return { changed: true, state: r.state };
  });
  return { ...publicView(out.state), muted: out.state.muted || [], spotlight: out.state.spotlight ?? null };
}

module.exports = {
  createSession, getSession, handleDisconnect, invite, join, control, makeInvite, verifyInvite, publicView, compositePlan,
};
