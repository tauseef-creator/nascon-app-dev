'use strict';
// Guest access service (FR-4.2 - FR-4.4, spec Part II 5.7): anonymous viewer tokens, guest cart
// staging and the atomic, idempotent guest-to-member cart merge.
const crypto = require('crypto');
const { query, tx } = require('../../db/pool');
const { ApiError, validation, notFound, conflict, unauthenticated } = require('../../lib/errors');
const { signDay2, bodyHash } = require('../../lib/signing');
const { guestWriteGuard } = require('../../lib/guest');
const G = require('../../domain/day2/guest');

// Write endpoints the simulated guest write is pushed through (spec 5.7 step 4 and FR-4.3).
const PROBE_PATHS = ['/api/v1/chat', '/audit/v1/checkout', '/audit/v1/events'];

/**
 * Runs the real global guard (lib/guest.guestWriteGuard) against a simulated POST carrying the
 * guest token. Returns the HTTP status the guard answered with, or 0 if it let the write through.
 */
function simulateGuestWrite(token) {
  let result = 403;
  for (const path of PROBE_PATHS) {
    const req = { method: 'POST', path, headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 0,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(b) { this.body = b; return this; },
    };
    let passed = false;
    guestWriteGuard(req, res, () => { passed = true; });
    const ok = !passed && res.statusCode === 403 && res.body && res.body.error && res.body.error.code === 'GUEST_WRITE_FORBIDDEN';
    if (!ok) result = passed ? 0 : res.statusCode;
  }
  return result;
}

async function userExists(client, userId) {
  const { rows } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM players WHERE player_id = $1)
         OR EXISTS (SELECT 1 FROM users WHERE user_id = $1) AS found`, [userId]);
  return rows[0].found;
}

async function loadVariants(client, ids) {
  const { rows } = await client.query(
    'SELECT variant_id, price_minor, stock FROM variants WHERE variant_id = ANY($1::text[])', [ids]);
  const price = {};
  const stock = {};
  for (const r of rows) {
    price[r.variant_id] = Number(r.price_minor);
    stock[r.variant_id] = Number(r.stock);
  }
  return { price, stock, known: new Set(rows.map((r) => r.variant_id)) };
}

/**
 * POST /audit/v1/guest/cart-merge (spec 5.7). Returns { statusCode, body }; throws ApiError.
 * Order: 400 schema -> identical replay (200, stored) -> 404 user -> 404 variant ->
 * 409 OUT_OF_STOCK -> 409 GUEST_TOKEN_ALREADY_MERGED -> write-block probe -> atomic merge.
 */
async function mergeGuestCart(rawBody) {
  const v = G.validateMergeBody(rawBody);
  if (!v.ok) throw validation(v.fields);
  const req = v.value;
  const hash = bodyHash(G.mergeIdentity(req));
  const token = req.guest_token;
  const userId = req.registered_user_id;

  return tx(async (c) => {
    // Serialize merges per guest token (network migration replays race each other).
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`guest:${token}`]);
    const stored = await c.query('SELECT body_hash, response FROM cart_merges WHERE guest_token = $1', [token]);
    if (stored.rows.length && stored.rows[0].body_hash === hash) return { statusCode: 200, body: stored.rows[0].response, replay: true };

    if (!(await userExists(c, userId))) {
      throw notFound('PLAYER_NOT_FOUND', `Registered user ${userId} does not exist.`, { registered_user_id: userId });
    }
    const variants = await loadVariants(c, G.uniqueVariantIds(req.guest_cart));
    const missing = G.firstMissingVariant(req.guest_cart, variants.known);
    if (missing) throw notFound('VARIANT_NOT_FOUND', `Variant ${missing} does not exist.`, { variant_id: missing });

    // Serialize writers of the same member cart (several guest tokens can merge into one user).
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cart:${userId}`]);
    await c.query('INSERT INTO member_carts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    const cartRow = await c.query('SELECT items FROM member_carts WHERE user_id = $1 FOR UPDATE', [userId]);
    const existing = Array.isArray(cartRow.rows[0].items) ? cartRow.rows[0].items : [];

    const short = G.findOutOfStock(existing, req.guest_cart, variants.stock);
    if (short) throw conflict('OUT_OF_STOCK', `Not enough stock for ${short.variant_id}.`, short);

    const tok = await c.query('SELECT merged, revoked FROM guest_tokens WHERE token = $1 FOR UPDATE', [token]);
    if (stored.rows.length || (tok.rows.length && (tok.rows[0].merged || tok.rows[0].revoked))) {
      throw conflict('GUEST_TOKEN_ALREADY_MERGED', 'This guest token has already been merged.', { guest_token: token });
    }

    const writeCheck = G.writeCheckResult(req.test_write_block, req.test_write_block ? simulateGuestWrite(token) : 0);

    // Merging fills a cart only: inventory is reserved at checkout, never here.
    const items = G.mergeCartItems(existing, req.guest_cart, variants.price, variants.stock);
    await c.query('UPDATE member_carts SET items = $2, updated_at = now() WHERE user_id = $1', [userId, JSON.stringify(items)]);
    await c.query(
      `INSERT INTO guest_tokens (token, user_id, merged, cart) VALUES ($1, $2, true, '[]')
       ON CONFLICT (token) DO UPDATE SET user_id = $2, merged = true, cart = '[]'`, [token, userId]);

    const { body, sigPayload } = G.buildMergeResponse({ guestToken: token, userId, items, writeCheck });
    body.signature = signDay2(token, sigPayload);
    await c.query('INSERT INTO cart_merges (guest_token, body_hash, response) VALUES ($1, $2, $3)', [token, hash, body]);
    return { statusCode: 200, body, replay: false };
  });
}

