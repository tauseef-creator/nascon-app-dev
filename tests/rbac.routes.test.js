'use strict';
// HTTP behaviour of /audit/v1/rbac-matrix, the probes P1..P7 and /api/v1 auth routes,
// with the Postgres pool replaced by an in-memory fake built from the seed data.
const S = require('../backend/src/db/seedData');

jest.mock('../backend/src/db/pool', () => {
  const seed = require('../backend/src/db/seedData');
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(seed.DEMO_PASSWORD, 4);
  const users = seed.USERS.map((u) => ({
    user_id: u.user_id, email: u.email, password_hash: hash, role: u.role, tenant_id: u.tenant_id || null,
    league_id: u.league_id || null, club_id: u.club_id || null, player_id: u.player_id || null, display_name: u.display_name,
  }));
  const where = (rows, sql, params) => {
    if (/WHERE FALSE/.test(sql)) return [];
    if (/tenant_id = \$1/.test(sql) && !/club_id = \$1/.test(sql)) return rows.filter((r) => r.tenant_id === params[0]);
    return rows;
  };
  const query = jest.fn(async (sql, params = []) => {
    let rows = [];
    if (/FROM users WHERE user_id = ANY/.test(sql)) rows = users.filter((u) => params[0].includes(u.user_id));
    else if (/FROM users WHERE lower\(email\)/.test(sql)) rows = users.filter((u) => u.email.toLowerCase() === params[0].toLowerCase());
    else if (/FROM users WHERE user_id = \$1/.test(sql)) rows = users.filter((u) => u.user_id === params[0]);
    else if (/FROM leagues WHERE league_id = \$1/.test(sql)) rows = seed.LEAGUES.filter((l) => l.league_id === params[0]);
    else if (/FROM leagues/.test(sql)) rows = where(seed.LEAGUES, sql, params);
    else if (/FROM clubs WHERE club_id = \$1/.test(sql)) rows = seed.CLUBS.filter((c) => c.club_id === params[0]);
    else if (/FROM clubs/.test(sql)) rows = where(seed.CLUBS, sql, params);
    else if (/FROM players WHERE player_id = \$1/.test(sql)) rows = seed.PLAYERS.filter((p) => p.player_id === params[0]);
    else if (/FROM players WHERE club_id = \$1/.test(sql)) rows = seed.PLAYERS.filter((p) => p.club_id === params[0] && p.tenant_id === params[1]);
    else if (/FROM tenants WHERE tenant_id = \$1/.test(sql)) rows = seed.TENANTS.filter((t) => t.tenant_id === params[0]);
    return { rows: rows.map((r) => ({ ...r })) };
  });
  return { query, tx: jest.fn(), pool: {} };
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { errorHandler } = require('../backend/src/lib/errors');

const app = express();
app.use(express.json({ limit: '1mb', type: () => true }));
app.use('/audit/v1', require('../backend/src/routes/audit/rbac'));
app.use('/api/v1', require('../backend/src/routes/api'));
app.use(errorHandler);

let tokens;
let context;
beforeAll(async () => {
  const res = await request(app).post('/audit/v1/rbac-matrix');
  expect(res.status).toBe(200);
  tokens = res.body.tokens;
  context = res.body.context;
});

test('rbac-matrix returns five tokens and the exact context', () => {
  expect(Object.keys(tokens).sort()).toEqual(['club_manager', 'league_organizer', 'player', 'super_admin', 'viewer']);
  expect(context).toEqual({
    tenant_id: 'tenant-alpha', foreign_tenant_id: 'tenant-beta',
    own_league_id: 'league-alpha-1', other_league_id: 'league-alpha-2', foreign_league_id: 'league-beta-1',
    own_club_id: 'club-alpha-1', other_club_id: 'club-alpha-2', foreign_club_id: 'club-beta-1',
    own_player_id: 'player-alpha-1', other_player_id: 'player-alpha-2', foreign_player_id: 'player-beta-1',
  });
});

const ROLES = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'];
const PROBES = [
  ['post', '/audit/v1/rbac/tenants', 'ADDDD'],
  ['post', '/audit/v1/rbac/leagues/league-alpha-1/fixtures', 'AADDD'],
  ['post', '/audit/v1/rbac/leagues/league-alpha-2/fixtures', 'ADDDD'],
  ['post', '/audit/v1/rbac/leagues/league-beta-1/fixtures', 'ADDDD'],
  ['post', '/audit/v1/rbac/clubs/club-alpha-1/roster', 'ADADD'],
  ['post', '/audit/v1/rbac/clubs/club-alpha-2/roster', 'ADDDD'],
  ['post', '/audit/v1/rbac/clubs/club-beta-1/roster', 'ADDDD'],
  ['post', '/audit/v1/rbac/clubs/club-alpha-1/products', 'ADADD'],
  ['post', '/audit/v1/rbac/clubs/club-alpha-2/products', 'ADDDD'],
  ['post', '/audit/v1/rbac/clubs/club-beta-1/products', 'ADDDD'],
  ['patch', '/audit/v1/rbac/players/player-alpha-1', 'ADAAD'],
  ['patch', '/audit/v1/rbac/players/player-alpha-2', 'ADDDD'],
  ['patch', '/audit/v1/rbac/players/player-beta-1', 'ADDDD'],
  ['get', '/audit/v1/rbac/clubs/club-alpha-1', 'AAAAA'],
  ['get', '/audit/v1/rbac/clubs/club-alpha-2', 'AAAAA'],
  ['get', '/audit/v1/rbac/clubs/club-beta-1', 'ADDDD'],
  ['get', '/audit/v1/rbac/platform/config', 'ADDDD'],
];
const cases = [];
for (const [method, path, exp] of PROBES) ROLES.forEach((r, i) => cases.push([method.toUpperCase(), path, r, exp[i] === 'A', method]));

test.each(cases)('%s %s as %s', async (M, path, role, allowed, method) => {
  let req = request(app)[method](path).set('Authorization', `Bearer ${tokens[role]}`);
  if (method !== 'get') req = req.send({});
  const res = await req;
  if (allowed) {
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authorized: true });
  } else {
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.details).toEqual({});
  }
});

