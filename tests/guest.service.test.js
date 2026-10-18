'use strict';
// Guest cart-merge service + route against an in-memory stand-in for Postgres.
const express = require('express');
const request = require('supertest');

let mockState;
function freshState() {
  return {
    players: new Set(['player-alpha-1', 'player-alpha-2']),
    users: new Set(['user-player']),
    variants: { 'var-jersey-001-M': { price_minor: '450000', stock: 1 }, 'var-jersey-001-L': { price_minor: '450000', stock: 5 } },
    tokens: { guest_anon_tok_7721: { user_id: null, merged: false, revoked: false, cart: [] } },
    carts: { 'player-alpha-1': [] },
    merges: {},
  };
}

function mockClientQuery(sql, p = []) {
  const s = mockState;
  const rows = (r) => ({ rows: r });
  if (sql.includes('pg_advisory_xact_lock')) return rows([]);
  if (sql.startsWith('SELECT body_hash, response FROM cart_merges')) return rows(s.merges[p[0]] ? [s.merges[p[0]]] : []);
  if (sql.includes('FROM players WHERE player_id = $1)') && sql.includes('FROM users')) return rows([{ found: s.players.has(p[0]) || s.users.has(p[0]) }]);
  if (sql.startsWith('SELECT variant_id, price_minor, stock FROM variants')) {
    return rows(p[0].filter((v) => s.variants[v]).map((v) => ({ variant_id: v, ...s.variants[v] })));
  }
  if (sql.startsWith('INSERT INTO member_carts')) { if (!s.carts[p[0]]) s.carts[p[0]] = []; return rows([]); }
  if (sql.startsWith('SELECT items FROM member_carts')) return rows([{ items: JSON.parse(JSON.stringify(s.carts[p[0]])) }]);
  if (sql.startsWith('SELECT merged, revoked FROM guest_tokens')) return rows(s.tokens[p[0]] ? [{ ...s.tokens[p[0]] }] : []);
  if (sql.startsWith('UPDATE member_carts SET items')) { s.carts[p[0]] = JSON.parse(p[1]); return rows([]); }
  if (sql.includes('INSERT INTO guest_tokens (token, user_id, merged, cart)')) {
    s.tokens[p[0]] = { ...(s.tokens[p[0]] || { revoked: false }), user_id: p[1], merged: true, cart: [] };
    return rows([]);
  }
  if (sql.startsWith('INSERT INTO cart_merges')) {
    if (s.merges[p[0]]) throw Object.assign(new Error('dup'), { code: '23505' });
    s.merges[p[0]] = { body_hash: p[1], response: JSON.parse(JSON.stringify(p[2])) };
    return rows([]);
  }
  if (sql.startsWith('INSERT INTO guest_tokens (token) VALUES')) { s.tokens[p[0]] = { user_id: null, merged: false, revoked: false, cart: [] }; return rows([]); }
  if (sql.startsWith('SELECT cart, revoked FROM guest_tokens')) return rows(s.tokens[p[0]] ? [{ ...s.tokens[p[0]] }] : []);
  if (sql.startsWith('SELECT cart, merged, revoked FROM guest_tokens')) return rows(s.tokens[p[0]] ? [JSON.parse(JSON.stringify(s.tokens[p[0]]))] : []);
  if (sql.startsWith('UPDATE guest_tokens SET cart')) { s.tokens[p[0]].cart = JSON.parse(p[1]); return rows([]); }
  throw new Error(`unexpected SQL: ${sql}`);
}

jest.mock('../backend/src/db/pool', () => ({
  query: async (sql, p) => mockClientQuery(sql, p),
  tx: async (fn) => {
    const snapshot = mockState;
    mockState = {
      ...snapshot,
      tokens: JSON.parse(JSON.stringify(snapshot.tokens)),
      carts: JSON.parse(JSON.stringify(snapshot.carts)),
      merges: JSON.parse(JSON.stringify(snapshot.merges)),
    };
    try {
      return await fn({ query: async (sql, p) => mockClientQuery(sql, p) });
    } catch (e) {
      mockState = snapshot;
      throw e;
    }
  },
  pool: {},
}));

