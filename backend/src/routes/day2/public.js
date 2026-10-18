'use strict';
// Phase II public surfaces, mounted at the app root BEFORE /audit/v1 and the rate-limited /api/v1:
//   GET  /q/:short_code                      302 to the live target_route (spec 5.6, FR-4.1)
//   GET  /metrics                            Prometheus exposition (spec 5.9, NFR-6)
//   GET  /web/*                              Guest Web Player SPA + static assets (spec 1.1 surface 3, 6.2.2)
//   GET  /api/v1/matches/:match_id/stream    SSE score stream (NFR-1)
//   GET  /api/v1/guest/matches/:match_id     read-only match summary for guests (FR-4.2)
//   POST /api/v1/guest/session               anonymous viewer token (FR-4.2)
//   GET|POST /api/v1/guest/cart              guest cart staging (FR-4.4)
//   GET|POST /api/v1/chat                    chat read (public) and member write (FR-4.3, FR-5.3)
// Services owned by other modules are required lazily so this router loads even while they evolve.
const path = require('path');
const express = require('express');
const { query } = require('../../db/pool');
const { hub } = require('../../lib/realtime');
const { requireAuth } = require('../../lib/auth');
const { bearerToken, isGuestToken } = require('../../lib/guest');
const { ApiError, validation, notFound, unauthenticated, errorBody } = require('../../lib/errors');

const router = express.Router();

const WEB_DIR = path.join(__dirname, '..', '..', '..', 'web');
const INDEX_HTML = path.join(WEB_DIR, 'index.html');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const ROOM_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MAX_LINE_QTY = 10;
const DEFAULT_PRODUCT_ID = 'prod-jersey-001';
const DEFAULT_VARIANT_ID = 'var-jersey-001-L';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const sendError = (res, err) => res.status(err.status).json(errorBody(err));

// ---------------------------------------------------------------- /q short links
router.get('/q/:short_code', async (req, res) => {
  const code = req.params.short_code;
  if (!ID_RE.test(code)) return sendError(res, notFound('QR_NOT_FOUND', `QR code ${code} not found.`, { short_code: code }));
  // eslint-disable-next-line global-require
  const { resolveShortCode } = require('../../services/day2/qr');
  const resolved = await resolveShortCode(code, req.headers['user-agent']);
  const target = resolved && (typeof resolved === 'string' ? resolved : resolved.target_route);
  if (!target) return sendError(res, notFound('QR_NOT_FOUND', `QR code ${code} not found.`, { short_code: code }));
  res.set('Cache-Control', 'no-store'); // target_route is dynamic (edge case 2): never cache the redirect
  return res.redirect(302, target);
});

// ---------------------------------------------------------------- /metrics
router.get('/metrics', (req, res, next) => {
  // eslint-disable-next-line global-require
  const { metricsHandler } = require('../../services/day2/metrics');
  return metricsHandler(req, res, next);
});

// ---------------------------------------------------------------- /web guest player
const staticOpts = {
  index: false, dotfiles: 'deny', fallthrough: true, maxAge: '1h',
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
};
router.use('/web/assets', express.static(path.join(WEB_DIR, 'assets'), staticOpts));
router.use('/web/vendor', express.static(path.join(WEB_DIR, 'vendor'), { ...staticOpts, maxAge: '7d' }));

