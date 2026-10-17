'use strict';
const zlib = require('zlib');
const store = require('../backend/src/domain/store');
const { generateReceiptPdf } = require('../backend/src/services/pdf');
const { sign } = require('../backend/src/lib/signing');

const validBody = (over = {}) => ({
  order_id: 'ord-001',
  customer_id: 'cust-001',
  items: [{ variant_id: 'var-jersey-001-M', quantity: 1 }],
  discount_code: null,
  payment: { token: 'tok_success' },
  ...over,
});

describe('validateCheckout (spec 5.12)', () => {
  test('valid body has no bad fields; missing discount_code is allowed', () => {
    expect(store.validateCheckout(validBody())).toEqual([]);
    const b = validBody();
    delete b.discount_code;
    expect(store.validateCheckout(b)).toEqual([]);
    expect(store.validateCheckout(validBody({ discount_code: 'WELCOME10', extra: 1 }))).toEqual([]);
  });

  test('non-object body', () => {
    expect(store.validateCheckout(null)).toEqual(['body']);
    expect(store.validateCheckout([])).toEqual(['body']);
  });

  test('bad ids and missing required fields', () => {
    const bad = store.validateCheckout({ order_id: "x'; DROP TABLE orders;--", customer_id: 5 });
    expect(bad).toEqual(expect.arrayContaining(['order_id', 'customer_id', 'items', 'payment']));
    expect(store.validateCheckout(validBody({ order_id: 'a|b' }))).toEqual(['order_id']);
    expect(store.validateCheckout(validBody({ order_id: 'x'.repeat(65) }))).toEqual(['order_id']);
  });

  test('items count 1..10', () => {
    expect(store.validateCheckout(validBody({ items: [] }))).toEqual(['items']);
    expect(store.validateCheckout(validBody({ items: 'x' }))).toEqual(['items']);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ variant_id: `v${i}`, quantity: 1 }));
    expect(store.validateCheckout(validBody({ items: eleven }))).toEqual(['items']);
    expect(store.validateCheckout(validBody({ items: eleven.slice(0, 10) }))).toEqual([]);
  });

  test('quantity integer 1..10, item objects, variant ids', () => {
    for (const q of [0, 11, 1.5, '1', null, true]) {
      expect(store.validateCheckout(validBody({ items: [{ variant_id: 'v1', quantity: q }] }))).toEqual(['items[0].quantity']);
    }
    expect(store.validateCheckout(validBody({ items: [{ variant_id: 'v1', quantity: 10 }] }))).toEqual([]);
    expect(store.validateCheckout(validBody({ items: ['x'] }))).toEqual(['items[0]']);
    expect(store.validateCheckout(validBody({ items: [{ quantity: 1 }] }))).toEqual(['items[0].variant_id']);
  });

  test('duplicate variant ids are rejected', () => {
    const items = [{ variant_id: 'v1', quantity: 1 }, { variant_id: 'v1', quantity: 2 }];
    expect(store.validateCheckout(validBody({ items }))).toEqual(['items']);
  });

  test('discount_code and payment token types', () => {
    expect(store.validateCheckout(validBody({ discount_code: 10 }))).toEqual(['discount_code']);
    expect(store.validateCheckout(validBody({ payment: 'tok_success' }))).toEqual(['payment']);
    expect(store.validateCheckout(validBody({ payment: {} }))).toEqual(['payment.token']);
    expect(store.validateCheckout(validBody({ payment: { token: '' } }))).toEqual(['payment.token']);
  });

  test('normalizeCheckout drops unknown fields and defaults discount_code to null', () => {
    const b = validBody({ extra: true });
    delete b.discount_code;
    b.items[0].note = 'x';
    b.payment.extra = 1;
    expect(store.normalizeCheckout(b)).toEqual({
      order_id: 'ord-001',
      customer_id: 'cust-001',
      items: [{ variant_id: 'var-jersey-001-M', quantity: 1 }],
      discount_code: null,
      payment: { token: 'tok_success' },
    });
    expect(store.normalizeCheckout(validBody({ discount_code: 'WELCOME10' })).discount_code).toBe('WELCOME10');
  });
});

