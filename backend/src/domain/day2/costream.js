'use strict';
// 4-way co-stream orchestration (spec Part II 5.5, FR-3.3, edge case 1): pure rules, no DB and no HTTP.

const LAYOUTS = ['solo', 'grid_2', 'grid_4', 'spotlight'];
const DEFAULT_LAYOUT = 'grid_4';
const MAX_PARTICIPANTS = 4;
// Largest effective participant count each layout can render (absent = up to MAX_PARTICIPANTS).
const LAYOUT_CAPACITY = { solo: 1, grid_2: 2 };
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const HLS_BASE = 'http://localhost:8888';

const isStr = (v) => typeof v === 'string';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPlayerRef = (v) => isStr(v) && v.length > 0 && v.length <= 256;

/** Step 1 (schema). Returns { ok: true, value } with defaults applied, or { ok: false, fields }. */
function validateSessionRequest(body) {
  const b = isObj(body) ? body : {};
  const fields = [];
  if (!isStr(b.session_id) || !ID_RE.test(b.session_id)) fields.push('session_id');
  if (!isPlayerRef(b.host_player_id)) fields.push('host_player_id');
  const p = b.participants;
  if (!Array.isArray(p) || p.length === 0 || !p.every(isPlayerRef) || new Set(p).size !== p.length) {
    fields.push('participants');
  }
  if (b.layout !== undefined && b.layout !== null && !(isStr(b.layout) && LAYOUTS.includes(b.layout))) fields.push('layout');
  if (b.simulate_host_drop !== undefined && b.simulate_host_drop !== null && typeof b.simulate_host_drop !== 'boolean') {
    fields.push('simulate_host_drop');
  }
  if (fields.length) return { ok: false, fields };
  return {
    ok: true,
    value: {
      session_id: b.session_id,
      host_player_id: b.host_player_id,
      participants: [...p],
      layout: b.layout ?? DEFAULT_LAYOUT,
      simulate_host_drop: b.simulate_host_drop ?? false,
    },
  };
}

// Every id referenced by the request (participants plus host), deduplicated, in first-seen order.
function referencedPlayers(req) {
  return [...new Set([...req.participants, req.host_player_id])];
}

// Participant count after the simulated drop is applied.
function effectiveCount(req) {
  if (!req.simulate_host_drop) return req.participants.length;
  return req.participants.length >= 2 ? req.participants.length - 1 : 0;
}

/**
 * Steps 2b-4 after existence was checked by the caller (`missing` = ids not in the players table).
 * Returns { ok: true } or { ok: false, httpStatus, code, fields?, details }.
 */
function checkRules(req, missing = []) {
  if (missing.length) {
    return { ok: false, httpStatus: 404, code: 'PLAYER_NOT_FOUND', details: { player_ids: missing } };
  }
  if (!req.participants.includes(req.host_player_id)) {
    return { ok: false, httpStatus: 400, code: 'VALIDATION_ERROR', fields: ['host_player_id'], details: { fields: ['host_player_id'] } };
  }
  if (req.participants.length > MAX_PARTICIPANTS) {
    return {
      ok: false, httpStatus: 409, code: 'COSTREAM_SESSION_FULL',
      details: { max_participants: MAX_PARTICIPANTS, requested: req.participants.length },
    };
  }
  const cap = LAYOUT_CAPACITY[req.layout];
  const eff = effectiveCount(req);
  if (cap !== undefined && eff > cap) {
    return { ok: false, httpStatus: 400, code: 'UNSUPPORTED_LAYOUT', details: { layout: req.layout, active_participant_count: eff, max: cap } };
  }
  return { ok: true };
}

/** Step 5: deterministic host-drop handoff. Returns the session state (without URLs and signature). */
function resolveSession(req) {
  if (!req.simulate_host_drop) {
    return {
      status: 'active', active_host: req.host_player_id, handoff_occurred: false,
      participant_count: req.participants.length, active_participants: [...req.participants],
    };
  }
  if (req.participants.length >= 2) {
    // The spec computes participant_count = len - 1 and promotes the first remaining participant.
    const remaining = req.participants.filter((id) => id !== req.host_player_id);
    return {
      status: 'active', active_host: remaining[0], handoff_occurred: true,
      participant_count: req.participants.length - 1, active_participants: remaining,
    };
  }
  return { status: 'terminated', active_host: null, handoff_occurred: false, participant_count: 0, active_participants: [] };
}

function compositeUrl(sessionId) {
  return `${HLS_BASE}/costream/${sessionId}/index.m3u8`;
}

function chatRoomId(sessionId) {
  return `chat-${sessionId}`;
}

function sessionSigPayload(s) {
  return {
    active_host: s.active_host, handoff_occurred: s.handoff_occurred, layout: s.layout,
    participant_count: s.participant_count, session_id: s.session_id, status: s.status,
  };
}

/** Full 5.5 response body for a resolved state. `sign(entityId, payload)` computes the DAY2 HMAC. */
function sessionResponse(sessionId, layout, state, sign) {
  const s = { session_id: sessionId, layout, ...state };
  return {
    session_id: sessionId,
    status: s.status,
    active_host: s.active_host,
    handoff_occurred: s.handoff_occurred,
    participant_count: s.participant_count,
    active_participants: s.active_participants,
    layout,
    composite_playback_url: compositeUrl(sessionId),
    chat_room_id: chatRoomId(sessionId),
    signature: sign(sessionId, sessionSigPayload(s)),
  };
}

