'use strict';
// JWT issue/verify (spec 5.13, NFR-5). HS256 only: alg:none, tampered and expired tokens fail.
const jwt = require('jsonwebtoken');
const { unauthenticated } = require('./errors');

const ALG = 'HS256';
const EXPIRES_IN = '12h';

function secret() {
  return process.env.JWT_SECRET || 'nascon-dev-jwt-secret-change-me';
}

function issueToken(user, options = {}) {
  const claims = {
    sub: user.user_id,
    role: user.role,
    tenant_id: user.tenant_id || null,
    league_id: user.league_id || null,
    club_id: user.club_id || null,
    player_id: user.player_id || null,
  };
  return jwt.sign(claims, secret(), { algorithm: ALG, expiresIn: options.expiresIn || EXPIRES_IN });
}

// Returns the principal or throws 401 UNAUTHENTICATED.
function verifyToken(token) {
  if (typeof token !== 'string' || token.length === 0) throw unauthenticated();
  let claims;
  try {
    claims = jwt.verify(token, secret(), { algorithms: [ALG] });
  } catch (err) {
    throw unauthenticated(err && err.name === 'TokenExpiredError' ? 'Token expired.' : 'Invalid token.');
  }
  if (!claims || typeof claims !== 'object' || typeof claims.sub !== 'string' || typeof claims.role !== 'string') {
    throw unauthenticated('Invalid token claims.');
  }
  return {
    user_id: claims.sub,
    role: claims.role,
    tenant_id: claims.tenant_id || null,
    league_id: claims.league_id || null,
    club_id: claims.club_id || null,
    player_id: claims.player_id || null,
  };
}

function bearer(header) {
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

// Express middleware: sets req.principal or forwards 401.
function requireAuth(req, res, next) {
  try {
    const token = bearer(req.headers && req.headers.authorization);
    if (!token) throw unauthenticated('Missing or malformed Authorization header.');
    req.principal = verifyToken(token);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { issueToken, verifyToken, requireAuth, bearer };
