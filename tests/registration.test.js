'use strict';
// Progressive registration (FR-4.4): POST /api/v1/auth/register against an in-memory Postgres stand-in.
const express = require('express');
const request = require('supertest');

jest.setTimeout(30000); // bcrypt hashing is slow on a loaded CI box

let mockDb;
const mockMerge = jest.fn();

jest.mock('../backend/src/db/pool', () => ({
  query: async (sql, p = []) => {
    const rows = (r) => ({ rows: r });
    if (sql.startsWith('SELECT cart, merged, revoked, expires_at FROM guest_tokens')) return rows(mockDb.tokens[p[0]] ? [mockDb.tokens[p[0]]] : []);
    if (sql.startsWith('SELECT 1 FROM tenants')) return rows(mockDb.tenants.includes(p[0]) ? [{}] : []);
    if (sql.startsWith('SELECT 1 FROM users WHERE lower(email)')) return rows(mockDb.users.some((u) => u.email === p[0]) ? [{}] : []);
    if (sql.startsWith('INSERT INTO users')) {
      if (mockDb.raceDuplicate) throw Object.assign(new Error('dup'), { code: '23505' });
      if (mockDb.failInsert) throw new Error('db down');
      const u = { user_id: p[0], email: p[1], password_hash: p[2], role: p[3], tenant_id: p[4], league_id: null, club_id: null, player_id: null, display_name: p[5] };
      mockDb.users.push(u);
      return rows([u]);
    }
    if (sql.startsWith('SELECT tenant_id, name')) return rows(mockDb.tenants.includes(p[0]) ? [{ tenant_id: p[0], name: 'Alpha', primary_color: '#000', secondary_color: '#fff', logo_url: null }] : []);
    throw new Error(`unexpected SQL: ${sql}`);
  },
  tx: async (fn) => fn({ query: async () => ({ rows: [] }) }),
}));
jest.mock('../backend/src/services/day2/guest', () => ({ mergeGuestCart: (...a) => mockMerge(...a) }));

const bcrypt = require('bcryptjs');
const { verifyToken } = require('../backend/src/lib/auth');
const { errorHandler, ApiError } = require('../backend/src/lib/errors');
const { guestWriteGuard } = require('../backend/src/lib/guest');
const R = require('../backend/src/domain/day2/registration');

function app() {
  const a = express();
  a.use(express.json());
  a.use(guestWriteGuard);
  a.use('/api/v1', require('../backend/src/routes/api'));
  a.use(errorHandler);
  return a;
}
const post = (body, headers = {}) => request(app()).post('/api/v1/auth/register').set(headers).send(body);
const BODY = { email: 'New.Fan@Example.com', password: 'secret-123' };

beforeEach(() => {
  mockDb = {
    tenants: ['tenant-alpha'],
    users: [{ user_id: 'user-viewer', email: 'viewer@nascon.test' }],
    tokens: {
      guest_anon_tok_7721: { cart: [{ variant_id: 'var-jersey-001-L', quantity: 2 }], merged: false, revoked: false, expires_at: null },
      guest_anon_tok_empty: { cart: [], merged: false, revoked: false, expires_at: null },
      guest_anon_tok_done: { cart: [], merged: true, revoked: false, expires_at: null },
      guest_anon_tok_old: { cart: [], merged: false, revoked: false, expires_at: '2020-01-01T00:00:00Z' },
    },
  };
  mockMerge.mockReset();
});

describe('validateRegisterBody', () => {
  test('normalizes and defaults', () => {
    const v = R.validateRegisterBody({ ...BODY, display_name: '  Fan  ' });
    expect(v).toEqual({ ok: true, fields: [], value: { email: 'new.fan@example.com', password: 'secret-123', display_name: 'Fan', tenant_id: null, guest_token: null } });
    expect(R.validateRegisterBody(BODY).value.display_name).toBe('new.fan');
  });
  test('rejects bad fields', () => {
    expect(R.validateRegisterBody(null).fields).toEqual(['body']);
    expect(R.validateRegisterBody({ email: 'nope', password: 'short', display_name: '', tenant_id: 'bad id!', guest_token: 'abc' }).fields)
      .toEqual(['email', 'password', 'display_name', 'tenant_id', 'guest_token']);
    expect(R.validateRegisterBody({ email: 3, password: 3, display_name: 5 }).fields).toEqual(['email', 'password', 'display_name']);
  });
  test('ids', () => expect(R.newUserId('ab12')).toBe('user-ab12'));
});

