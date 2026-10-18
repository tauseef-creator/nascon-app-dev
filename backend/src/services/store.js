'use strict';
// Checkout and inventory (spec 5.12, FR-2.3, NFR-3).
//
// Flow: validate (400) -> variants exist (404) -> discount code (400) -> claim order_id
// (idempotency: replay 200 / DUPLICATE_ORDER_ID 409) -> atomic reservation of all items
// (OUT_OF_STOCK 409) -> mock gateway (402, reservation released) -> commit, receipt, 201.
const { query, tx } = require('../db/pool');
const { ApiError, validation, badRequest, notFound, conflict, errorBody } = require('../lib/errors');
const { bodyHash, sign } = require('../lib/signing');
const { nowIso, isId } = require('../lib/validate');
const { publish } = require('../lib/queue');
const {
  validateCheckout, normalizeCheckout, mockGateway, GATEWAY_MESSAGES,
  buildReceiptPayload, buildOrderResponse, statusChangedEvent,
} = require('../domain/store');
const { generateReceiptPdf, uploadReceipt } = require('./pdf');

const PENDING_WAIT_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byVariant = (a, b) => (a.variant_id < b.variant_id ? -1 : a.variant_id > b.variant_id ? 1 : 0);

const outOfStock = (variantId) =>
  conflict('OUT_OF_STOCK', `Variant ${variantId} has no stock left.`, { variant_id: variantId });
const duplicateOrder = (orderId) =>
  conflict('DUPLICATE_ORDER_ID', `Order ${orderId} already exists with a different body.`, { order_id: orderId });

// Claim the order_id with a pending row. Returns { replay } for an identical earlier request.
async function claimOrder(req, hash) {
  const deadline = Date.now() + PENDING_WAIT_MS;
  for (;;) {
    const ins = await query(
      `INSERT INTO orders (order_id, body_hash, customer_id, status) VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (order_id) DO NOTHING RETURNING order_id`,
      [req.order_id, hash, req.customer_id],
    );
    if (ins.rowCount) return {};
    const { rows } = await query('SELECT body_hash, status, status_code, response FROM orders WHERE order_id = $1', [req.order_id]);
    if (!rows.length) continue; // the other attempt released the id; try again
    const row = rows[0];
    if (row.body_hash !== hash) throw duplicateOrder(req.order_id);
    if (row.status === 'pending') {
      // Same request still in flight on another connection: wait for its stored result.
      if (Date.now() > deadline) throw duplicateOrder(req.order_id);
      await sleep(20);
      continue;
    }
    return { replay: { statusCode: row.status_code === 201 ? 200 : row.status_code, body: row.response } };
  }
}

const dropPending = (orderId, hash) =>
  query("DELETE FROM orders WHERE order_id = $1 AND body_hash = $2 AND status = 'pending'", [orderId, hash]).catch(() => {});