describe('money', () => {
  test('computeTotals without discount', () => {
    expect(store.computeTotals([{ quantity: 1, unit_price_minor: 450000 }])).toEqual({ subtotal_minor: 450000, discount_minor: 0, total_minor: 450000 });
    expect(store.computeTotals([{ quantity: 2, unit_price_minor: 450000 }, { quantity: 3, unit_price_minor: 100 }], 0))
      .toEqual({ subtotal_minor: 900300, discount_minor: 0, total_minor: 900300 });
  });

  test('discount is floor(subtotal * percent / 100)', () => {
    expect(store.computeTotals([{ quantity: 1, unit_price_minor: 450000 }], 10)).toEqual({ subtotal_minor: 450000, discount_minor: 45000, total_minor: 405000 });
    expect(store.computeTotals([{ quantity: 1, unit_price_minor: 999 }], 10)).toEqual({ subtotal_minor: 999, discount_minor: 99, total_minor: 900 });
    expect(store.computeTotals([{ quantity: 3, unit_price_minor: 33 }], null)).toEqual({ subtotal_minor: 99, discount_minor: 0, total_minor: 99 });
  });

  test('formatPkr uses major units, two decimals, no thousands separator', () => {
    expect(store.formatPkr(450000)).toBe('PKR 4500.00');
    expect(store.formatPkr(405000)).toBe('PKR 4050.00');
    expect(store.formatPkr(123456789)).toBe('PKR 1234567.89');
    expect(store.formatPkr(5)).toBe('PKR 0.05');
    expect(store.formatPkr(0)).toBe('PKR 0.00');
    expect(store.formatPkr(-150)).toBe('PKR -1.50');
    expect(store.formatPkr(undefined)).toBe('PKR 0.00');
  });
});

describe('mock gateway', () => {
  test('tok_success authorizes and captures', () => {
    expect(store.mockGateway('tok_success', 1)).toEqual({
      authorized: true, captured: true, authorization_id: 'auth_1', capture_id: 'cap_1', state: 'captured', errorCode: null,
    });
    expect(store.mockGateway('tok_success').authorization_id).toBe('auth_1');
  });

  test('tok_declined fails authorization', () => {
    const r = store.mockGateway('tok_declined', 2);
    expect(r).toMatchObject({ authorized: false, captured: false, authorization_id: null, errorCode: 'PAYMENT_DECLINED' });
  });

  test('tok_capture_fail authorizes then fails capture', () => {
    const r = store.mockGateway('tok_capture_fail', 3);
    expect(r).toMatchObject({ authorized: true, captured: false, authorization_id: 'auth_3', capture_id: null, state: 'voided', errorCode: 'PAYMENT_CAPTURE_FAILED' });
  });

  test('unknown token is declined', () => {
    expect(store.mockGateway('tok_whatever', 4).errorCode).toBe('PAYMENT_DECLINED');
    expect(store.GATEWAY_MESSAGES.PAYMENT_DECLINED).toEqual(expect.any(String));
  });

  test('refund simulation', () => {
    expect(store.mockRefund('cap_1', 7)).toEqual({ refunded: true, refund_id: 'ref_7', state: 'refunded' });
    expect(store.mockRefund(null)).toEqual({ refunded: false, refund_id: null, state: 'refund_failed' });
    expect(store.mockRefund('cap_1').refund_id).toBe('ref_1');
  });
});