describe('probe security', () => {
  test('P7 without Authorization -> 401', async () => {
    const res = await request(app).get('/audit/v1/rbac/platform/config');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  test('P7 with altered signature or alg:none -> 401', async () => {
    const [h, p, s] = tokens.super_admin.split('.');
    const bad = `${h}.${p}.${(s[0] === 'A' ? 'B' : 'A') + s.slice(1)}`;
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
    for (const t of [bad, none]) {
      const res = await request(app).get('/audit/v1/rbac/platform/config').set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  test('expired token -> 401', async () => {
    const t = jwt.sign({ sub: 'user-admin', role: 'super_admin', exp: 1 }, 'nascon-dev-jwt-secret-change-me');
    const res = await request(app).post('/audit/v1/rbac/tenants').set('Authorization', `Bearer ${t}`).send({});
    expect(res.status).toBe(401);
  });

  test('401 wins over 404 for an unknown id', async () => {
    const res = await request(app).patch('/audit/v1/rbac/players/nope').send({});
    expect(res.status).toBe(401);
  });

  test('unknown ids -> 404 with the catalogue code', async () => {
    const auth = { Authorization: `Bearer ${tokens.viewer}` };
    let res = await request(app).post('/audit/v1/rbac/leagues/nope/fixtures').set(auth).send({});
    expect([res.status, res.body.error.code]).toEqual([404, 'LEAGUE_NOT_FOUND']);
    res = await request(app).patch('/audit/v1/rbac/players/nope').set(auth).send({});
    expect([res.status, res.body.error.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
    res = await request(app).get('/audit/v1/rbac/clubs/nope').set(auth);
    expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);
  });

  test('probes ignore arbitrary bodies', async () => {
    const res = await request(app).post('/audit/v1/rbac/tenants')
      .set('Authorization', `Bearer ${tokens.super_admin}`).send({ junk: [1, 2], tenant_id: "x'; DROP TABLE" });
    expect(res.status).toBe(200);
  });
});

describe('/api/v1 production auth', () => {
  const login = (email, password) => request(app).post('/api/v1/auth/login').send({ email, password });

  test('login returns token, user and tenant branding', async () => {
    const res = await login('Manager@nascon.test', S.DEMO_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      user_id: 'user-manager', email: 'manager@nascon.test', role: 'club_manager', tenant_id: 'tenant-alpha',
      league_id: null, club_id: 'club-alpha-1', player_id: null, display_name: 'Club Manager',
    });
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.tenant).toEqual({
      tenant_id: 'tenant-alpha', name: 'Alpha Sports', primary_color: '#0B5FFF', secondary_color: '#FFB800', logo_url: null,
    });
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.user_id).toBe('user-manager');
  });

  test('super admin login has no tenant', async () => {
    const res = await login('admin@nascon.test', S.DEMO_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toBeNull();
  });

  test('bad credentials -> 401, bad body -> 400', async () => {
    let res = await login('manager@nascon.test', 'wrong');
    expect([res.status, res.body.error.code]).toEqual([401, 'UNAUTHENTICATED']);
    res = await login('ghost@nascon.test', 'x');
    expect(res.status).toBe(401);
    res = await login(123, null);
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toEqual(['email', 'password']);
  });

  test('/me needs a token and a live user', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    const ghost = require('../backend/src/lib/auth').issueToken({ user_id: 'ghost', role: 'viewer' });
    expect((await request(app).get('/api/v1/me').set('Authorization', `Bearer ${ghost}`)).status).toBe(401);
  });

  test('clubs and leagues are tenant scoped', async () => {
    const viewer = { Authorization: `Bearer ${tokens.viewer}` };
    const admin = { Authorization: `Bearer ${tokens.super_admin}` };
    let res = await request(app).get('/api/v1/clubs').set(viewer);
    expect(res.body.clubs.map((c) => c.club_id)).toEqual(['club-alpha-1', 'club-alpha-2']);
    res = await request(app).get('/api/v1/clubs').set(admin);
    expect(res.body.clubs).toHaveLength(3);
    res = await request(app).get('/api/v1/leagues').set(viewer);
    expect(res.body.leagues.map((l) => l.league_id)).toEqual(['league-alpha-1', 'league-alpha-2']);
    const noTenant = require('../backend/src/lib/auth').issueToken({ user_id: 'x', role: 'viewer' });
    res = await request(app).get('/api/v1/leagues').set('Authorization', `Bearer ${noTenant}`);
    expect(res.body.leagues).toEqual([]);
  });

  test('club profile: roster, staff, venue; foreign club 403; unknown 404', async () => {
    const viewer = { Authorization: `Bearer ${tokens.viewer}` };
    let res = await request(app).get('/api/v1/clubs/club-alpha-1').set(viewer);
    expect(res.status).toBe(200);
    expect(res.body.players.map((p) => p.player_id)).toEqual(['player-alpha-1']);
    expect(res.body.staff.coach).toBe('Imran Khan');
    expect(res.body.home_venue.name).toBe('Alpha Arena');
    res = await request(app).get('/api/v1/clubs/club-beta-1').set(viewer);
    expect(res.status).toBe(403);
    res = await request(app).get('/api/v1/clubs/nope').set(viewer);
    expect(res.status).toBe(404);
  });

  test('branding is tenant scoped', async () => {
    const viewer = { Authorization: `Bearer ${tokens.viewer}` };
    let res = await request(app).get('/api/v1/tenants/tenant-alpha/branding').set(viewer);
    expect([res.status, res.body.name]).toEqual([200, 'Alpha Sports']);
    res = await request(app).get('/api/v1/tenants/tenant-beta/branding').set(viewer);
    expect(res.status).toBe(403);
    res = await request(app).get('/api/v1/tenants/tenant-beta/branding').set('Authorization', `Bearer ${tokens.super_admin}`);
    expect(res.status).toBe(200);
    res = await request(app).get('/api/v1/tenants/nope/branding').set(viewer);
    expect(res.status).toBe(404);
  });
});
