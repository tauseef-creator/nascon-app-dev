'use strict';
// WebSocket endpoints (NFR-1, FR-3.2 overlays, FR-3.3), attached to the HTTP server on port 8080:
//   /ws/matches/{match_id}            score, status and pinned-merch overlay events (+ chat-{match_id})
//   /ws/costream/{session_id}?token=  session state + unified chat chat-{session_id}; a participant's
//                                     authenticated socket is its presence (close -> host handoff)
//   /ws/chat/{room_id}                one chat room
// Messages are JSON: {type: 'score'|'status'|'pinned_product'|'chat'|'costream'|'error', ...}.
const { WebSocketServer } = require('ws');
const bus = require('../../services/day2/bus');
const events = require('../../services/events');
const matchStatus = require('../../services/matchStatus');
const { query } = require('../../db/pool');
const { verifyToken } = require('../../lib/auth');

const HEARTBEAT_MS = 15000;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

// room key -> Set<WebSocket>
const rooms = new Map();
// `match:<id>` -> { started, sent }: reads started later see newer committed state, so a slow
// earlier read is never broadcast after a newer one (survives /reset, unlike score versions).
const pushSeq = new Map();

function join(room, ws) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws.rooms.add(room);
}

function leaveAll(ws) {
  for (const room of ws.rooms) {
    const set = rooms.get(room);
    if (!set) continue;
    set.delete(ws);
    if (!set.size) {
      rooms.delete(room);
      pushSeq.delete(room);
    }
  }
  ws.rooms.clear();
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function broadcast(room, msg) {
  const set = rooms.get(room);
  if (!set || !set.size) return;
  const text = JSON.stringify(msg);
  for (const ws of set) send(ws, text);
}

async function pinnedProduct(matchId) {
  const { rows } = await query(
    `SELECT p.product_id, p.name, p.category FROM pinned_products pp
     JOIN products p ON p.product_id = pp.product_id WHERE pp.match_id = $1`, [matchId]);
  return rows[0] || null;
}

// One DB read per committed event, fanned out to every subscriber of that match.
async function pushScore(matchId) {
  const room = `match:${matchId}`;
  if (!rooms.has(room)) return;
  if (!pushSeq.has(room)) pushSeq.set(room, { started: 0, sent: 0 });
  const seq = pushSeq.get(room);
  seq.started += 1;
  const mine = seq.started;
  try {
    const score = await events.getScore(matchId);
    if (mine < seq.sent) return;
    seq.sent = mine;
    broadcast(room, { type: 'score', data: score });
  } catch (e) { /* match vanished (reset): nothing to push */ }
}

async function pushStatus(matchId) {
  const room = `match:${matchId}`;
  if (!rooms.has(room)) return;
  try { broadcast(room, { type: 'status', data: await matchStatus.getStatus(matchId) }); } catch (e) { /* ignore */ }
}

async function pushPinned(matchId) {
  const room = `match:${matchId}`;
  if (!rooms.has(room)) return;
  try { broadcast(room, { type: 'pinned_product', data: { product: await pinnedProduct(matchId) } }); } catch (e) { /* ignore */ }
}

let hubWired = false;
function wireHub() {
  if (hubWired) return;
  hubWired = true;
  bus.on('match', (id) => { pushScore(id); });
  bus.on('status', (id) => { pushStatus(id); });
  bus.on('pinned', (id) => { pushPinned(id); });
  bus.on('chat', (roomId, message) => broadcast(`chat:${roomId}`, { type: 'chat', room_id: roomId, data: message }));
  bus.on('costream', (sessionId, state) => broadcast(`costream:${sessionId}`, { type: 'costream', data: state }));
}

// ---------------------------------------------------------------- co-stream presence

// `${sessionId}|${playerId}` -> Set<WebSocket>
const presence = new Map();

function addPresence(sessionId, playerId, ws) {
  const k = `${sessionId}|${playerId}`;
  if (!presence.has(k)) presence.set(k, new Set());
  presence.get(k).add(ws);
  ws.presence = { sessionId, playerId, key: k };
}

function dropPresence(ws) {
  if (!ws.presence) return;
  const { sessionId, playerId, key } = ws.presence;
  ws.presence = null;
  const set = presence.get(key);
  if (set) set.delete(ws);
  if (set && set.size) return; // another socket of the same broadcaster is still connected
  presence.delete(key);
  // Abrupt or clean disconnect of a broadcaster: deterministic handoff, well inside 1.5 s.
  require('../../services/day2/costream').handleDisconnect(sessionId, playerId).catch(() => {});
}

async function registerBroadcaster(ws, sessionId, token) {
  if (!token) return;
  let principal;
  try { principal = verifyToken(token); } catch (e) { send(ws, { type: 'error', code: 'UNAUTHENTICATED' }); return; }
  if (!principal.player_id) return;
  const costream = require('../../services/day2/costream');
  const s = await costream.getSession(sessionId).catch(() => null);
  if (!s || s.status !== 'active' || !(s.active_participants || []).includes(principal.player_id)) return;
  addPresence(sessionId, principal.player_id, ws);
  send(ws, { type: 'presence', data: { session_id: sessionId, player_id: principal.player_id, broadcasting: true } });
}

// ---------------------------------------------------------------- connection handling

function parseRoute(url) {
  let u;
  try { u = new URL(url, 'http://localhost'); } catch (e) { return null; }
  const m = /^\/ws\/(matches|costream|chat)\/([^/]+)\/?$/.exec(u.pathname);
  if (!m) return null;
  let id;
  try { id = decodeURIComponent(m[2]); } catch (e) { return null; }
  if (!ID_RE.test(id)) return null;
  return { kind: m[1], id, params: u.searchParams };
}

async function onConnection(ws, route) {
  ws.rooms = new Set();
  ws.isAlive = true;
  const release = bus.trackConnection();
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let msg = null;
    try { msg = JSON.parse(String(data)); } catch (e) { return; }
    if (msg && msg.type === 'ping') send(ws, { type: 'pong', t: msg.t ?? null });
  });
  ws.on('close', () => { release(); leaveAll(ws); dropPresence(ws); });
  ws.on('error', () => {});

  if (route.kind === 'matches') {
    join(`match:${route.id}`, ws);
    join(`chat:chat-${route.id}`, ws);
    let score;
    try {
      score = await events.getScore(route.id);
    } catch (e) {
      send(ws, { type: 'error', code: e.code || 'MATCH_NOT_FOUND' });
      ws.close(4404, 'match not found');
      return;
    }
    // One initial frame: the score plus the overlay state, so the next frame is always a live update.
    const [status, product] = await Promise.all([
      matchStatus.getStatus(route.id).catch(() => null),
      pinnedProduct(route.id).catch(() => null),
    ]);
    send(ws, { type: 'score', data: score, match_status: status, pinned_product: { product } });
  } else if (route.kind === 'costream') {
    join(`costream:${route.id}`, ws);
    join(`chat:chat-${route.id}`, ws);
    const costream = require('../../services/day2/costream');
    const s = await costream.getSession(route.id).catch(() => null);
    send(ws, s ? { type: 'costream', data: { ...costream.publicView(s), muted: s.muted || [], spotlight: s.spotlight ?? null } }
      : { type: 'error', code: 'STREAM_NOT_FOUND' });
    await registerBroadcaster(ws, route.id, route.params.get('token'));
  } else {
    join(`chat:${route.id}`, ws);
    send(ws, { type: 'subscribed', room_id: route.id });
  }
}

function attachWebSockets(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  wireHub();
  server.on('upgrade', (req, socket, head) => {
    const route = parseRoute(req.url || '');
    if (!route) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, route).catch(() => {});
    });
  });
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* closing */ }
    }
  }, HEARTBEAT_MS);
  timer.unref();
  server.on('close', () => { clearInterval(timer); wss.close(); });
  return wss;
}

module.exports = { attachWebSockets, parseRoute };
