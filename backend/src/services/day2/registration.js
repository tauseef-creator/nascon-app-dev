'use strict';
// Progressive registration (FR-4.4): POST /api/v1/auth/register creates a member account and, when
// the request carries the guest's guest_token, atomically merges the staged guest cart into the new
// member cart through the same merge used by /audit/v1/guest/cart-merge (spec 5.7).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../../db/pool');
const { ApiError, validation, notFound, conflict, unauthenticated } = require('../../lib/errors');
const G = require('../../domain/day2/guest');
const R = require('../../domain/day2/registration');
const guest = require('./guest');

const BCRYPT_ROUNDS = 8; // same cost as the seeded users (db/reset.js)
const USER_COLS = 'user_id, email, role, tenant_id, league_id, club_id, player_id, display_name';

const emailTaken = (email) => conflict('EMAIL_ALREADY_REGISTERED', `An account for ${email} already exists.`, { email });

// The guest token must be usable: 401 unknown, revoked or expired; 409 already merged.
async function loadGuest(token) {
  const { rows } = await query('SELECT cart, merged, revoked, expires_at FROM guest_tokens WHERE token = $1', [token]);
  const row = rows[0];
  if (!row || row.revoked) throw unauthenticated('Unknown or revoked guest token.');
  if (G.isGuestTokenExpired(row.expires_at, Date.now())) {
    throw new ApiError(401, 'GUEST_TOKEN_EXPIRED', 'This guest token has expired. Request a new guest session.', { guest_token: token });
  }
  if (row.merged) throw conflict('GUEST_TOKEN_ALREADY_MERGED', 'This guest token has already been merged.', { guest_token: token });
  return Array.isArray(row.cart) ? row.cart : [];
}

// Best-effort merge after the account exists: a stock race never undoes the registration.
async function mergeStagedCart(token, userId, cart) {
  if (!cart.length) return { merged: false, items: [] };
  try {
    const r = await guest.mergeGuestCart({ guest_token: token, registered_user_id: userId, guest_cart: cart, test_write_block: false });
    return { merged: true, ...r.body };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return { merged: false, error: { code: e.code, message: e.message, details: e.details || {} } };
  }
}

/** Returns { user (row), cart_merge } or throws 400 / 401 / 404 TENANT_NOT_FOUND / 409. */
async function register(body) {
  const v = R.validateRegisterBody(body);
  if (!v.ok) throw validation(v.fields);
  const req = v.value;
  const cart = req.guest_token ? await loadGuest(req.guest_token) : [];
  if (req.tenant_id) {
    const t = await query('SELECT 1 FROM tenants WHERE tenant_id = $1', [req.tenant_id]);
    if (!t.rows.length) throw notFound('TENANT_NOT_FOUND', `Tenant ${req.tenant_id} does not exist.`, { tenant_id: req.tenant_id });
  }
  const dup = await query('SELECT 1 FROM users WHERE lower(email) = $1', [req.email]);
  if (dup.rows.length) throw emailTaken(req.email);

  const userId = R.newUserId(crypto.randomBytes(8).toString('hex'));
  const hash = await bcrypt.hash(req.password, BCRYPT_ROUNDS);
  let user;
  try {
    const { rows } = await query(
      `INSERT INTO users (user_id, email, password_hash, role, tenant_id, display_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${USER_COLS}`,
      [userId, req.email, hash, R.REGISTERED_ROLE, req.tenant_id, req.display_name]);
    user = rows[0];
  } catch (e) {
    if (e && e.code === '23505') throw emailTaken(req.email); // concurrent sign-up with the same email
    throw e;
  }
  const cartMerge = req.guest_token ? await mergeStagedCart(req.guest_token, userId, cart) : null;
  return { user, cart_merge: cartMerge };
}

module.exports = { register, BCRYPT_ROUNDS };
