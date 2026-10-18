'use strict';
// Realtime hub. Emits ('match', matchId) after a committed event append, ('pinned', matchId) after
// a product pin, and the Phase II events listed in services/day2/bus.js. Consumed by the SSE and
// WebSocket routes and by in-process caches.
//
// Single process (default): a plain in-process EventEmitter.
// Clustered (WEB_CONCURRENCY > 1): enableClusterBus() makes every emit also publish to one Redis
// pub/sub channel; each worker re-emits messages from other workers locally. Local listeners always
// run first and synchronously, exactly as in single-process mode, so same-worker behaviour is
// unchanged; remote listeners see the event a few milliseconds later. While a remote message is
// being delivered, hub.isRemoteDelivery() is true (caches use it to avoid re-broadcasting).
const { EventEmitter } = require('events');
const crypto = require('crypto');

const CHANNEL = 'nascon:hub';
// Events emitted by EventEmitter itself, never relayed.
const LOCAL_ONLY = new Set(['error', 'newListener', 'removeListener']);

const hub = new EventEmitter();
hub.setMaxListeners(0);
const localEmit = EventEmitter.prototype.emit;

const state = { pub: null, sub: null, origin: null, remote: 0, subscribed: Promise.resolve() };

hub.emit = function emit(event, ...args) {
  const handled = localEmit.call(hub, event, ...args);
  if (state.pub && !LOCAL_ONLY.has(event) && typeof event === 'string') {
    let payload = null;
    try { payload = JSON.stringify({ o: state.origin, e: event, a: args }); } catch { payload = null; }
    if (payload) state.pub.publish(CHANNEL, payload).catch(() => {});
  }
  return handled;
};

/** Delivers one pub/sub payload from another worker to local listeners. Exported for tests. */
function deliverRemote(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return false; }
  if (!msg || msg.o === state.origin || typeof msg.e !== 'string' || LOCAL_ONLY.has(msg.e)) return false;
  state.remote += 1;
  try {
    localEmit.call(hub, msg.e, ...(Array.isArray(msg.a) ? msg.a : []));
  } catch { /* a listener threw: never break the subscriber */ } finally {
    state.remote -= 1;
  }
  return true;
}

hub.isRemoteDelivery = () => state.remote > 0;

/**
 * Turns on cross-worker fan-out. `createClient(role)` returns an ioredis-like client (role is
 * 'pub' or 'sub'); defaults to ioredis on REDIS_URL. Idempotent. Returns the publisher client.
 */
function enableClusterBus({ createClient, origin } = {}) {
  if (state.pub) return state.pub;
  const make = createClient || ((role) => {
    const Redis = require('ioredis');
    const c = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: role === 'sub',
    });
    c.on('error', () => {});
    return c;
  });
  state.origin = origin || `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  state.sub = make('sub');
  state.sub.on('message', (channel, raw) => { if (channel === CHANNEL) deliverRemote(raw); });
  state.subscribed = Promise.resolve(state.sub.subscribe(CHANNEL)).catch(() => {});
  state.pub = make('pub');
  return state.pub;
}

/** Resolves once the subscriber is attached to the channel (immediately when not clustered). */
const whenSubscribed = () => state.subscribed;

/** The shared Redis client when clustered, otherwise null (single-process mode). */
const clusterRedis = () => state.pub;

/** Test helper: back to single-process mode. */
function disableClusterBus() {
  for (const c of [state.pub, state.sub]) { try { c && c.disconnect && c.disconnect(); } catch { /* ignore */ } }
  state.pub = null;
  state.sub = null;
  state.origin = null;
  state.remote = 0;
  state.subscribed = Promise.resolve();
}

module.exports = { hub, CHANNEL, enableClusterBus, disableClusterBus, clusterRedis, deliverRemote, whenSubscribed };
