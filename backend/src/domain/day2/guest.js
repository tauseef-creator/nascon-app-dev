'use strict';
// Guest read-only boundary and progressive cart merge (FR-4.2 - FR-4.4, spec Part II 5.7,
// edge case 4). Pure functions only: no DB, no HTTP.
const { isObj, isInt, isStr, isBool } = require('../../lib/validate');

const GUEST_PREFIX = 'guest_';
const ANON_PREFIX = 'guest_anon_tok_';
const MAX_CART_ITEMS = 10;
const MAX_ID_LEN = 128;
const CURRENCY = 'PKR';

const nonEmpty = (v) => isStr(v) && v.length > 0 && v.length <= MAX_ID_LEN;

function isGuestTokenFormat(v) {
  return nonEmpty(v) && v.startsWith(GUEST_PREFIX) && v.length > GUEST_PREFIX.length;
}

// New anonymous viewer token (FR-4.2) from caller-supplied random hex.
function newGuestToken(randomHex) {
  return ANON_PREFIX + randomHex;
}

// Guest tokens are short-lived (FR-4.2). Lifetime in seconds from GUEST_TOKEN_TTL_S, default 24 h.
const DEFAULT_GUEST_TTL_S = 24 * 60 * 60;
function guestTokenTtlS(raw) {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_GUEST_TTL_S;
}

// Expiry instant for a token issued at nowMs.
function guestTokenExpiry(nowMs, ttlS) {
  return new Date(nowMs + ttlS * 1000);
}