const { signDay2 } = require('../backend/src/lib/signing');
const { errorHandler } = require('../backend/src/lib/errors');
const guest = require('../backend/src/services/day2/guest');

const app = express();
app.use(express.json());
app.use('/audit/v1', require('../backend/src/routes/day2/guest'));
app.use(errorHandler);

const MERGE = {
  guest_token: 'guest_anon_tok_7721',
  registered_user_id: 'player-alpha-1',
  guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 1 }],
  test_write_block: true,
};
const post = (body) => request(app).post('/audit/v1/guest/cart-merge').send(body);

beforeEach(() => { mockState = freshState(); });

describe('POST /audit/v1/guest/cart-merge (spec 5.7)', () => {
  test('first merge returns the spec body and signature; replay is idempotent (edge case 4)', async () => {
    const r = await post(MERGE);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      guest_token: 'guest_anon_tok_7721',
      write_block_verified: true,
      write_rejection_code: 403,
      cart_merged: true,
      active_cart: {
        user_id: 'player-alpha-1', currency: 'PKR', total_items: 1, subtotal_minor: 450000,
        items: [{ variant_id: 'var-jersey-001-L', quantity: 1, unit_price_minor: 450000 }],
      },
      signature: signDay2('guest_anon_tok_7721', {
        cart_merged: true, guest_token: 'guest_anon_tok_7721', registered_user_id: 'player-alpha-1', total_items: 1, write_rejection_code: 403,
      }),
    });
    const again = await post(MERGE);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(r.body);
    expect(mockState.carts['player-alpha-1']).toEqual([{ variant_id: 'var-jersey-001-L', quantity: 1, unit_price_minor: 450000 }]);
    expect(mockState.variants['var-jersey-001-L'].stock).toBe(5); // a cart never reserves stock
    expect(mockState.tokens.guest_anon_tok_7721).toMatchObject({ merged: true, user_id: 'player-alpha-1' });
    // Replay differing only in test_write_block is still the same request.
    expect((await post({ ...MERGE, test_write_block: false })).status).toBe(200);
  });

  test('reuse with another user or payload -> 409 GUEST_TOKEN_ALREADY_MERGED', async () => {
    await post(MERGE);
    const a = await post({ ...MERGE, registered_user_id: 'player-alpha-2' });
    expect(a.status).toBe(409);
    expect(a.body.error).toMatchObject({ code: 'GUEST_TOKEN_ALREADY_MERGED', details: { guest_token: 'guest_anon_tok_7721' } });
    const b = await post({ ...MERGE, guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 2 }] });
    expect(b.body.error.code).toBe('GUEST_TOKEN_ALREADY_MERGED');
  });

  test('validation order 400 -> 404 -> 409', async () => {
    const e400 = await post({ ...MERGE, guest_token: 'nope', registered_user_id: 'ghost' });
    expect(e400.status).toBe(400);
    expect(e400.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: ['guest_token'] } });
    const e404u = await post({ ...MERGE, registered_user_id: 'ghost', guest_cart: [{ variant_id: 'var-x', quantity: 1 }] });
    expect(e404u.status).toBe(404);
    expect(e404u.body.error.code).toBe('PLAYER_NOT_FOUND');
    const e404v = await post({ ...MERGE, guest_cart: [{ variant_id: 'var-x', quantity: 1 }] });
    expect(e404v.body.error).toMatchObject({ code: 'VARIANT_NOT_FOUND', details: { variant_id: 'var-x' } });
    const e409 = await post({ ...MERGE, guest_cart: [{ variant_id: 'var-jersey-001-M', quantity: 5 }] });
    expect(e409.status).toBe(409);
    expect(e409.body.error).toMatchObject({ code: 'OUT_OF_STOCK', details: { variant_id: 'var-jersey-001-M' } });
    expect(mockState.tokens.guest_anon_tok_7721.merged).toBe(false);
    expect((await request(app).post('/audit/v1/guest/cart-merge').set('Content-Type', 'application/json').send('{bad')).status).toBe(400);
  });

  test('merged quantity counts the existing member cart', async () => {
    mockState.carts['player-alpha-1'] = [{ variant_id: 'var-jersey-001-L', quantity: 4, unit_price_minor: 450000 }];
    const over = await post({ ...MERGE, guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 2 }] });
    expect(over.body.error.code).toBe('OUT_OF_STOCK');
    const ok = await post(MERGE);
    expect(ok.body.active_cart).toMatchObject({ total_items: 5, subtotal_minor: 2250000 });
  });

  test('users table ids, new member cart, skipped write probe', async () => {
    const r = await post({ ...MERGE, registered_user_id: 'user-player', test_write_block: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ write_block_verified: false, write_rejection_code: 0 });
    expect(r.body.signature).toBe(signDay2('guest_anon_tok_7721', {
      cart_merged: true, guest_token: 'guest_anon_tok_7721', registered_user_id: 'user-player', total_items: 1, write_rejection_code: 0,
    }));
  });

  test('unknown guest token is accepted and recorded; revoked token cannot merge', async () => {
    expect((await post({ ...MERGE, guest_token: 'guest_anon_tok_new' })).status).toBe(200);
    mockState.tokens.guest_anon_tok_old = { user_id: null, merged: false, revoked: true, cart: [] };
    expect((await post({ ...MERGE, guest_token: 'guest_anon_tok_old' })).body.error.code).toBe('GUEST_TOKEN_ALREADY_MERGED');
  });

  test('simulated guest write goes through the real guard', () => {
    expect(guest.simulateGuestWrite('guest_anon_tok_7721')).toBe(403);
  });
});

