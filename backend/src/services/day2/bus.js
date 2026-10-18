'use strict';
// Real-time message bus (NFR-1, FR-3.2 overlays, FR-3.3 chat). Thin wrapper over the in-process hub
// in lib/realtime so producers never touch transport code. Events (all emitted after DB commit):
//   'match'    (matchId)                  score changed (services/events.js)
//   'status'   (matchId)                  administrative match status changed
//   'pinned'   (matchId)                  pinned merchandise changed
//   'chat'     (roomId, message)          chat message accepted (moderation service)
//   'costream' (sessionId, state)         co-stream session state changed (handoff, controls)
//   'stream'   (playerId, {stream_key, status})  stream key lifecycle change
const { hub } = require('../../lib/realtime');

let activeConnections = 0;

// Counts one open real-time connection (WebSocket or SSE). Returns an idempotent release function.
function trackConnection() {
  activeConnections += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeConnections -= 1;
  };
}

const connectionCount = () => activeConnections;

const emitMatch = (matchId) => hub.emit('match', matchId);
const emitStatus = (matchId) => hub.emit('status', matchId);
const emitPinned = (matchId) => hub.emit('pinned', matchId);
const emitChat = (roomId, message) => hub.emit('chat', roomId, message);
const emitCostream = (sessionId, state) => hub.emit('costream', sessionId, state);
const emitStream = (playerId, info) => hub.emit('stream', playerId, info);

function on(event, fn) {
  hub.on(event, fn);
  return () => hub.off(event, fn);
}

module.exports = {
  hub, on, trackConnection, connectionCount,
  emitMatch, emitStatus, emitPinned, emitChat, emitCostream, emitStream,
};
