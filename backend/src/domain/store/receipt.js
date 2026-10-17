'use strict';
// Receipt payload and checkout response builders (spec 5.12).
const { computeTotals } = require('./money');

const CURRENCY = 'PKR';

// lines: [{ variant_id, quantity, unit_price_minor }] in request order.
function buildReceiptPayload({ order_id, customer_id, lines, discountPercent = 0, paid_at }) {
  const items = lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_price_minor: l.unit_price_minor }));
  const totals = computeTotals(items, discountPercent);
  return {
    order_id,
    customer_id,
    items,
    subtotal_minor: totals.subtotal_minor,
    discount_minor: totals.discount_minor,
    total_minor: totals.total_minor,
    currency: CURRENCY,
    paid_at,
  };
}

// payment: { authorization_id, capture_id }; signature and pdfBase64 are computed by the caller.
function buildOrderResponse({ payload, payment, signature, pdfBase64 }) {
  return {
    order_id: payload.order_id,
    status: 'paid',
    currency: CURRENCY,
    items: payload.items.map((i) => ({ ...i })),
    subtotal_minor: payload.subtotal_minor,
    discount_minor: payload.discount_minor,
    total_minor: payload.total_minor,
    payment: { authorization_id: payment.authorization_id, capture_id: payment.capture_id, state: 'captured' },
    receipt: { payload, signature, pdf_base64: pdfBase64 },
  };
}

module.exports = { CURRENCY, buildReceiptPayload, buildOrderResponse };
