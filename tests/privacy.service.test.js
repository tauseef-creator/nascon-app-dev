'use strict';
// Privacy erasure (NFR-9) against a recording stand-in for Postgres.
const express = require('express');
const request = require('supertest');

let mockCalls;
let mockData;

function mockRun(sql, p = []) {
  mockCalls.push({ sql, p });
  if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
  if (sql.startsWith('SELECT user_id, player_id FROM users')) return { rows: mockData.users.filter((u) => u.user_id === p[0] || u.player_id === p[0]) };
  if (sql.startsWith('SELECT player_id FROM players')) return { rows: mockData.players.includes(p[0]) ? [{ player_id: p[0] }] : [] };
  if (sql.startsWith('SELECT token FROM guest_tokens')) return { rows: mockData.tokens.filter((t) => t.token === p[0]) };
  if (sql.startsWith('UPDATE guest_tokens')) {
    const hit = mockData.tokens.filter((t) => p[0].includes(t.user_id) || p[0].includes(t.token));
    hit.forEach((t) => { t.user_id = null; t.revoked = true; });
    return { rows: hit.map((t) => ({ token: t.token })) };
  }
  return { rows: [] };
}

jest.mock('../backend/src/db/pool', () => ({
  query: async (sql, p) => mockRun(sql, p),
  tx: async (fn) => fn({ query: async (sql, p) => mockRun(sql, p) }),
  pool: {},
}));

const { errorHandler } = require('../backend/src/lib/errors');
const { anonEmail } = require('../backend/src/services/day2/privacy');

const app = express();
app.use('/audit/v1', require('../backend/src/routes/day2/privacy'));
app.use(errorHandler);

beforeEach(() => {
  mockCalls = [];
  mockData = {
    users: [{ user_id: 'user-player', player_id: 'player-alpha-1' }],
    players: ['player-alpha-1', 'player-beta-1'],
    tokens: [{ token: 'guest_anon_tok_7721', user_id: 'player-alpha-1', revoked: false }, { token: 'guest_other', user_id: 'player-beta-1', revoked: false }],
  };
});

test('anonymizes linked identities and wipes tokens', async () => {
  const t0 = Date.now();
  const r = await request(app).delete('/audit/v1/privacy/user/player-alpha-1');
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ user_id: 'player-alpha-1', status: 'anonymized', pii_retained: false, tokens_wiped: true });
  const userUpd = mockCalls.find((c) => c.sql.startsWith('UPDATE users'));
  expect(userUpd.p).toEqual(['user-player', 'Anonymized', anonEmail('user-player')]);
  const playerUpd = mockCalls.find((c) => c.sql.startsWith('UPDATE players'));
  expect(playerUpd.p[0].sort()).toEqual(['player-alpha-1', 'user-player']);
  expect(mockData.tokens[0]).toMatchObject({ user_id: null, revoked: true });
  expect(mockData.tokens[1]).toMatchObject({ user_id: 'player-beta-1', revoked: false });
  expect(mockCalls.find((c) => c.sql.startsWith('DELETE FROM cart_merges')).p[0]).toEqual(['guest_anon_tok_7721']);
  expect(mockCalls.some((c) => c.sql.startsWith('UPDATE member_carts'))).toBe(true);
});

test('anonymized email is unique per user and carries no PII', () => {
  expect(anonEmail('user-player')).toMatch(/^erased\+[a-f0-9]{16}@anonymized\.invalid$/);
  expect(anonEmail('a')).not.toBe(anonEmail('b'));
});

test('player without account and guest token ids are accepted', async () => {
  expect((await request(app).delete('/audit/v1/privacy/user/player-beta-1')).status).toBe(200);
  expect((await request(app).delete('/audit/v1/privacy/user/guest_other')).status).toBe(200);
});

test('unknown id -> 404 PLAYER_NOT_FOUND', async () => {
  for (const id of ['ghost', encodeURIComponent("x' OR 1=1 --")]) {
    const r = await request(app).delete(`/audit/v1/privacy/user/${id}`);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('PLAYER_NOT_FOUND');
  }
});
