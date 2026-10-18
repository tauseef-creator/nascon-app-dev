'use strict';
// Real-time message bus (NFR-1, FR-3.2 overlays, FR-3.3 chat). Thin wrapper over the in-process hub
// in lib/realtime so producers never touch transport code. Events (all emitted after DB commit):
//   'match'    (matchId)                  score changed (services/events.js)
//   'status'   (matchId)                  administrative match status changed
//   'pinned'   (matchId)                  pinned merchandise changed
//   'chat'     (roomId, message)          chat message accepted (moderation service)
//   'costream' (sessionId, state)         co-stream session state changed (handoff, controls)
//   'stream'   (playerId, {stream_key, status})  stream key lifecycle change
//   'order_status' (customerId, {order_id, status, from, to, at, reason})  order status transition
//                                         (FR-5.2), pushed to that user's /ws/users/me socket
// Clustered (WEB_CONCURRENCY > 1): lib/realtime relays every event to the other workers over Redis
// pub/sub, and each worker reports its open-connection count into one Redis hash (field = pid) that
// /metrics sums. The primary clears the hash at boot and drops the field of a worker that exits.
const { hub, clusterRedis } = require('../../lib/realtime');

const WS_COUNTS_KEY = 'nascon:ws_conns';
let activeConnections = 0;

function reportConnections() {
  const redis = clusterRedis();
  if (redis) redis.hset(WS_COUNTS_KEY, String(process.pid), activeConnections).catch(() => {});
}

// Counts one open real-time connection (WebSocket or SSE). Returns an idempotent release function.
function trackConnection() {
  activeConnections += 1;
  reportConnections();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeConnections -= 1;
    reportConnections();
  };
}

// This process's open connections.
const connectionCount = () => activeConnections;

// Open connections across all workers (this process's count when single-process or Redis fails).
async function totalConnections() {
  const redis = clusterRedis();
  if (!redis) return activeConnections;
  try {
    const all = await redis.hgetall(WS_COUNTS_KEY);
    const others = Object.entries(all || {})
      .filter(([pid]) => pid !== String(process.pid))
      .reduce((sum, [, n]) => sum + (Number(n) || 0), 0);
    return others + activeConnections;
  } catch {
    return activeConnections;
  }
}

const emitMatch = (matchId) => hub.emit('match', matchId);
const emitStatus = (matchId) => hub.emit('status', matchId);
const emitPinned = (matchId) => hub.emit('pinned', matchId);
const emitChat = (roomId, message) => hub.emit('chat', roomId, message);
const emitCostream = (sessionId, state) => hub.emit('costream', sessionId, state);
const emitStream = (playerId, info) => hub.emit('stream', playerId, info);
const emitOrderStatus = (customerId, info) => hub.emit('order_status', customerId, info);

function on(event, fn) {
  hub.on(event, fn);
  return () => hub.off(event, fn);
}

module.exports = {
  hub, on, trackConnection, connectionCount, totalConnections, WS_COUNTS_KEY,
  emitMatch, emitStatus, emitPinned, emitChat, emitCostream, emitStream, emitOrderStatus,
};
