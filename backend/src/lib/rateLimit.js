'use strict';
// Sliding-window rate limiter: 100 requests per rolling 10 s per client IP (spec 5.2, 5.13).
const { ApiError, errorBody } = require('./errors');

const LIMIT = 100;
const WINDOW_MS = 10_000;
const hits = new Map();

function rateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= LIMIT) {
    hits.set(key, list);
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - list[0])) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json(errorBody(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again later.', { retry_after: retryAfter })));
  }
  list.push(now);
  hits.set(key, list);
  return next();
}

function _resetRateLimit() {
  hits.clear();
}

module.exports = { rateLimit, _resetRateLimit, LIMIT, WINDOW_MS };