describe('receipt and response', () => {
  const payload = store.buildReceiptPayload({
    order_id: 'ord-001',
    customer_id: 'cust-001',
    lines: [{ variant_id: 'var-jersey-001-M', quantity: 1, unit_price_minor: 450000, extra: 'dropped' }],
    paid_at: '2026-10-17T11:20:05Z',
  });

  test('payload matches spec 5.12 exactly', () => {
    expect(payload).toEqual({
      order_id: 'ord-001',
      customer_id: 'cust-001',
      items: [{ variant_id: 'var-jersey-001-M', quantity: 1, unit_price_minor: 450000 }],
      subtotal_minor: 450000,
      discount_minor: 0,
      total_minor: 450000,
      currency: 'PKR',
      paid_at: '2026-10-17T11:20:05Z',
    });
  });

  test('discounted payload adds up', () => {
    const p = store.buildReceiptPayload({
      order_id: 'o', customer_id: 'c', discountPercent: 10, paid_at: 'x',
      lines: [{ variant_id: 'a', quantity: 2, unit_price_minor: 450000 }],
    });
    expect(p.subtotal_minor - p.discount_minor).toBe(p.total_minor);
    expect(p.discount_minor).toBe(90000);
  });

  test('order response wraps payload, payment and signature', () => {
    const signature = sign('ord-001', payload, 'demo-salt');
    const r = store.buildOrderResponse({ payload, payment: { authorization_id: 'auth_1', capture_id: 'cap_1', extra: 1 }, signature, pdfBase64: 'JVBERi0=' });
    expect(r).toEqual({
      order_id: 'ord-001', status: 'paid', currency: 'PKR',
      items: [{ variant_id: 'var-jersey-001-M', quantity: 1, unit_price_minor: 450000 }],
      subtotal_minor: 450000, discount_minor: 0, total_minor: 450000,
      payment: { authorization_id: 'auth_1', capture_id: 'cap_1', state: 'captured' },
      receipt: { payload, signature, pdf_base64: 'JVBERi0=' },
    });
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('order state machine', () => {
  test('statuses', () => {
    expect(store.ORDER_STATUSES).toEqual(['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded']);
    expect(store.isOrderStatus('Paid')).toBe(true);
    expect(store.isOrderStatus('lost')).toBe(false);
    expect(store.isOrderStatus(3)).toBe(false);
  });

  test('allowed and illegal transitions', () => {
    expect(store.canTransition('Pending', 'Paid')).toBe(true);
    expect(store.canTransition('pending', 'cancelled')).toBe(true);
    expect(store.canTransition('paid', 'packed')).toBe(true);
    expect(store.canTransition('packed', 'shipped')).toBe(true);
    expect(store.canTransition('shipped', 'delivered')).toBe(true);
    expect(store.canTransition('delivered', 'refunded')).toBe(true);
    expect(store.canTransition('pending', 'shipped')).toBe(false);
    expect(store.canTransition('cancelled', 'paid')).toBe(false);
    expect(store.canTransition('refunded', 'paid')).toBe(false);
    expect(store.canTransition('unknown', 'paid')).toBe(false);
    expect(store.nextStatuses('delivered')).toEqual(['refunded']);
  });

  test('status changed event payload', () => {
    expect(store.statusChangedEvent({ order_id: 'o1', from: 'Pending', to: 'Paid', at: '2026-10-17T11:20:05Z' }))
      .toEqual({ order_id: 'o1', customer_id: null, from: 'pending', to: 'paid', at: '2026-10-17T11:20:05Z', reason: null });
  });
});

describe('receipt PDF', () => {
  const payload = {
    order_id: 'ord-pdf-1', customer_id: 'cust-001',
    items: [{ variant_id: 'var-jersey-001-M', quantity: 1, unit_price_minor: 450000 }],
    subtotal_minor: 450000, discount_minor: 0, total_minor: 450000, currency: 'PKR', paid_at: '2026-10-17T11:20:05Z',
  };

  // pdfkit writes Helvetica text as hex strings inside TJ arrays; decode them to plain text.
  function pageText(pdf) {
    const raw = pdf.toString('latin1');
    let text = '';
    for (const m of raw.matchAll(/\[(.*?)\]\s*TJ/gs)) {
      text += [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('') + '\n';
    }
    return text;
  }

  test('uncompressed PDF starts with %PDF and contains order_id and total', async () => {
    const pdf = await generateReceiptPdf(payload, { compress: false });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const text = pageText(pdf);
    expect(text).toContain('ord-pdf-1');
    expect(text).toContain('PKR 4500.00');
  });

  test('default (compressed) PDF is valid and inflates to the same text', async () => {
    const pdf = await generateReceiptPdf(payload);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const raw = pdf.toString('latin1');
    let inflated = '';
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try { inflated += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { /* not deflated */ }
    }
    const text = pageText(Buffer.from(inflated, 'latin1'));
    expect(text).toContain('ord-pdf-1');
    expect(text).toContain('PKR 4500.00');
  });
});