describe('POST /api/v1/auth/register', () => {
  test('201 with the login shape and a hashed password', async () => {
    const r = await post({ ...BODY, tenant_id: 'tenant-alpha' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: 'new.fan@example.com', role: 'viewer', tenant_id: 'tenant-alpha', display_name: 'new.fan' });
    expect(r.body.user.user_id).toMatch(/^user-[a-f0-9]{16}$/);
    expect(r.body.tenant).toMatchObject({ tenant_id: 'tenant-alpha' });
    expect(r.body.cart_merge).toBeNull();
    expect(verifyToken(r.body.token)).toMatchObject({ user_id: r.body.user.user_id, role: 'viewer' });
    const stored = mockDb.users.find((u) => u.user_id === r.body.user.user_id);
    expect(stored.password_hash).not.toBe('secret-123');
    expect(await bcrypt.compare('secret-123', stored.password_hash)).toBe(true);
    expect(r.body.user.password_hash).toBeUndefined();
  });

  test('merges the staged guest cart into the new member cart', async () => {
    mockMerge.mockResolvedValue({ statusCode: 200, body: { cart_merged: true, active_cart: { items: [] } } });
    const r = await post({ ...BODY, guest_token: 'guest_anon_tok_7721' });
    expect(r.status).toBe(201);
    expect(mockMerge).toHaveBeenCalledWith({
      guest_token: 'guest_anon_tok_7721', registered_user_id: r.body.user.user_id,
      guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 2 }], test_write_block: false,
    });
    expect(r.body.cart_merge).toMatchObject({ merged: true, cart_merged: true });
  });

  test('empty guest cart: nothing to merge', async () => {
    const r = await post({ ...BODY, guest_token: 'guest_anon_tok_empty' });
    expect(r.body.cart_merge).toEqual({ merged: false, items: [] });
    expect(mockMerge).not.toHaveBeenCalled();
  });

  test('a merge conflict never undoes the registration', async () => {
    mockMerge.mockRejectedValue(new ApiError(409, 'OUT_OF_STOCK', 'Not enough stock.', { variant_id: 'v' }));
    const r = await post({ ...BODY, guest_token: 'guest_anon_tok_7721' });
    expect(r.status).toBe(201);
    expect(r.body.cart_merge).toEqual({ merged: false, error: { code: 'OUT_OF_STOCK', message: 'Not enough stock.', details: { variant_id: 'v' } } });
  });

  test('unexpected merge failure surfaces as 500', async () => {
    mockMerge.mockRejectedValue(new Error('boom'));
    expect((await post({ ...BODY, guest_token: 'guest_anon_tok_7721' })).status).toBe(500);
  });

  test('errors: 400, 401, 404, 409', async () => {
    const bad = await post({ email: 'x', password: 'y' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect((await post({ ...BODY, guest_token: 'guest_anon_tok_missing' })).status).toBe(401);
    const old = await post({ ...BODY, guest_token: 'guest_anon_tok_old' });
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('GUEST_TOKEN_EXPIRED');
    expect((await post({ ...BODY, guest_token: 'guest_anon_tok_done' })).body.error.code).toBe('GUEST_TOKEN_ALREADY_MERGED');
    expect((await post({ ...BODY, tenant_id: 'tenant-zz' })).body.error.code).toBe('TENANT_NOT_FOUND');
    const dup = await post({ email: 'VIEWER@nascon.test', password: 'secret-123' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    mockDb.raceDuplicate = true;
    expect((await post(BODY)).body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    mockDb.raceDuplicate = false;
    mockDb.failInsert = true;
    expect((await post(BODY)).status).toBe(500);
  });

  test('a guest Bearer token is still blocked by the write guard (FR-4.3)', async () => {
    const r = await post(BODY, { Authorization: 'Bearer guest_anon_tok_7721' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('GUEST_WRITE_FORBIDDEN');
  });
});