// Reserve every item in one transaction (sorted ids avoid deadlocks). All or nothing.
// Returns Map variant_id -> current unit price (minor units).
async function reserve(items) {
  const sorted = [...items].sort(byVariant);
  try {
    return await tx(async (c) => {
      const prices = new Map();
      for (const it of sorted) {
        const r = await c.query(
          `UPDATE variants SET stock = stock - $2, reserved = reserved + $2
           WHERE variant_id = $1 AND stock >= $2 RETURNING price_minor`,
          [it.variant_id, it.quantity],
        );
        if (!r.rowCount) throw outOfStock(it.variant_id);
        prices.set(it.variant_id, Number(r.rows[0].price_minor));
      }
      return prices;
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'OUT_OF_STOCK' && items.length > 1) {
      // Report the first item in request order that cannot be satisfied.
      const { rows } = await query('SELECT variant_id, stock FROM variants WHERE variant_id = ANY($1::text[])', [items.map((i) => i.variant_id)]);
      const stock = new Map(rows.map((r) => [r.variant_id, r.stock]));
      const first = items.find((i) => (stock.get(i.variant_id) ?? 0) < i.quantity);
      if (first) throw outOfStock(first.variant_id);
    }
    throw err;
  }
}

async function release(items) {
  await tx(async (c) => {
    for (const it of [...items].sort(byVariant)) {
      await c.query('UPDATE variants SET stock = stock + $2, reserved = reserved - $2 WHERE variant_id = $1', [it.variant_id, it.quantity]);
    }
  });
}

// Per-reset payment sequence (app_state is wiped by /reset), so ids read auth_1, auth_2, ...
async function nextPaymentSeq() {
  const { rows } = await query(
    `INSERT INTO app_state (key, value) VALUES ('store_payment_seq', '1'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = to_jsonb((app_state.value #>> '{}')::int + 1)
     RETURNING (value #>> '{}')::int AS seq`,
  );
  return rows[0].seq;
}

// Real-time push of the transition to the owning user (FR-5.2) through the notification bus, so a
// failed delivery is retried and dead-lettered. Fire and forget: checkout never waits on it.
function pushOrderStatus(event) {
  if (!event.customer_id) return;
  // eslint-disable-next-line global-require
  const bus = require('./day2/bus');
  // eslint-disable-next-line global-require
  require('./day2/notify').deliver(
    { type: 'order_status', user_id: event.customer_id, ...event, status: event.to },
    { transport: async (e) => { bus.emitOrderStatus(event.customer_id, e); } },
  ).catch(() => {});
}

function emitStatus(req, from, to, reason = null) {
  const event = statusChangedEvent({ order_id: req.order_id, customer_id: req.customer_id, from, to, at: nowIso(), reason });
  publish('order.status_changed', event);
  pushOrderStatus(event);
}

async function checkout(body) {
  // 1) schema
  const bad = validateCheckout(body);
  if (bad.length) throw validation(bad);
  const req = normalizeCheckout(body);

  // 2) referenced variants
  const ids = req.items.map((i) => i.variant_id);
  const found = await query('SELECT variant_id FROM variants WHERE variant_id = ANY($1::text[])', [ids]);
  const known = new Set(found.rows.map((r) => r.variant_id));
  const missing = ids.find((id) => !known.has(id));
  if (missing) throw notFound('VARIANT_NOT_FOUND', `Variant ${missing} does not exist.`, { variant_id: missing });

  // 3) discount code
  let percent = 0;
  if (req.discount_code !== null) {
    const d = await query('SELECT percent FROM discount_codes WHERE code = $1', [req.discount_code]);
    if (!d.rowCount) throw badRequest('INVALID_DISCOUNT_CODE', `Discount code ${req.discount_code} is not valid.`, { discount_code: req.discount_code });
    percent = d.rows[0].percent;
  }

  // 4) idempotency (before reserving, so a replay never reserves twice)
  const hash = bodyHash(req);
  const claim = await claimOrder(req, hash);
  if (claim.replay) return claim.replay;

  // 5) reservation
  let prices;
  try {
    prices = await reserve(req.items);
  } catch (err) {
    await dropPending(req.order_id, hash);
    throw err;
  }

  let held = true;
  try {
    // 6) mock gateway
    const gw = mockGateway(req.payment.token, await nextPaymentSeq());
    if (!gw.captured) {
      await release(req.items);
      held = false;
      const err = new ApiError(402, gw.errorCode, GATEWAY_MESSAGES[gw.errorCode], {});
      await query(
        "UPDATE orders SET status = 'cancelled', status_code = 402, response = $3 WHERE order_id = $1 AND body_hash = $2",
        [req.order_id, hash, JSON.stringify(errorBody(err))],
      );
      emitStatus(req, 'pending', 'cancelled', gw.errorCode);
      throw err;
    }

    // 7) receipt and commit
    const payload = buildReceiptPayload({
      order_id: req.order_id,
      customer_id: req.customer_id,
      lines: req.items.map((i) => ({ ...i, unit_price_minor: prices.get(i.variant_id) })),
      discountPercent: percent,
      paid_at: nowIso(),
    });
    const pdf = await generateReceiptPdf(payload);
    const response = buildOrderResponse({ payload, payment: gw, signature: sign(req.order_id, payload), pdfBase64: pdf.toString('base64') });

    await tx(async (c) => {
      for (const it of [...req.items].sort(byVariant)) {
        await c.query('UPDATE variants SET reserved = reserved - $2 WHERE variant_id = $1', [it.variant_id, it.quantity]);
      }
      await c.query(
        "UPDATE orders SET status = 'paid', status_code = 201, response = $3 WHERE order_id = $1 AND body_hash = $2",
        [req.order_id, hash, JSON.stringify(response)],
      );
    });
    held = false;
    emitStatus(req, 'pending', 'paid');
    uploadReceipt(req.order_id, pdf);
    return { statusCode: 201, body: response };
  } catch (err) {
    if (held) {
      await release(req.items).catch(() => {});
      await dropPending(req.order_id, hash);
    }
    throw err;
  }
}

async function getInventory(variantId) {
  const notFoundErr = notFound('VARIANT_NOT_FOUND', `Variant ${variantId} does not exist.`, { variant_id: variantId });
  if (!isId(variantId)) throw notFoundErr;
  const { rows } = await query('SELECT variant_id, stock, reserved FROM variants WHERE variant_id = $1', [variantId]);
  if (!rows.length) throw notFoundErr;
  return { variant_id: rows[0].variant_id, stock: rows[0].stock, reserved: rows[0].reserved };
}

// Catalogue for the mobile store screen. tenantId optional (all tenants when omitted).
async function listProducts(tenantId) {
  const params = [];
  let where = '';
  if (tenantId) {
    params.push(tenantId);
    where = 'WHERE p.tenant_id = $1';
  }
  const { rows } = await query(
    `SELECT p.product_id, p.tenant_id, p.club_id, p.name, p.category, p.data,
            v.variant_id, v.size, v.color, v.price_minor, v.currency, v.stock, v.reserved
     FROM products p LEFT JOIN variants v ON v.product_id = p.product_id
     ${where} ORDER BY p.product_id, v.variant_id`,
    params,
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.product_id)) {
      out.set(r.product_id, {
        product_id: r.product_id, tenant_id: r.tenant_id, club_id: r.club_id, name: r.name,
        category: r.category, description: (r.data && r.data.description) || null,
        image_url: r.data && r.data.image ? `/media/${r.data.image}` : null, variants: [],
      });
    }
    if (r.variant_id) {
      out.get(r.product_id).variants.push({
        variant_id: r.variant_id, size: r.size, color: r.color, price_minor: Number(r.price_minor),
        currency: r.currency, stock: r.stock, reserved: r.reserved,
      });
    }
  }
  return [...out.values()];
}

module.exports = { checkout, getInventory, listProducts, pushOrderStatus };
