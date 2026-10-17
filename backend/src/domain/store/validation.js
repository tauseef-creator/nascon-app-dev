'use strict';
// Checkout request schema checks (spec 5.12). Pure: returns the list of bad field names.
const { isObj, isInt, isStr, isId } = require('../../lib/validate');

const MAX_ITEMS = 10;
const MIN_QTY = 1;
const MAX_QTY = 10;

function validateCheckout(body) {
  const bad = [];
  if (!isObj(body)) return ['body'];

  if (!isId(body.order_id)) bad.push('order_id');
  if (!isId(body.customer_id)) bad.push('customer_id');

  const items = body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    bad.push('items');
  } else {
    const seen = new Set();
    let duplicate = false;
    items.forEach((it, i) => {
      if (!isObj(it)) {
        bad.push(`items[${i}]`);
        return;
      }
      if (!isId(it.variant_id)) bad.push(`items[${i}].variant_id`);
      else if (seen.has(it.variant_id)) duplicate = true;
      else seen.add(it.variant_id);
      if (!isInt(it.quantity) || it.quantity < MIN_QTY || it.quantity > MAX_QTY) bad.push(`items[${i}].quantity`);
    });
    if (duplicate) bad.push('items');
  }

  if (body.discount_code !== undefined && body.discount_code !== null && !isStr(body.discount_code)) {
    bad.push('discount_code');
  }

  if (!isObj(body.payment)) bad.push('payment');
  else if (!isStr(body.payment.token) || body.payment.token.length === 0) bad.push('payment.token');

  return [...new Set(bad)];
}

// Normalized view of a valid body: unknown fields dropped, missing discount_code -> null.
// Used both for processing and for the idempotency body hash.
function normalizeCheckout(body) {
  return {
    order_id: body.order_id,
    customer_id: body.customer_id,
    items: body.items.map((it) => ({ variant_id: it.variant_id, quantity: it.quantity })),
    discount_code: body.discount_code === undefined ? null : body.discount_code,
    payment: { token: body.payment.token },
  };
}

module.exports = { validateCheckout, normalizeCheckout, MAX_ITEMS, MIN_QTY, MAX_QTY };
