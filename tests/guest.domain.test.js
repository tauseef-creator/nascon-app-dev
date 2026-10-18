'use strict';
const G = require('../backend/src/domain/day2/guest');

const MERGE = {
  guest_token: 'guest_anon_tok_7721',
  registered_user_id: 'player-alpha-1',
  guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 1 }],
  test_write_block: true,
};
const PRICE = { 'var-jersey-001-M': 450000, 'var-jersey-001-L': 450000 };
const STOCK = { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 };

describe('guest tokens', () => {
  test('format', () => {
    expect(G.isGuestTokenFormat('guest_anon_tok_7721')).toBe(true);
    expect(G.isGuestTokenFormat('guest_')).toBe(false);
    expect(G.isGuestTokenFormat('nope')).toBe(false);
    expect(G.isGuestTokenFormat(7)).toBe(false);
    expect(G.isGuestTokenFormat(`guest_${'a'.repeat(200)}`)).toBe(false);
  });
  test('new token', () => {
    expect(G.newGuestToken('abc123')).toBe('guest_anon_tok_abc123');
    expect(G.isGuestTokenFormat(G.newGuestToken('ff'))).toBe(true);
  });
});

describe('validateMergeBody (spec 5.7 step 1)', () => {
  test('valid body, unknown fields dropped, default test_write_block', () => {
    const { test_write_block: _t, ...noFlag } = MERGE;
    const v = G.validateMergeBody({ ...noFlag, extra: 1, guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 1, note: 'x' }] });
    expect(v.ok).toBe(true);
    expect(v.value).toEqual({ ...MERGE, test_write_block: true });
    expect(G.validateMergeBody({ ...MERGE, test_write_block: null }).value.test_write_block).toBe(true);
    expect(G.validateMergeBody({ ...MERGE, test_write_block: false }).value.test_write_block).toBe(false);
  });

  test.each([
    [null, ['body']],
    [[], ['body']],
    [{ ...MERGE, guest_token: 'nope' }, ['guest_token']],
    [{ ...MERGE, guest_token: '' }, ['guest_token']],
    [{ ...MERGE, registered_user_id: 5 }, ['registered_user_id']],
    [{ ...MERGE, registered_user_id: '' }, ['registered_user_id']],
    [{ ...MERGE, guest_cart: [] }, ['guest_cart']],
    [{ ...MERGE, guest_cart: 'x' }, ['guest_cart']],
    [{ ...MERGE, guest_cart: Array.from({ length: 11 }, () => ({ variant_id: 'v', quantity: 1 })) }, ['guest_cart']],
    [{ ...MERGE, guest_cart: [5] }, ['guest_cart[0]']],
    [{ ...MERGE, guest_cart: [{ variant_id: '', quantity: 1 }] }, ['guest_cart[0].variant_id']],
    [{ ...MERGE, guest_cart: [{ variant_id: 'v', quantity: 0 }] }, ['guest_cart[0].quantity']],
    [{ ...MERGE, guest_cart: [{ variant_id: 'v', quantity: 1.5 }] }, ['guest_cart[0].quantity']],
    [{ ...MERGE, guest_cart: [{ variant_id: 'v', quantity: '1' }] }, ['guest_cart[0].quantity']],
    [{ ...MERGE, test_write_block: 'yes' }, ['test_write_block']],
  ])('rejects %#', (body, fields) => {
    const v = G.validateMergeBody(body);
    expect(v.ok).toBe(false);
    expect(v.fields).toEqual(fields);
  });

  test('10 items allowed', () => {
    const cart = Array.from({ length: 10 }, (_, i) => ({ variant_id: `v${i}`, quantity: 1 }));
    expect(G.validateMergeBody({ ...MERGE, guest_cart: cart }).ok).toBe(true);
  });

  test('merge identity ignores test_write_block', () => {
    const a = G.mergeIdentity(G.validateMergeBody(MERGE).value);
    const b = G.mergeIdentity(G.validateMergeBody({ ...MERGE, test_write_block: false }).value);
    expect(a).toEqual(b);
    expect(Object.keys(a).sort()).toEqual(['guest_cart', 'guest_token', 'registered_user_id']);
  });
});