function sendPlayer(req, res) {
  res.set({
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.sendFile(INDEX_HTML);
}
const validId = (req, res, next) => (ID_RE.test(req.params.id)
  ? next()
  : sendError(res, notFound('NOT_FOUND', 'Route not found.')));
router.get('/web', (req, res) => res.redirect(302, '/web/matches/match-m1/live'));
router.get('/web/matches/:id/:view', validId, (req, res, next) => (
  ['live', 'preview', 'vod', 'notice'].includes(req.params.view) ? sendPlayer(req, res) : next()));
router.get('/web/players/:id', validId, sendPlayer);
router.get('/web/clubs/:id', validId, sendPlayer);
router.get('/web/costream/:id', validId, sendPlayer);

// ---------------------------------------------------------------- SSE score stream (NFR-1)
// Summary without the full event log: the banner only needs the two sides and the version.
function scoreSummary(s) {
  const side = (x) => (x ? { team_id: x.team_id, score: x.score, wickets: x.wickets, overs: x.overs } : null);
  return {
    match_id: s.match_id, status: s.status, outcome: s.outcome, winner_team_id: s.winner_team_id,
    home: side(s.home), away: side(s.away), version: s.version,
  };
}

router.get('/api/v1/matches/:match_id/stream', async (req, res) => {
  const matchId = req.params.match_id;
  // eslint-disable-next-line global-require
  const { getScore } = require('../../services/events');
  let ready = false;
  let missed = false;
  let closed = false;
  let lastKey = null;
  let chain = Promise.resolve();
  const push = (score) => {
    const s = scoreSummary(score);
    const key = `${s.version}|${s.status}`;
    if (closed || key === lastKey) return; // de-duplicate bursts
    lastKey = key;
    res.write(`event: score\nid: ${s.version}\ndata: ${JSON.stringify(s)}\n\n`);
  };
  // Serialized lookups: a burst of events never reorders versions on the wire.
  const onMatch = (id) => {
    if (id !== matchId || closed) return;
    if (!ready) { missed = true; return; }
    chain = chain.then(() => getScore(matchId)).then(push).catch(() => {});
  };
  // Subscribe before the first read so no event committed in between is lost.
  hub.on('match', onMatch);
  hub.on('status', onMatch);
  const unsubscribe = () => { hub.off('match', onMatch); hub.off('status', onMatch); };

  let first;
  try {
    first = await getScore(matchId);
  } catch (err) {
    unsubscribe();
    if (err instanceof ApiError) return sendError(res, err);
    throw err;
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  if (req.socket) req.socket.setNoDelay(true);
  res.write('retry: 1000\n\n');

  const heartbeat = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
  push(first);
  ready = true;
  if (missed) onMatch(matchId);
  return undefined;
});

// ---------------------------------------------------------------- guest read model (FR-4.2)
const VIEW_BY_STATUS = { upcoming: 'preview', in_progress: 'live', completed: 'vod' };

async function loadTeamName(teamId) {
  if (!teamId) return null;
  const { rows } = await query('SELECT name FROM clubs WHERE club_id = $1', [teamId]);
  return rows[0] ? rows[0].name : teamId;
}

async function loadProduct(productId) {
  const { rows } = await query(
    'SELECT product_id, name, category, data FROM products WHERE product_id = $1', [productId]);
  if (!rows.length) return null;
  const p = rows[0];
  const { rows: vars } = await query(
    `SELECT variant_id, size, color, price_minor, currency, GREATEST(stock - reserved, 0) AS available
       FROM variants WHERE product_id = $1 ORDER BY variant_id`, [productId]);
  const image = p.data && p.data.image ? `/media/${p.data.image}` : null;
  return {
    product_id: p.product_id,
    name: p.name,
    category: p.category,
    description: (p.data && p.data.description) || null,
    image_url: image,
    variants: vars.map((v) => ({
      variant_id: v.variant_id, size: v.size, color: v.color,
      price_minor: Number(v.price_minor), currency: v.currency, available: Number(v.available),
    })),
  };
}

// Optional hook into the streaming module for the match's live HLS path.
async function liveStreamPath(matchId) {
  try {
    // eslint-disable-next-line global-require
    const streaming = require('../../services/day2/streaming');
    const fn = streaming.liveStreamForMatch || streaming.getMatchStream;
    if (typeof fn === 'function') {
      const r = await fn(matchId);
      if (r && typeof r === 'string') return r;
      if (r && isStr(r.hls_path)) return r.hls_path;
    }
  } catch (e) { /* streaming module not available: use the default path convention */ }
  return `live/${matchId}`;
}

router.get('/api/v1/guest/matches/:match_id', async (req, res) => {
  const matchId = req.params.match_id;
  if (!ID_RE.test(matchId)) return sendError(res, validation(['match_id']));
  const { rows } = await query(
    'SELECT match_id, sport_id, league_id, home_team_id, away_team_id, scheduled_at, venue FROM matches WHERE match_id = $1',
    [matchId]);
  if (!rows.length) return sendError(res, notFound('MATCH_NOT_FOUND', `Match ${matchId} not found.`, { match_id: matchId }));
  const m = rows[0];
  // eslint-disable-next-line global-require
  const { getScore } = require('../../services/events');
  const score = scoreSummary(await getScore(matchId));
  // Effective status includes organizer overrides (postponed / cancelled / abandoned).
  let status = score.status;
  let reason = null;
  try {
    // eslint-disable-next-line global-require
    const st = await require('../../services/matchStatus').getStatus(matchId);
    if (st && isStr(st.status)) { status = st.status; reason = st.reason || null; }
  } catch (e) { /* fall back to the event-log status */ }
  const { rows: pin } = await query('SELECT product_id FROM pinned_products WHERE match_id = $1', [matchId]);
  const product = (pin[0] && await loadProduct(pin[0].product_id)) || await loadProduct(DEFAULT_PRODUCT_ID);
  const variant = product
    ? (product.variants.find((v) => v.variant_id === DEFAULT_VARIANT_ID) || product.variants[0] || null)
    : null;
  return res.status(200).json({
    match_id: m.match_id,
    sport_id: m.sport_id,
    league_id: m.league_id,
    venue: m.venue,
    scheduled_at: m.scheduled_at ? new Date(m.scheduled_at).toISOString() : null,
    status,
    status_reason: reason,
    view: VIEW_BY_STATUS[status] || 'notice',
    home: { team_id: m.home_team_id, name: await loadTeamName(m.home_team_id) },
    away: { team_id: m.away_team_id, name: await loadTeamName(m.away_team_id) },
    score,
    pinned_product: product,
    pinned_variant_id: variant ? variant.variant_id : null,
    stream: await (async () => {
      const hlsPath = await liveStreamPath(matchId);
      return { hls_path: hlsPath, hls_port: 8888, live: hlsPath !== `live/${matchId}` };
    })(),
    chat_room_id: `chat-${matchId}`,
  });
});

router.get('/api/v1/guest/players/:id', async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return sendError(res, validation(['player_id']));
  const { rows } = await query(
    `SELECT p.player_id, p.name, p.position, p.club_id, c.name AS club_name
       FROM players p LEFT JOIN clubs c ON c.club_id = p.club_id WHERE p.player_id = $1`, [id]);
  if (!rows.length) return sendError(res, notFound('PLAYER_NOT_FOUND', `Player ${id} not found.`, { player_id: id }));
  const { rows: vods } = await query(
    'SELECT vod_id, duration_s, created_at FROM vods WHERE player_id = $1 ORDER BY created_at DESC LIMIT 10', [id])
    .catch(() => ({ rows: [] }));
  return res.status(200).json({
    ...rows[0],
    vods: vods.map((v) => ({ vod_id: v.vod_id, duration_s: v.duration_s, created_at: new Date(v.created_at).toISOString() })),
  });
});

router.get('/api/v1/guest/clubs/:id', async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return sendError(res, validation(['club_id']));
  const { rows } = await query('SELECT club_id, tenant_id, name FROM clubs WHERE club_id = $1', [id]);
  if (!rows.length) return sendError(res, notFound('CLUB_NOT_FOUND', `Club ${id} not found.`, { club_id: id }));
  const { rows: players } = await query(
    'SELECT player_id, name, position FROM players WHERE club_id = $1 ORDER BY player_id', [id]);
  const { rows: matches } = await query(
    `SELECT m.match_id, m.home_team_id, m.away_team_id, m.scheduled_at,
            COALESCE(h.name, m.home_team_id) AS home_name, COALESCE(a.name, m.away_team_id) AS away_name
       FROM matches m LEFT JOIN clubs h ON h.club_id = m.home_team_id LEFT JOIN clubs a ON a.club_id = m.away_team_id
      WHERE m.home_team_id = $1 OR m.away_team_id = $1 ORDER BY m.scheduled_at NULLS LAST, m.match_id LIMIT 20`, [id]);
  return res.status(200).json({
    ...rows[0],
    players,
    matches: matches.map((m) => ({ ...m, scheduled_at: m.scheduled_at ? new Date(m.scheduled_at).toISOString() : null })),
  });
});

router.get('/api/v1/guest/costream/:id', async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return sendError(res, validation(['session_id']));
  // eslint-disable-next-line global-require
  const costream = require('../../services/day2/costream');
  const state = await costream.getSession(id);
  const pub = costream.publicView(state);
  delete pub.signature;
  return res.status(200).json({ ...pub, muted: state.muted || [], spotlight: state.spotlight ?? null });
});