describe('guest staging helpers', () => {
  test('issue, stage, read', async () => {
    const { guest_token: t, read_only: ro } = await guest.issueGuestToken();
    expect(t).toMatch(/^guest_anon_tok_[a-f0-9]{24}$/);
    expect(ro).toBe(true);
    expect(await guest.isActiveGuestToken(t)).toBe(true);
    expect(await guest.isActiveGuestToken('nope')).toBe(false);
    expect(await guest.isActiveGuestToken('guest_unknown')).toBe(false);
    await guest.stageGuestCart(t, 'var-jersey-001-L', 2);
    const cart = await guest.stageGuestCart(t, 'var-jersey-001-L', 1);
    expect(cart).toEqual({
      guest_token: t, currency: 'PKR', count: 3, subtotal_minor: 1350000,
      items: [{ variant_id: 'var-jersey-001-L', quantity: 3, unit_price_minor: 450000 }],
    });
    expect(await guest.getGuestCart(t)).toEqual(cart);
  });

  test('errors', async () => {
    await expect(guest.stageGuestCart('guest_anon_tok_7721', '', 0)).rejects.toMatchObject({ status: 400 });
    await expect(guest.stageGuestCart('bad', 'var-jersey-001-L', 1)).rejects.toMatchObject({ status: 401 });
    await expect(guest.stageGuestCart('guest_missing', 'var-jersey-001-L', 1)).rejects.toMatchObject({ status: 401 });
    await expect(guest.stageGuestCart('guest_anon_tok_7721', 'var-x', 1)).rejects.toMatchObject({ code: 'VARIANT_NOT_FOUND' });
    await expect(guest.stageGuestCart('guest_anon_tok_7721', 'var-jersey-001-M', 2)).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    await expect(guest.getGuestCart('bad')).rejects.toMatchObject({ status: 401 });
    await expect(guest.getGuestCart('guest_missing')).rejects.toMatchObject({ status: 401 });
    await post(MERGE);
    await expect(guest.stageGuestCart('guest_anon_tok_7721', 'var-jersey-001-L', 1)).rejects.toMatchObject({ code: 'GUEST_TOKEN_ALREADY_MERGED' });
  });
});