describe('cart math (FR-4.4)', () => {
  test('aggregate sums duplicates in first-seen order', () => {
    expect(G.aggregateItems([{ variant_id: 'b', quantity: 1 }, { variant_id: 'a', quantity: 2 }, { variant_id: 'b', quantity: 3 }]))
      .toEqual([{ variant_id: 'b', quantity: 4 }, { variant_id: 'a', quantity: 2 }]);
    expect(G.aggregateItems(undefined)).toEqual([]);
    expect(G.uniqueVariantIds([{ variant_id: 'a' }, { variant_id: 'a' }])).toEqual(['a']);
    expect(G.uniqueVariantIds()).toEqual([]);
  });

  test('missing variant', () => {
    expect(G.firstMissingVariant([{ variant_id: 'var-x' }], ['var-jersey-001-L'])).toBe('var-x');
    expect(G.firstMissingVariant([{ variant_id: 'var-jersey-001-L' }], new Set(['var-jersey-001-L']))).toBeNull();
  });

  test('stock check uses merged quantity (existing + guest)', () => {
    expect(G.findOutOfStock([], [{ variant_id: 'var-jersey-001-M', quantity: 5 }], STOCK))
      .toEqual({ variant_id: 'var-jersey-001-M', requested: 5, available: 1 });
    expect(G.findOutOfStock([{ variant_id: 'var-jersey-001-L', quantity: 4 }], [{ variant_id: 'var-jersey-001-L', quantity: 2 }], STOCK))
      .toEqual({ variant_id: 'var-jersey-001-L', requested: 6, available: 5 });
    expect(G.findOutOfStock([{ variant_id: 'var-jersey-001-L', quantity: 4 }], [{ variant_id: 'var-jersey-001-L', quantity: 1 }], STOCK)).toBeNull();
    expect(G.findOutOfStock([], [{ variant_id: 'v', quantity: 1 }], {})).toEqual({ variant_id: 'v', requested: 1, available: 0 });
  });

  test('merge sums same variant, caps by stock, prices from catalogue', () => {
    const existing = [{ variant_id: 'var-jersey-001-L', quantity: 2, unit_price_minor: 400000 }, { variant_id: 'old', quantity: 1, unit_price_minor: 100 }];
    const guest = [{ variant_id: 'var-jersey-001-L', quantity: 4 }, { variant_id: 'var-jersey-001-M', quantity: 1 }];
    expect(G.mergeCartItems(existing, guest, PRICE, STOCK)).toEqual([
      { variant_id: 'var-jersey-001-L', quantity: 5, unit_price_minor: 450000 },
      { variant_id: 'old', quantity: 1, unit_price_minor: 100 },
      { variant_id: 'var-jersey-001-M', quantity: 1, unit_price_minor: 450000 },
    ]);
    expect(G.mergeCartItems(undefined, [{ variant_id: 'z', quantity: 1 }], {}, { z: 0 })).toEqual([]);
    expect(G.mergeCartItems([], undefined, {}, {})).toEqual([]);
    expect(G.mergeCartItems([], [{ variant_id: 'n', quantity: 1 }], {}, {})).toEqual([{ variant_id: 'n', quantity: 1, unit_price_minor: 0 }]);
  });

  test('totals and active cart', () => {
    const items = [{ variant_id: 'var-jersey-001-L', quantity: 2, unit_price_minor: 450000, junk: 1 }];
    expect(G.cartTotals(items)).toEqual({ total_items: 2, subtotal_minor: 900000 });
    expect(G.cartTotals()).toEqual({ total_items: 0, subtotal_minor: 0 });
    expect(G.activeCart('player-alpha-1', items)).toEqual({
      user_id: 'player-alpha-1', currency: 'PKR', total_items: 2, subtotal_minor: 900000,
      items: [{ variant_id: 'var-jersey-001-L', quantity: 2, unit_price_minor: 450000 }],
    });
    expect(G.activeCart('u', undefined).items).toEqual([]);
  });
});

describe('response and write-block probe', () => {
  test('write check result', () => {
    expect(G.writeCheckResult(true, 403)).toEqual({ verified: true, code: 403 });
    expect(G.writeCheckResult(true, 0)).toEqual({ verified: false, code: 0 });
    expect(G.writeCheckResult(true, undefined)).toEqual({ verified: false, code: 0 });
    expect(G.writeCheckResult(false, 403)).toEqual({ verified: false, code: 0 });
  });

  test('spec 5.7 example response and sig payload', () => {
    const items = G.mergeCartItems([], MERGE.guest_cart, PRICE, STOCK);
    const { body, sigPayload } = G.buildMergeResponse({
      guestToken: MERGE.guest_token, userId: MERGE.registered_user_id, items, writeCheck: { verified: true, code: 403 },
    });
    expect(body).toEqual({
      guest_token: 'guest_anon_tok_7721',
      write_block_verified: true,
      write_rejection_code: 403,
      cart_merged: true,
      active_cart: {
        user_id: 'player-alpha-1', currency: 'PKR', total_items: 1, subtotal_minor: 450000,
        items: [{ variant_id: 'var-jersey-001-L', quantity: 1, unit_price_minor: 450000 }],
      },
    });
    expect(sigPayload).toEqual({
      cart_merged: true, guest_token: 'guest_anon_tok_7721', registered_user_id: 'player-alpha-1', total_items: 1, write_rejection_code: 403,
    });
  });
});

describe('guest cart staging', () => {
  test('adds and sums', () => {
    const a = G.stageItem([], 'var-jersey-001-L', 2, 5);
    expect(a).toEqual({ ok: true, items: [{ variant_id: 'var-jersey-001-L', quantity: 2 }] });
    const b = G.stageItem(a.items, 'var-jersey-001-L', 3, 5);
    expect(b.items).toEqual([{ variant_id: 'var-jersey-001-L', quantity: 5 }]);
  });
  test('rejects above stock', () => {
    expect(G.stageItem([{ variant_id: 'm', quantity: 1 }], 'm', 1, 1))
      .toEqual({ ok: false, error: { code: 'OUT_OF_STOCK', details: { variant_id: 'm', requested: 2, available: 1 } } });
  });
});

describe('guest token lifetime (FR-4.2)', () => {
  const G = require('../backend/src/domain/day2/guest');
  test('ttl from env with a 24 h default', () => {
    expect(G.guestTokenTtlS(undefined)).toBe(86400);
    expect(G.guestTokenTtlS('abc')).toBe(86400);
    expect(G.guestTokenTtlS('0')).toBe(86400);
    expect(G.guestTokenTtlS('-5')).toBe(86400);
    expect(G.guestTokenTtlS('600')).toBe(600);
  });
  test('expiry instant and check', () => {
    const exp = G.guestTokenExpiry(1000, 60);
    expect(exp.getTime()).toBe(61000);
    expect(G.isGuestTokenExpired(exp, 60999)).toBe(false);
    expect(G.isGuestTokenExpired(exp, 61000)).toBe(true);
    expect(G.isGuestTokenExpired(new Date(61000).toISOString(), 70000)).toBe(true);
    expect(G.isGuestTokenExpired(null, 1e15)).toBe(false);
    expect(G.isGuestTokenExpired(undefined, 1e15)).toBe(false);
    expect(G.isGuestTokenExpired('not a date', 1e15)).toBe(false);
  });
});