// A null expiry never lapses (the seeded audit fixture token of spec 5.2).
function isGuestTokenExpired(expiresAt, nowMs) {
  if (expiresAt === null || expiresAt === undefined) return false;
  const t = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

/**
 * Schema check of a POST /audit/v1/guest/cart-merge body (spec 5.7 step 1).
 * Returns { ok, fields, value } where value has unknown fields dropped and
 * test_write_block defaulted to true.
 */
function validateMergeBody(body) {
  if (!isObj(body)) return { ok: false, fields: ['body'], value: null };
  const bad = [];
  if (!isGuestTokenFormat(body.guest_token)) bad.push('guest_token');
  if (!nonEmpty(body.registered_user_id)) bad.push('registered_user_id');
  const cart = body.guest_cart;
  if (!Array.isArray(cart) || cart.length < 1 || cart.length > MAX_CART_ITEMS) {
    bad.push('guest_cart');
  } else {
    cart.forEach((it, i) => {
      if (!isObj(it)) {
        bad.push(`guest_cart[${i}]`);
        return;
      }
      if (!nonEmpty(it.variant_id)) bad.push(`guest_cart[${i}].variant_id`);
      if (!isInt(it.quantity) || it.quantity < 1 || !Number.isSafeInteger(it.quantity)) bad.push(`guest_cart[${i}].quantity`);
    });
  }
  const twb = body.test_write_block;
  if (twb !== undefined && twb !== null && !isBool(twb)) bad.push('test_write_block');
  if (bad.length) return { ok: false, fields: bad, value: null };
  return {
    ok: true,
    fields: [],
    value: {
      guest_token: body.guest_token,
      registered_user_id: body.registered_user_id,
      guest_cart: cart.map((it) => ({ variant_id: it.variant_id, quantity: it.quantity })),
      test_write_block: twb === undefined || twb === null ? true : twb,
    },
  };
}

// Request identity for idempotent replay (edge case 4): (guest_token, registered_user_id, guest_cart).
function mergeIdentity(value) {
  return { guest_token: value.guest_token, registered_user_id: value.registered_user_id, guest_cart: value.guest_cart };
}

// Sum quantities of repeated variant ids, keeping first-seen order.
function aggregateItems(items) {
  const order = [];
  const qty = new Map();
  for (const it of items || []) {
    if (!qty.has(it.variant_id)) order.push(it.variant_id);
    qty.set(it.variant_id, (qty.get(it.variant_id) || 0) + it.quantity);
  }
  return order.map((variant_id) => ({ variant_id, quantity: qty.get(variant_id) }));
}

function uniqueVariantIds(items) {
  return [...new Set((items || []).map((it) => it.variant_id))];
}

// First variant id of `wanted` that is not in `known` (a Set or array), or null.
function firstMissingVariant(wanted, known) {
  const set = known instanceof Set ? known : new Set(known);
  return uniqueVariantIds(wanted).find((v) => !set.has(v)) || null;
}

/**
 * Spec 5.7 step 3: the merged quantity (existing member cart + guest cart) of every variant must
 * not exceed its available stock. Returns null, or { variant_id, requested, available } for the
 * first offending variant in guest cart order.
 */
function findOutOfStock(existingItems, guestItems, stockByVariant) {
  const existing = new Map(aggregateItems(existingItems).map((it) => [it.variant_id, it.quantity]));
  for (const it of aggregateItems(guestItems)) {
    const requested = (existing.get(it.variant_id) || 0) + it.quantity;
    const available = Number(stockByVariant[it.variant_id] ?? 0);
    if (requested > available) return { variant_id: it.variant_id, requested, available };
  }
  return null;
}

/**
 * Spec 5.7 step 5 / FR-4.4: merge guest items into the member cart. Same variant ids are summed and
 * capped by available stock; unit prices come from the catalogue. Existing items keep their order,
 * new variants are appended in guest cart order.
 */
function mergeCartItems(existingItems, guestItems, priceByVariant, stockByVariant) {
  const merged = aggregateItems([...(existingItems || []), ...(guestItems || [])]);
  const existingPrice = new Map((existingItems || []).map((it) => [it.variant_id, it.unit_price_minor]));
  return merged.map((it) => {
    const stock = stockByVariant[it.variant_id];
    const quantity = stock === undefined ? it.quantity : Math.min(it.quantity, Number(stock));
    const price = priceByVariant[it.variant_id] ?? existingPrice.get(it.variant_id) ?? 0;
    return { variant_id: it.variant_id, quantity, unit_price_minor: Number(price) };
  }).filter((it) => it.quantity > 0);
}

function cartTotals(items) {
  let totalItems = 0;
  let subtotal = 0;
  for (const it of items || []) {
    totalItems += it.quantity;
    subtotal += it.quantity * it.unit_price_minor;
  }
  return { total_items: totalItems, subtotal_minor: subtotal };
}

function activeCart(userId, items) {
  const t = cartTotals(items);
  return {
    user_id: userId,
    currency: CURRENCY,
    total_items: t.total_items,
    subtotal_minor: t.subtotal_minor,
    items: (items || []).map((it) => ({ variant_id: it.variant_id, quantity: it.quantity, unit_price_minor: it.unit_price_minor })),
  };
}

/**
 * Response body of spec 5.7 without the signature, plus the exact sig_payload of spec 5.3.
 * writeCheck = { verified: bool, code: int } from the simulated guest write.
 */
function buildMergeResponse({ guestToken, userId, items, writeCheck }) {
  const cart = activeCart(userId, items);
  const body = {
    guest_token: guestToken,
    write_block_verified: writeCheck.verified,
    write_rejection_code: writeCheck.code,
    cart_merged: true,
    active_cart: cart,
  };
  const sigPayload = {
    cart_merged: true,
    guest_token: guestToken,
    registered_user_id: userId,
    total_items: cart.total_items,
    write_rejection_code: writeCheck.code,
  };
  return { body, sigPayload };
}

// Interpret the outcome of the simulated guest write (spec 5.7 step 4).
// When the check is skipped, nothing was verified and no rejection code exists (0).
function writeCheckResult(testWriteBlock, rejectedStatus) {
  if (!testWriteBlock) return { verified: false, code: 0 };
  return { verified: rejectedStatus === 403, code: Number.isInteger(rejectedStatus) ? rejectedStatus : 0 };
}

/**
 * Guest cart staging (FR-4.4): add `quantity` of a variant to a staged guest cart. Returns
 * { ok, items } or { ok: false, error: { code, details } } when the staged total exceeds stock.
 */
function stageItem(items, variantId, quantity, stock) {
  const current = aggregateItems(items);
  const existing = current.find((it) => it.variant_id === variantId);
  const next = (existing ? existing.quantity : 0) + quantity;
  if (next > Number(stock)) {
    return { ok: false, error: { code: 'OUT_OF_STOCK', details: { variant_id: variantId, requested: next, available: Number(stock) } } };
  }
  if (existing) existing.quantity = next;
  else current.push({ variant_id: variantId, quantity: next });
  return { ok: true, items: current };
}

module.exports = {
  GUEST_PREFIX,
  ANON_PREFIX,
  MAX_CART_ITEMS,
  CURRENCY,
  isGuestTokenFormat,
  newGuestToken,
  DEFAULT_GUEST_TTL_S,
  guestTokenTtlS,
  guestTokenExpiry,
  isGuestTokenExpired,
  validateMergeBody,
  mergeIdentity,
  aggregateItems,
  uniqueVariantIds,
  firstMissingVariant,
  findOutOfStock,
  mergeCartItems,
  cartTotals,
  activeCart,
  buildMergeResponse,
  writeCheckResult,
  stageItem,
};