/**
 * Live disconnect of `playerId` (WebSocket presence, FR-3.3): removes the player from the active list.
 * If the active host left, hosting moves to the next remaining participant in array order; with nobody
 * left the session terminates. Returns { changed, state } where state has the response's dynamic fields.
 */
function applyDisconnect(current, playerId) {
  const active = Array.isArray(current.active_participants) ? current.active_participants : [];
  if (current.status !== 'active' || !active.includes(playerId)) return { changed: false, state: current };
  const remaining = active.filter((id) => id !== playerId);
  if (remaining.length === 0) {
    return {
      changed: true,
      state: { ...current, status: 'terminated', active_host: null, handoff_occurred: false, participant_count: 0, active_participants: [] },
    };
  }
  const hostLeft = current.active_host === playerId;
  return {
    changed: true,
    state: {
      ...current,
      status: 'active',
      active_host: hostLeft ? remaining[0] : current.active_host,
      handoff_occurred: hostLeft ? true : current.handoff_occurred,
      participant_count: remaining.length,
      active_participants: remaining,
    },
  };
}

/**
 * Host moderation (FR-3.3): mute / unmute / spotlight / kick a participant in a session state.
 * Returns { ok: true, state } or { ok: false, code } (NOT_PARTICIPANT, SESSION_TERMINATED, INVALID_ACTION).
 */
const CONTROL_ACTIONS = ['mute', 'unmute', 'spotlight', 'kick'];
function applyControl(current, action, playerId) {
  if (!CONTROL_ACTIONS.includes(action)) return { ok: false, code: 'INVALID_ACTION' };
  if (current.status !== 'active') return { ok: false, code: 'SESSION_TERMINATED' };
  const active = current.active_participants || [];
  if (!active.includes(playerId)) return { ok: false, code: 'NOT_PARTICIPANT' };
  const muted = new Set(current.muted || []);
  if (action === 'mute') muted.add(playerId);
  if (action === 'unmute') muted.delete(playerId);
  if (action === 'spotlight') return { ok: true, state: { ...current, spotlight: playerId } };
  if (action === 'kick') {
    const { state } = applyDisconnect(current, playerId);
    muted.delete(playerId);
    const spotlight = state.spotlight === playerId ? null : state.spotlight ?? null;
    return { ok: true, state: { ...state, muted: [...muted], spotlight } };
  }
  return { ok: true, state: { ...current, muted: [...muted] } };
}

module.exports = {
  LAYOUTS, DEFAULT_LAYOUT, MAX_PARTICIPANTS, LAYOUT_CAPACITY, CONTROL_ACTIONS,
  validateSessionRequest, referencedPlayers, effectiveCount, checkRules, resolveSession,
  compositeUrl, chatRoomId, sessionSigPayload, sessionResponse, applyDisconnect, applyControl,
};

// ---------------------------------------------------------------- composite (FR-3.3)

const TILE = { w: 640, h: 360 };
const XSTACK = { 3: '0_0|w0_0|0_h0', 4: '0_0|w0_0|0_h0|w0_h0' };
const SAFE_URL_RE = /^rtmp:\/\/[A-Za-z0-9.:-]+\/[A-Za-z0-9_.:\/-]+$/;

/**
 * FFmpeg argument list that mixes the live inputs (active participants in order, host first) into one
 * composite stream published to `output`. Every argument is free of whitespace so the media server can
 * pass the list through word splitting. Returns null when there is nothing to compose.
 * layout: solo -> first input full frame; grid_2 -> side by side; grid_4 / spotlight -> 2x2 grid
 * (spotlight puts the spotlighted participant first).
 */
function compositeArgs({ inputs, layout, output, spotlight = null }) {
  let list = (inputs || []).filter((u) => SAFE_URL_RE.test(u));
  if (!list.length || !SAFE_URL_RE.test(output || '')) return null;
  if (layout === 'spotlight' && spotlight && list.includes(spotlight)) list = [spotlight, ...list.filter((u) => u !== spotlight)];
  const cap = LAYOUT_CAPACITY[layout] || MAX_PARTICIPANTS;
  list = list.slice(0, cap);
  const n = list.length;
  const args = ['-hide_banner', '-loglevel', 'error'];
  for (const u of list) args.push('-fflags', 'nobuffer', '-i', u);
  let filter;
  if (n === 1) {
    filter = `[0:v]scale=${TILE.w * 2}:${TILE.h * 2},setsar=1[v]`;
  } else {
    const scaled = list.map((_, i) => `[${i}:v]scale=${TILE.w}:${TILE.h},setsar=1[v${i}]`).join(';');
    const labels = list.map((_, i) => `[v${i}]`).join('');
    filter = n === 2 ? `${scaled};${labels}hstack=inputs=2[v]` : `${scaled};${labels}xstack=inputs=${n}:layout=${XSTACK[n]}:fill=black[v]`;
  }
  args.push('-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-g', '50', '-b:v', '2500k',
    '-c:a', 'aac', '-b:a', '128k', '-f', 'flv', output);
  return args;
}

module.exports.compositeArgs = compositeArgs;
