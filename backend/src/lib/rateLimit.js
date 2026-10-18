'use strict';
// Sliding-window rate limiter: 100 requests per rolling 10 s per client IP (spec 5.2, 5.13).
//
// Single process: an in-memory window per key. Clustered (WEB_CONCURRENCY > 1, see lib/realtime
// enableClusterBus): one atomic Lua script per request on a Redis sorted set, so every worker shares
// the same window. If Redis errors or is slow, the in-memory window decides (fail open per worker,
// never 5xx). Rejected requests are not recorded, exactly like the in-memory window.
const crypto = require('crypto');
const { ApiError, errorBody } = require('./errors');
const { clusterRedis } = require('./realtime');

const LIMIT = 100;
const WINDOW_MS = 10_000;
const REDIS_TIMEOUT_MS = 250;
const PRUNE_AT = 10_000;
const hits = new Map();

// KEYS[1] window key; ARGV now, window ms, limit, member. Returns {allowed (1|0), oldest hit ms}.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local win = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - win)
local n = redis.call('ZCARD', key)
if n >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) or now}
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, win)
return {1, 0}
`;

/** In-memory window: { allowed, oldest } (oldest = earliest hit still inside the window). */
function memoryHit(key, now, limit, windowMs, store = hits) {
  const list = (store.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    store.set(key, list);
    return { allowed: false, oldest: list[0] };
  }
  list.push(now);
  store.set(key, list);
  if (store.size > PRUNE_AT) {
    for (const [k, l] of store) if (!l.length || now - l[l.length - 1] >= windowMs) store.delete(k);
  }
  return { allowed: true, oldest: list[0] };
}

let seq = 0;
const memberId = (now) => {
  seq = (seq + 1) % 1e9;
  return `${now}-${process.pid}-${seq}-${crypto.randomBytes(3).toString('hex')}`;
};

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('redis timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Records one hit in a shared sliding window. Resolves { allowed, oldest }.
 * Uses Redis when clustered (redis argument or lib/realtime clusterRedis()), memory otherwise or
 * when Redis fails. `store` is the in-memory fallback map.
 */
async function hit(key, { limit, windowMs, now = Date.now(), redis = clusterRedis(), store = hits } = {}) {
  if (redis) {
    try {
      const [allowed, oldest] = await withTimeout(
        redis.eval(SLIDING_WINDOW_LUA, 1, key, now, windowMs, limit, memberId(now)), REDIS_TIMEOUT_MS);
      return { allowed: Number(allowed) === 1, oldest: Number(oldest) || now };
    } catch {
      /* Redis unavailable: fall back to this process's window. */
    }
  }
  return memoryHit(key, now, limit, windowMs, store);
}

function reject(res, now, oldest) {
  const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json(errorBody(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again later.', { retry_after: retryAfter })));
}

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const redis = clusterRedis();
  if (!redis) {
    // Synchronous path (single process): identical to the original limiter.
    const r = memoryHit(ip, now, LIMIT, WINDOW_MS);
    return r.allowed ? next() : reject(res, now, r.oldest);
  }
  return hit(`rl:api:${ip}`, { limit: LIMIT, windowMs: WINDOW_MS, now, redis })
    .then((r) => (r.allowed ? next() : reject(res, now, r.oldest)), next);
}

function _resetRateLimit() {
  hits.clear();
}

module.exports = { rateLimit, hit, memoryHit, _resetRateLimit, LIMIT, WINDOW_MS, SLIDING_WINDOW_LUA };
