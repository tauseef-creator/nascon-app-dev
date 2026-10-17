'use strict';
// Checkout service flow against an in-memory stand-in for Postgres (no network needed).

const mockDb = {
  variants: new Map(),
  discounts: new Map(),
  orders: new Map(),
  seq: 0,
  events: [],
};

function reset(stockM = 1, stockL = 5) {
  mockDb.variants = new Map([
    ['var-jersey-001-M', { variant_id: 'var-jersey-001-M', product_id: 'prod-jersey-001', price_minor: '450000', currency: 'PKR', stock: stockM, reserved: 0 }],
    ['var-jersey-001-L', { variant_id: 'var-jersey-001-L', product_id: 'prod-jersey-001', price_minor: '450000', currency: 'PKR', stock: stockL, reserved: 0 }],
  ]);
  mockDb.discounts = new Map([['WELCOME10', 10]]);
  mockDb.orders = new Map();
  mockDb.seq = 0;
  mockDb.events = [];
}

const res = (rows) => ({ rows, rowCount: rows.length });

async function mockQuery(sql, p = []) {
  await new Promise((r) => setImmediate(r)); // interleave concurrent requests
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.startsWith('SELECT variant_id FROM variants')) return res(p[0].filter((id) => mockDb.variants.has(id)).map((variant_id) => ({ variant_id })));
  if (s.startsWith('SELECT variant_id, stock FROM variants')) return res(p[0].filter((id) => mockDb.variants.has(id)).map((id) => ({ ...mockDb.variants.get(id) })));
  if (s.startsWith('SELECT variant_id, stock, reserved FROM variants')) {
    const v = mockDb.variants.get(p[0]);
    return res(v ? [{ variant_id: v.variant_id, stock: v.stock, reserved: v.reserved }] : []);
  }
  if (s.startsWith('SELECT percent FROM discount_codes')) return res(mockDb.discounts.has(p[0]) ? [{ percent: mockDb.discounts.get(p[0]) }] : []);
  if (s.startsWith('INSERT INTO orders')) {
    if (mockDb.orders.has(p[0])) return res([]);
    mockDb.orders.set(p[0], { order_id: p[0], body_hash: p[1], customer_id: p[2], status: 'pending', status_code: null, response: null });
    return res([{ order_id: p[0] }]);
  }
  if (s.startsWith('SELECT body_hash, status')) {
    const o = mockDb.orders.get(p[0]);
    return res(o ? [{ ...o, response: o.response && JSON.parse(o.response) }] : []);
  }
  if (s.startsWith('DELETE FROM orders')) {
    const o = mockDb.orders.get(p[0]);
    if (o && o.body_hash === p[1] && o.status === 'pending') mockDb.orders.delete(p[0]);
    return res([]);
  }
  if (s.startsWith('UPDATE variants SET stock = stock - $2')) {
    const v = mockDb.variants.get(p[0]);
    if (!v || v.stock < p[1]) return res([]);
    v.stock -= p[1];
    v.reserved += p[1];
    return res([{ price_minor: v.price_minor }]);
  }
  if (s.startsWith('UPDATE variants SET stock = stock + $2')) {
    const v = mockDb.variants.get(p[0]);
    v.stock += p[1];
    v.reserved -= p[1];
    return res([]);
  }
  if (s.startsWith('UPDATE variants SET reserved = reserved - $2')) {
    mockDb.variants.get(p[0]).reserved -= p[1];
    return res([]);
  }
  if (s.startsWith('UPDATE orders SET status')) {
    const o = mockDb.orders.get(p[0]);
    if (o && o.body_hash === p[1]) {
      Object.assign(o, s.includes("'paid'") ? { status: 'paid', status_code: 201 } : { status: 'cancelled', status_code: 402 }, { response: p[2] });
    }
    return res([]);
  }
  if (s.startsWith('INSERT INTO app_state')) {
    mockDb.seq += 1;
    return res([{ seq: mockDb.seq }]);
  }
  throw new Error(`unexpected SQL: ${s}`);
}

jest.mock('../backend/src/db/pool', () => ({
  query: (...a) => mockQuery(...a),
  tx: async (fn) => {
    // Undo log of this transaction's own reservations (rows changed by others are untouched).
    const undo = [];
    const client = {
      query: async (sql, p) => {
        const r = await mockQuery(sql, p);
        if (sql.includes('stock = stock - $2') && r.rowCount) undo.push([p[0], p[1]]);
        return r;
      },
    };
    try {
      return await fn(client);
    } catch (err) {
      for (const [id, q] of undo) {
        const v = mockDb.variants.get(id);
        v.stock += q;
        v.reserved -= q;
      }
      throw err;
    }
  },
}));
jest.mock('../backend/src/lib/queue', () => ({ publish: (type, data) => mockDb.events.push({ type, data }) }));

process.env.DAY1_SALT = 'demo-salt';
delete process.env.MINIO_ENDPOINT;
const store = require('../backend/src/services/store');
const { sign } = require('../backend/src/lib/signing');

const body = (over = {}) => ({
  order_id: 'ord-001',
  customer_id: 'cust-001',
  items: [{ variant_id: 'var-jersey-001-M', quantity: 1 }],
  discount_code: null,
  payment: { token: 'tok_success' },
  ...over,
});

async function call(b) {
  try {
    return await store.checkout(b);
  } catch (err) {
    if (!err.status) throw err;
    return { statusCode: err.status, body: { error: { code: err.code, details: err.details } } };
  }
}

beforeEach(() => reset());