// ---------------------------------------------------------------- guest session + cart staging (FR-4.2, FR-4.4)
// The guest service owns the token and cart rules (unknown token 401, merged 409, stock 409).
function guestService() {
  // eslint-disable-next-line global-require
  return require('../../services/day2/guest');
}

router.post('/api/v1/guest/session', async (req, res) => {
  const r = await guestService().issueGuestToken();
  const token = isStr(r) ? r : r && (r.guest_token || r.token);
  if (!isStr(token)) throw new ApiError(500, 'INTERNAL_ERROR', 'Could not issue a guest token.');
  res.set('Cache-Control', 'no-store');
  return res.status(201).json({
    guest_token: token,
    role: 'guest',
    read_only: true,
    scopes: ['stream:read', 'score:subscribe', 'cart:stage'],
    expires_at: (r && r.expires_at) || null,
  });
});

function guestBearer(req) {
  const token = bearerToken(req);
  if (!isGuestToken(token)) throw unauthenticated('A guest token is required (Bearer guest_*).');
  return token;
}

router.get('/api/v1/guest/cart', async (req, res) => {
  const token = guestBearer(req);
  const cart = await guestService().getGuestCart(token);
  const { rows } = await query('SELECT merged FROM guest_tokens WHERE token = $1', [token]);
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ ...cart, merged: Boolean(rows[0] && rows[0].merged) });
});

