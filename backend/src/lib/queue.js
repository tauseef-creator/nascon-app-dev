'use strict';
// Internal domain-event queue on Redis Streams. Publishing never blocks or fails a request.
const Redis = require('ioredis');

const STREAM = 'domain-events';
let redis = null;

function client() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redis.on('error', () => {});
  }
  return redis;
}

function publish(type, data) {
  try {
    client().xadd(STREAM, 'MAXLEN', '~', '10000', '*', 'type', type, 'data', JSON.stringify(data)).catch(() => {});
  } catch {
    // Queue unavailable: the API keeps working; events are best-effort.
  }
}

module.exports = { STREAM, client, publish };
