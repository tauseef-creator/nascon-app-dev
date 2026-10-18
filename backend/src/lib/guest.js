'use strict';
// Server-enforced read-only boundary for anonymous guests (FR-4.3, spec Part II 5.7).
// Any state-mutating request carrying a guest token (Bearer guest_*) is rejected with
// 403 GUEST_WRITE_FORBIDDEN before routing, so no write endpoint can be missed.
const { ApiError, errorBody } = require('./errors');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Guest-only staging endpoints that guests are allowed to call (local guest cart).
const GUEST_ALLOWED = [/^\/api\/v1\/guest\//];

function bearerToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

function isGuestToken(token) {
  return typeof token === 'string' && token.startsWith('guest_');
}

function guestWriteGuard(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  const token = bearerToken(req);
  if (!isGuestToken(token)) return next();
  if (GUEST_ALLOWED.some((re) => re.test(req.path))) return next();
  const err = new ApiError(403, 'GUEST_WRITE_FORBIDDEN', 'Anonymous guest tokens cannot perform write mutations.', { guest_token: token });
  return res.status(403).json(errorBody(err));
}

module.exports = { guestWriteGuard, bearerToken, isGuestToken };