router.post('/api/v1/guest/cart', async (req, res) => {
  const body = isObj(req.body) ? req.body : {};
  const qty = body.quantity === undefined ? 1 : body.quantity;
  if (Number.isInteger(qty) && qty > MAX_LINE_QTY) throw validation(['quantity']);
  const token = guestBearer(req);
  const cart = await guestService().stageGuestCart(token, body.variant_id, qty);
  res.set('Cache-Control', 'no-store');
  return res.status(200).json(cart);
});

// ---------------------------------------------------------------- chat (FR-4.3, FR-5.3)
// The moderation service owns masking, flood/rate limits and kicks. Guests never reach POST: the
// global guard answers 403 GUEST_WRITE_FORBIDDEN first.
function moderation() {
  // eslint-disable-next-line global-require
  return require('../../services/day2/moderation');
}

function roomParam(req) {
  const room = req.query.room !== undefined ? req.query.room : req.query.room_id;
  return isStr(room) && ROOM_RE.test(room) ? room : null;
}

router.get('/api/v1/chat', async (req, res) => {
  const room = roomParam(req);
  const bad = [];
  if (!room) bad.push('room');
  let after = 0;
  if (req.query.after !== undefined) {
    after = Number(req.query.after);
    if (!Number.isSafeInteger(after) || after < 0) bad.push('after');
  }
  let limit = 50;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) bad.push('limit');
  }
  if (bad.length) throw validation(bad);
  const out = await moderation().listChat(room, { afterSeq: after, limit });
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ room_id: room, messages: out.messages, last_seq: out.last_seq });
});

// GET /api/v1/chat/stream?room=  Server-Sent Events of accepted (already moderated) messages.
router.get('/api/v1/chat/stream', (req, res) => {
  const room = roomParam(req);
  if (!room) throw validation(['room']);
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  if (req.socket) req.socket.setNoDelay(true);
  res.write('retry: 1000\n\n');
  let closed = false;
  const onChat = (roomId, message) => {
    if (closed || roomId !== room || !message) return;
    res.write(`event: chat\nid: ${message.seq}\ndata: ${JSON.stringify(message)}\n\n`);
  };
  hub.on('chat', onChat);
  const heartbeat = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    hub.off('chat', onChat);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
});

router.post('/api/v1/chat', requireAuth, async (req, res) => {
  const body = isObj(req.body) ? req.body : {};
  const room = body.room !== undefined ? body.room : body.room_id;
  const bad = [];
  if (!isStr(room) || !ROOM_RE.test(room)) bad.push('room');
  if (!isStr(body.text) || body.text.trim().length === 0) bad.push('text');
  if (body.message_id !== undefined && !isStr(body.message_id)) bad.push('message_id');
  if (bad.length) throw validation(bad);
  const result = await moderation().postChat({
    roomId: room, sender: req.principal.user_id, text: body.text.trim(), messageId: body.message_id,
  });
  if (result && result.accepted === false && result.blocked) {
    const b = result.blocked;
    const details = { reason: b.reason };
    if (b.retry_after_s !== undefined) {
      details.retry_after_s = b.retry_after_s;
      res.set('Retry-After', String(b.retry_after_s));
    }
    return sendError(res, new ApiError(b.status, b.code, b.message, details));
  }
  return res.status(result && result.replay ? 200 : 201).json({ message: result.message });
});

module.exports = router;
