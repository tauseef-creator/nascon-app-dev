'use strict';
const crypto = require('crypto');

// Canonical JSON (spec 5.3): recursively sorted keys, no whitespace, UTF-8, non-ASCII not escaped.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

function getSalt() {
  // Read verbatim from the environment: not trimmed, not hex-decoded.
  return process.env.DAY1_SALT ?? '';
}

function sign(id, payload, salt = getSalt()) {
  const msg = Buffer.from(id + '|' + canonical(payload), 'utf8');
  return crypto.createHmac('sha256', Buffer.from(salt, 'utf8')).update(msg).digest('hex');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

// draw_lots key (spec 5.10)
function lotsKey(seed, leagueId, teamId) {
  return sha256Hex(`${seed}|${leagueId}|${teamId}`);
}

// Stable hash of a request body, used for idempotency comparisons.
function bodyHash(obj) {
  return sha256Hex(canonical(obj));
}

module.exports = { canonical, sign, getSalt, sha256Hex, lotsKey, bodyHash };