describe('checkout service', () => {
  test('success returns 201 with signed receipt, then replay returns 200 without a second reservation', async () => {
    const r = await call(body());
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({
      order_id: 'ord-001', status: 'paid', currency: 'PKR',
      items: [{ variant_id: 'var-jersey-001-M', quantity: 1, unit_price_minor: 450000 }],
      subtotal_minor: 450000, discount_minor: 0, total_minor: 450000,
      payment: { authorization_id: 'auth_1', capture_id: 'cap_1', state: 'captured' },
    });
    expect(r.body.receipt.signature).toBe(sign('ord-001', r.body.receipt.payload, 'demo-salt'));
    expect(r.body.receipt.payload.paid_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Buffer.from(r.body.receipt.pdf_base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(await store.getInventory('var-jersey-001-M')).toEqual({ variant_id: 'var-jersey-001-M', stock: 0, reserved: 0 });
    expect(mockDb.events).toEqual([{ type: 'order.status_changed', data: expect.objectContaining({ order_id: 'ord-001', from: 'pending', to: 'paid' }) }]);

    const again = await call(body({ unknown_field: 1 }));
    expect(again.statusCode).toBe(200);
    expect(again.body).toEqual(r.body);
    expect((await store.getInventory('var-jersey-001-M')).stock).toBe(0);

    const dup = await call(body({ customer_id: 'cust-002' }));
    expect(dup).toEqual({ statusCode: 409, body: { error: { code: 'DUPLICATE_ORDER_ID', details: { order_id: 'ord-001' } } } });
  });

  test('validation, missing variant and invalid discount follow the validation order', async () => {
    expect((await call(body({ items: [] }))).body.error).toEqual({ code: 'VALIDATION_ERROR', details: { fields: ['items'] } });
    expect((await call(body({ items: [{ variant_id: 'nope', quantity: 1 }], discount_code: 'BAD' }))).body.error)
      .toEqual({ code: 'VARIANT_NOT_FOUND', details: { variant_id: 'nope' } });
    const bad = await call(body({ discount_code: 'BAD' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_DISCOUNT_CODE');
  });

  test('discount code WELCOME10 floors 10 percent', async () => {
    const r = await call(body({ items: [{ variant_id: 'var-jersey-001-L', quantity: 3 }], discount_code: 'WELCOME10' }));
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ subtotal_minor: 1350000, discount_minor: 135000, total_minor: 1215000 });
    expect(await store.getInventory('var-jersey-001-L')).toEqual({ variant_id: 'var-jersey-001-L', stock: 2, reserved: 0 });
  });

  test('declined and capture failure release stock; stored 402 replays', async () => {
    const d = await call(body({ order_id: 'ord-d', payment: { token: 'tok_declined' } }));
    expect(d.statusCode).toBe(402);
    expect(d.body.error.code).toBe('PAYMENT_DECLINED');
    expect(await store.getInventory('var-jersey-001-M')).toEqual({ variant_id: 'var-jersey-001-M', stock: 1, reserved: 0 });
    const replay = await call(body({ order_id: 'ord-d', payment: { token: 'tok_declined' } }));
    expect(replay.statusCode).toBe(402);
    expect(replay.body.error.code).toBe('PAYMENT_DECLINED');

    const c = await call(body({ order_id: 'ord-c', payment: { token: 'tok_capture_fail' } }));
    expect(c.statusCode).toBe(402);
    expect(c.body.error.code).toBe('PAYMENT_CAPTURE_FAILED');
    expect((await store.getInventory('var-jersey-001-M')).stock).toBe(1);

    const ok = await call(body({ order_id: 'ord-ok' }));
    expect(ok.statusCode).toBe(201);
    expect(mockDb.events.map((e) => e.data.to)).toEqual(['cancelled', 'cancelled', 'paid']);
  });

  test('20 concurrent buyers of the last unit: one 201, nineteen 409 OUT_OF_STOCK', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => call(body({ order_id: `ord-burst-${i}` }))));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
    for (const r of results.filter((x) => x.statusCode === 409)) {
      expect(r.body.error).toEqual({ code: 'OUT_OF_STOCK', details: { variant_id: 'var-jersey-001-M' } });
    }
    expect(await store.getInventory('var-jersey-001-M')).toEqual({ variant_id: 'var-jersey-001-M', stock: 0, reserved: 0 });
    // Losers left no order row behind, so the id can be used again later.
    expect(mockDb.orders.size).toBe(1);
  });

  test('multi-item order reserves all or nothing and reports the first short item', async () => {
    reset(1, 0);
    const r = await call(body({ items: [{ variant_id: 'var-jersey-001-M', quantity: 1 }, { variant_id: 'var-jersey-001-L', quantity: 1 }] }));
    expect(r.body.error).toEqual({ code: 'OUT_OF_STOCK', details: { variant_id: 'var-jersey-001-L' } });
    expect(await store.getInventory('var-jersey-001-M')).toEqual({ variant_id: 'var-jersey-001-M', stock: 1, reserved: 0 });
  });

  test('concurrent identical requests reserve once', async () => {
    reset(5, 5);
    const [a, b] = await Promise.all([call(body()), call(body())]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect((await store.getInventory('var-jersey-001-M')).stock).toBe(4);
  });

  test('inventory 404 for unknown or malformed variant ids', async () => {
    for (const id of ['var-nope', "x' OR 1=1 --"]) {
      await expect(store.getInventory(id)).rejects.toMatchObject({ status: 404, code: 'VARIANT_NOT_FOUND' });
    }
  });
});