// ---- Guest web player helpers (FR-4.2 / FR-4.4) ----

/** Issues a new anonymous, read-only viewer token: { guest_token, role, read_only }. */
async function issueGuestToken() {
  const token = G.newGuestToken(crypto.randomBytes(12).toString('hex'));
  await query('INSERT INTO guest_tokens (token) VALUES ($1)', [token]);
  return { guest_token: token, role: 'guest', read_only: true };
}

/** True when the token is a known guest token that is neither merged nor revoked. */
async function isActiveGuestToken(token) {
  if (!G.isGuestTokenFormat(token)) return false;
  const { rows } = await query('SELECT merged, revoked FROM guest_tokens WHERE token = $1', [token]);
  return rows.length > 0 && !rows[0].merged && !rows[0].revoked;
}

async function cartView(client, token, items) {
  const variants = await loadVariants(client, G.uniqueVariantIds(items));
  const priced = items.map((it) => ({
    variant_id: it.variant_id, quantity: it.quantity, unit_price_minor: variants.price[it.variant_id] ?? 0,
  }));
  const t = G.cartTotals(priced);
  return { guest_token: token, currency: G.CURRENCY, items: priced, count: t.total_items, subtotal_minor: t.subtotal_minor };
}

function invalidToken() {
  return unauthenticated('Unknown or revoked guest token.');
}

/** Staged guest cart: { guest_token, currency, items, count, subtotal_minor }. 401 for an unknown token. */
async function getGuestCart(token) {
  if (!G.isGuestTokenFormat(token)) throw invalidToken();
  const { rows } = await query('SELECT cart, revoked FROM guest_tokens WHERE token = $1', [token]);
  if (!rows.length || rows[0].revoked) throw invalidToken();
  return cartView({ query }, token, Array.isArray(rows[0].cart) ? rows[0].cart : []);
}

/**
 * Adds quantity of a variant to the guest's staged cart (local staging only, no stock is reserved).
 * 400 VALIDATION_ERROR, 401 unknown token, 404 VARIANT_NOT_FOUND, 409 GUEST_TOKEN_ALREADY_MERGED
 * or OUT_OF_STOCK. Returns the cart view of getGuestCart.
 */
async function stageGuestCart(token, variantId, quantity) {
  const bad = [];
  if (typeof variantId !== 'string' || variantId.length === 0 || variantId.length > 128) bad.push('variant_id');
  if (!Number.isSafeInteger(quantity) || quantity < 1) bad.push('quantity');
  if (bad.length) throw validation(bad);
  if (!G.isGuestTokenFormat(token)) throw invalidToken();
  return tx(async (c) => {
    const { rows } = await c.query('SELECT cart, merged, revoked FROM guest_tokens WHERE token = $1 FOR UPDATE', [token]);
    if (!rows.length || rows[0].revoked) throw invalidToken();
    if (rows[0].merged) throw conflict('GUEST_TOKEN_ALREADY_MERGED', 'This guest token has already been merged.', { guest_token: token });
    const variants = await loadVariants(c, [variantId]);
    if (!variants.known.has(variantId)) throw notFound('VARIANT_NOT_FOUND', `Variant ${variantId} does not exist.`, { variant_id: variantId });
    const staged = G.stageItem(Array.isArray(rows[0].cart) ? rows[0].cart : [], variantId, quantity, variants.stock[variantId]);
    if (!staged.ok) throw new ApiError(409, staged.error.code, `Not enough stock for ${variantId}.`, staged.error.details);
    await c.query('UPDATE guest_tokens SET cart = $2 WHERE token = $1', [token, JSON.stringify(staged.items)]);
    return cartView(c, token, staged.items);
  });
}

module.exports = { mergeGuestCart, issueGuestToken, isActiveGuestToken, getGuestCart, stageGuestCart, simulateGuestWrite };
