'use strict';
// Stream key lifecycle (spec Part II 5.4, FR-3.2): pure rules, no DB and no HTTP.

const ACTIONS = ['generate', 'rotate', 'revoke'];
const STREAM_KEY_RE = /^sk_live_[a-f0-9]{16}$/;
const DEFAULT_LABEL = 'default';
const MAX_OVERRIDE_LEN = 128;
// Override keys end up in media URLs, so whitespace and path separators are rejected.
const OVERRIDE_RE = /^[^\s/?#]+$/;

const MEDIA = {
  rtmp: 'rtmp://localhost:1935',
  webrtc: 'http://localhost:8889',
  hls: 'http://localhost:8888',
};

const isStr = (v) => typeof v === 'string';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validates the request body. Returns { ok: true, value } or { ok: false, fields }.
 * Missing optional fields (label, stream_key_override) may be undefined or null.
 */
function validateKeyRequest(body) {
  const b = isObj(body) ? body : {};
  const fields = [];
  if (!isStr(b.action) || !ACTIONS.includes(b.action)) fields.push('action');
  if (!isStr(b.player_id) || b.player_id.length === 0 || b.player_id.length > 256) fields.push('player_id');
  if (b.label !== undefined && b.label !== null && (!isStr(b.label) || b.label.length < 1 || b.label.length > 64)) {
    fields.push('label');
  }
  const ov = b.stream_key_override;
  if (ov !== undefined && ov !== null
    && (!isStr(ov) || ov.length < 1 || ov.length > MAX_OVERRIDE_LEN || !OVERRIDE_RE.test(ov))) {
    fields.push('stream_key_override');
  }
  if (fields.length) return { ok: false, fields };
  return {
    ok: true,
    value: {
      action: b.action,
      player_id: b.player_id,
      label: b.label ?? null,
      stream_key_override: ov ?? null,
    },
  };
}

// New random key; `randomHex(8)` must return 16 lowercase hex characters.
function newStreamKey(randomHex) {
  const key = 'sk_live_' + randomHex(8);
  if (!STREAM_KEY_RE.test(key)) throw new Error('random source returned an invalid stream key');
  return key;
}

function ingestEndpoints(key) {
  return { rtmp: `${MEDIA.rtmp}/live/${key}`, webrtc: `${MEDIA.webrtc}/live/${key}/whip` };
}

function playbackUrl(key) {
  return `${MEDIA.hls}/live/${key}/index.m3u8`;
}

// Exact sig_payload of spec 5.3 (full 4-key form).
function keySigPayload({ action, player_id: playerId, status, stream_key: key }) {
  return { action, player_id: playerId, status, stream_key: key };
}

/**
 * Response body of 5.4. `sign(entityId, payload)` computes the DAY2 HMAC.
 * A revoked key has no ingest endpoints and no playback URL.
 */
function keyResponse({ action, player_id: playerId, label, stream_key: key, status }, sign) {
  const active = status === 'active';
  return {
    player_id: playerId,
    label,
    stream_key: key,
    status,
    ingest_endpoints: active ? ingestEndpoints(key) : null,
    playback_url: active ? playbackUrl(key) : null,
    signature: sign(key, keySigPayload({ action, player_id: playerId, status, stream_key: key })),
  };
}

/**
 * Plans a key action from the player's existing keys (newest first: [{stream_key, label, status}]).
 * Returns one of:
 *  { kind: 'issue', httpStatus, revoke: [keys], key, label }   generate / rotate
 *  { kind: 'revoke', httpStatus: 200, revoke: [keys], key, label }
 *  { kind: 'error', code: 'STREAM_NOT_FOUND' }                  revoke with no key at all
 * A stream_key_override is always honoured verbatim (spec 5.4); if another player held that key,
 * the persistence layer reassigns it to this player.
 */
function planKeyAction(req, existing, { newKey }) {
  const keys = Array.isArray(existing) ? existing : [];
  const active = keys.filter((k) => k.status === 'active');
  if (req.action === 'revoke') {
    let target = null;
    if (req.stream_key_override) target = keys.find((k) => k.stream_key === req.stream_key_override) || null;
    if (!target) target = active[0] || keys[0] || null;
    if (!target) return { kind: 'error', code: 'STREAM_NOT_FOUND' };
    const revoke = target.status === 'active' ? [target.stream_key] : [];
    return { kind: 'revoke', httpStatus: 200, revoke, key: target.stream_key, label: req.label ?? target.label ?? DEFAULT_LABEL };
  }
  const key = req.stream_key_override || newKey;
  // Both generate and rotate invalidate every prior active key of the player (one live key per player).
  const revoke = active.map((k) => k.stream_key).filter((k) => k !== key);
  const label = req.label ?? (req.action === 'rotate' && active[0] ? active[0].label : null) ?? DEFAULT_LABEL;
  return { kind: 'issue', httpStatus: req.action === 'generate' ? 201 : 200, revoke, key, label };
}

/**
 * Parses a MediaMTX path ("live/<key>", "costream/<id>"; a leading slash is tolerated).
 * Returns { kind: 'live', key } | { kind: 'costream', id } | null.
 */
function parseMediaPath(path) {
  if (!isStr(path)) return null;
  const p = path.replace(/^\/+/, '').replace(/\/+$/, '');
  let m = /^live\/([^/]+)$/.exec(p);
  if (m) return { kind: 'live', key: m[1] };
  m = /^costream\/([^/]+)$/.exec(p);
  if (m) return { kind: 'costream', id: m[1] };
  return null;
}

/**
 * Media server auth decision (MediaMTX authMethod http).
 * input: { action, path }, keyStatus: 'active' | 'revoked' | null, session: { status } | null.
 * Returns { allow: true } or { allow: false, httpStatus, code }.
 */
function mediaAuthDecision(input, keyStatus, session) {
  const action = input && input.action;
  if (action === 'api' || action === 'metrics' || action === 'pprof') {
    return { allow: false, httpStatus: 403, code: 'FORBIDDEN' };
  }
  const target = parseMediaPath(input && input.path);
  if (!target) return { allow: false, httpStatus: 404, code: 'STREAM_NOT_FOUND' };
  // Recorded VODs stay watchable after the key that produced them is rotated or revoked.
  if (action === 'playback') return { allow: true };
  if (target.kind === 'live') {
    if (keyStatus === 'revoked') return { allow: false, httpStatus: 409, code: 'KEY_REVOKED' };
    if (action === 'publish') {
      return keyStatus === 'active' ? { allow: true } : { allow: false, httpStatus: 404, code: 'STREAM_NOT_FOUND' };
    }
    return { allow: true };
  }
  // costream composite: published by the compositor while the session is active; anyone may watch.
  if (action === 'publish') {
    if (!session) return { allow: false, httpStatus: 404, code: 'STREAM_NOT_FOUND' };
    return session.status === 'active' ? { allow: true } : { allow: false, httpStatus: 409, code: 'COSTREAM_TERMINATED' };
  }
  return { allow: true };
}

// Publish probe used by /audit/v1/stream/publish-check: same rule as the media auth hook.
function publishCheck(keyStatus) {
  if (keyStatus === 'active') return { allow: true };
  if (keyStatus === 'revoked') return { allow: false, httpStatus: 409, code: 'KEY_REVOKED' };
  return { allow: false, httpStatus: 404, code: 'STREAM_NOT_FOUND' };
}

module.exports = {
  ACTIONS, STREAM_KEY_RE, DEFAULT_LABEL, MEDIA,
  validateKeyRequest, newStreamKey, ingestEndpoints, playbackUrl, keySigPayload, keyResponse,
  planKeyAction, parseMediaPath, mediaAuthDecision, publishCheck,
};

// ---------------------------------------------------------------- athlete profile (FR-3.1)

/**
 * Career match record of a player's clubs from Phase I event-sourced projections.
 * projections: [{ match_id, status, home: {team_id, score}, away: {team_id, score}, winner_team_id }]
 */
function careerRecord(projections, clubIds) {
  const clubs = new Set(clubIds || []);
  const rec = { matches_played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, live: 0 };
  for (const p of projections || []) {
    if (!p || !p.home || !p.away) continue;
    const homeSide = clubs.has(p.home.team_id);
    const awaySide = clubs.has(p.away.team_id);
    if (!homeSide && !awaySide) continue;
    if (p.status === 'in_progress') rec.live += 1;
    if (p.status !== 'completed') continue;
    const mine = homeSide ? p.home : p.away;
    const theirs = homeSide ? p.away : p.home;
    rec.matches_played += 1;
    rec.scored += Number(mine.score) || 0;
    rec.conceded += Number(theirs.score) || 0;
    if (p.winner_team_id === mine.team_id) rec.wins += 1;
    else if (p.winner_team_id === theirs.team_id) rec.losses += 1;
    else rec.draws += 1;
  }
  return rec;
}

/** Upcoming fixtures: not started, not cancelled/abandoned, scheduled now or later (unscheduled last). */
function upcomingFixtures(matches, nowMs, limit = 10) {
  const skip = new Set(['cancelled', 'abandoned', 'completed', 'in_progress']);
  return (matches || [])
    .filter((m) => m && m.status === 'upcoming' && !skip.has(m.override_status))
    .filter((m) => !m.scheduled_at || Date.parse(m.scheduled_at) >= nowMs)
    .sort((a, b) => {
      const ta = a.scheduled_at ? Date.parse(a.scheduled_at) : Infinity;
      const tb = b.scheduled_at ? Date.parse(b.scheduled_at) : Infinity;
      return ta - tb || String(a.match_id).localeCompare(String(b.match_id));
    })
    .slice(0, limit);
}

module.exports.careerRecord = careerRecord;
module.exports.upcomingFixtures = upcomingFixtures;

// ---------------------------------------------------------------- VOD archive to MinIO (FR-3.2)

// MediaMTX writes fMP4 segments under recordPath /recordings/%path/<timestamp>.mp4.
const SEGMENT_RE = /^[A-Za-z0-9_.-]+\.mp4$/;
// A segment written during the broadcast is modified at or after it went live; allow clock slack.
const SEGMENT_SLACK_MS = 2000;

/**
 * Picks the recorded segments of one broadcast from a directory listing.
 * entries: [{ name, mtimeMs }]. Keeps .mp4 files modified at or after startMs (minus slack),
 * sorted by name (the timestamp in the name orders them). File times avoid timezone guessing.
 */
function selectVodSegments(entries, startMs) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && typeof e.name === 'string' && SEGMENT_RE.test(e.name)
      && Number.isFinite(e.mtimeMs) && e.mtimeMs >= startMs - SEGMENT_SLACK_MS)
    .map((e) => e.name)
    .sort();
}

// Object key of one archived segment: vods/<vod_id>/<segment file>.
function vodObjectKey(vodId, segmentName) {
  return `vods/${vodId}/${segmentName}`;
}

module.exports.selectVodSegments = selectVodSegments;
module.exports.vodObjectKey = vodObjectKey;
