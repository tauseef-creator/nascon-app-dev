'use strict';
// Route + service flow for sports / leagues / events / score with an in-memory fake of db/pool.
// The fake understands exactly the SQL statements used by these modules.

jest.mock('../backend/src/db/pool', () => {
  const db = { sports: new Map(), leagues: new Map(), matches: new Map(), events: [], lotsSeed: 42 };
  const json = (v) => (typeof v === 'string' ? JSON.parse(v) : JSON.parse(JSON.stringify(v)));
  const rows = (r) => ({ rows: r, rowCount: r.length });
  async function query(sql, p = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('pg_advisory_xact_lock')) return rows([]);
    if (s.includes('FROM match_status')) return rows([]); // no admin status overrides in these tests
    if (s.startsWith('INSERT INTO sports')) {
      if (db.sports.has(p[0])) return rows([]);
      db.sports.set(p[0], json(p[1]));
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('SELECT config FROM sports')) return rows(db.sports.has(p[0]) ? [{ config: db.sports.get(p[0]) }] : []);
    if (s.startsWith('SELECT 1 FROM leagues')) return rows(db.leagues.has(p[0]) ? [{ '?column?': 1 }] : []);
    if (s.startsWith('INSERT INTO leagues')) {
      db.leagues.set(p[0], { sport_id: p[1], name: p[2], config: json(p[3]) });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('SELECT match_id FROM matches WHERE match_id = ANY')) {
      return rows(p[0].filter((id) => db.matches.has(id)).map((match_id) => ({ match_id })));
    }
    if (s.startsWith('INSERT INTO matches')) {
      if (db.matches.has(p[0])) {
        if (s.includes('ON CONFLICT')) return rows([]);
        throw Object.assign(new Error('dup'), { code: '23505' });
      }
      db.matches.set(p[0], { match_id: p[0], sport_id: p[1], league_id: p[2], home_team_id: p[3], away_team_id: p[4] });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('SELECT match_id, sport_id, league_id')) return rows(db.matches.has(p[0]) ? [{ ...db.matches.get(p[0]) }] : []);
    if (s.startsWith('SELECT body_hash, response FROM match_events')) {
      return rows(db.events.filter((e) => e.event_id === p[0]).map((e) => ({ body_hash: e.body_hash, response: e.response })));
    }
    if (s.startsWith('SELECT event_id, match_id, type FROM match_events')) {
      return rows(db.events.filter((e) => e.event_id === p[0]).map(({ event_id, match_id, type }) => ({ event_id, match_id, type })));
    }
    if (s.startsWith('SELECT sequence, event_id, type, payload, signature FROM match_events')) {
      return rows(db.events.filter((e) => e.match_id === p[0]).sort((a, b) => a.sequence - b.sequence)
        .map(({ sequence, event_id, type, payload, signature }) => ({ sequence, event_id, type, payload, signature })));
    }
    if (s.startsWith('INSERT INTO match_events')) {
      if (db.events.some((e) => e.event_id === p[2] || (e.match_id === p[0] && e.sequence === p[1]))) {
        throw Object.assign(new Error('dup'), { code: '23505' });
      }
      db.events.push({ match_id: p[0], sequence: p[1], event_id: p[2], type: p[3], payload: json(p[4]),
        payload_canonical: p[5], body_hash: p[6], signature: p[7], response: json(p[8]) });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('SELECT (SELECT count(*)::int')) {
      if (!db.matches.has(p[0])) return rows([]);
      return rows([{ version: db.events.filter((e) => e.match_id === p[0]).length }]);
    }
    if (s.startsWith('SELECT value FROM app_state')) return rows([{ value: db.lotsSeed }]);
    throw new Error(`fake pool: unhandled SQL ${s}`);
  }
  const client = { query };
  return {
    pool: client,
    query,
    tx: async (fn) => fn(client),
    __db: db,
  };
});

process.env.DAY1_SALT = 'demo-salt';
const express = require('express');
const request = require('supertest');
const { __db: db } = require('../backend/src/db/pool');
const { errorHandler } = require('../backend/src/lib/errors');
const { sign } = require('../backend/src/lib/signing');
const { SEED_SPORTS } = require('../backend/src/db/seedData');
const svc = require('../backend/src/services/events');

const app = express();
app.use(express.json());
app.use('/audit/v1', require('../backend/src/routes/audit/sports'));
app.use('/audit/v1', require('../backend/src/routes/audit/leagues'));
app.use('/audit/v1', require('../backend/src/routes/audit/events'));
app.use(errorHandler);

const post = (path, body) => request(app).post(`/audit/v1${path}`).send(body);
let n = 0;
const ev = (match_id, type, payload) => ({ event_id: `evt-${(n += 1)}`, match_id, type, payload });

beforeEach(() => {
  db.sports.clear(); db.leagues.clear(); db.matches.clear(); db.events.length = 0;
  for (const s of SEED_SPORTS) db.sports.set(s.sport_id, JSON.parse(JSON.stringify(s)));
  db.leagues.set('league-alpha-1', { config: null });
});

const league = (over = {}) => ({
  league_id: 'lg-1', sport_id: 'football', teams: ['t1', 't2', 't3', 't4'],
  fixtures: [{ match_id: 'm1', home: 't1', away: 't2' }, { match_id: 'm2', home: 't3', away: 't4' }],
  qualification: { spots: 2 }, ...over,
});

describe('POST /sports', () => {
  const body = {
    sport_id: 'kabaddi', name: 'Kabaddi', scoring_model: 'event', periods: { count: 2, duration_minutes: 20 },
    scoring_events: { raid_point: { points: 1 } }, draw_allowed: false, overtime: { policy: 'golden_score' },
    roster: { min_squad_size: 7, max_squad_size: 12, required_positions: {} },
  };
  test('201 then 409 SPORT_EXISTS; 400 on bad id', async () => {
    const r = await post('/sports', body);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ sport_id: 'kabaddi', status: 'created', config: { ...body, tie_break_order: expect.any(Array) } });
    expect((await post('/sports', body)).body.error.code).toBe('SPORT_EXISTS');
    expect((await post('/sports', { ...body, sport_id: 'football' })).status).toBe(409);
    const bad = await post('/sports', { ...body, sport_id: "'; DROP TABLE x" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: ['sport_id'] } });
  });

  test('new sport is immediately usable in events', async () => {
    await post('/sports', body);
    await post('/events', ev('k1', 'match_init', { sport_id: 'kabaddi', home_team_id: 'a', away_team_id: 'b' }));
    await post('/events', ev('k1', 'match_start', {}));
    await post('/events', ev('k1', 'score', { team_id: 'a', event_type: 'raid_point' }));
    const s = await request(app).get('/audit/v1/score/k1');
    expect(s.body.home.score).toBe(1);
  });
});

describe('POST /leagues', () => {
  test('201, stored config with defaults, fixtures become upcoming matches', async () => {
    db.lotsSeed = 7;
    const r = await post('/leagues', league());
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ league_id: 'lg-1', status: 'created', team_count: 4, fixture_count: 2 });
    expect(db.leagues.get('lg-1').config).toMatchObject({
      points: { win: 3, draw: 1, loss: 0 }, lots_seed: 7, qualification: { spots: 2 },
      tie_break_order: SEED_SPORTS[0].tie_break_order,
    });
    db.lotsSeed = 42;
    const s = await request(app).get('/audit/v1/score/m1');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ match_id: 'm1', league_id: 'lg-1', sport_id: 'football', status: 'upcoming', outcome: 'pending', version: 0, events: [] });
  });

  test('validation order 400 -> 404 -> 409', async () => {
    expect((await post('/leagues', league({ sport_id: 'nope', teams: ['t1'] }))).status).toBe(400);
    expect((await post('/leagues', league({ sport_id: 'nope' }))).body.error.code).toBe('SPORT_NOT_FOUND');
    await post('/leagues', league());
    expect((await post('/leagues', league())).body.error.code).toBe('LEAGUE_EXISTS');
    expect((await post('/leagues', league({ league_id: 'league-alpha-1', fixtures: [] }))).body.error.code).toBe('LEAGUE_EXISTS');
    const m = await post('/leagues', league({ league_id: 'lg-2', fixtures: [{ match_id: 'm9', home: 't1', away: 't2' }, { match_id: 'm2', home: 't1', away: 't2' }] }));
    expect(m.status).toBe(409);
    expect(m.body.error).toMatchObject({ code: 'MATCH_EXISTS', details: { match_id: 'm2' } });
    expect(db.leagues.has('lg-2')).toBe(false);
    const d = await post('/leagues', league({ league_id: 'lg-3', fixtures: [{ match_id: 'x', home: 't1', away: 't2' }, { match_id: 'x', home: 't3', away: 't4' }] }));
    expect(d.body.error.code).toBe('MATCH_EXISTS');
  });
});

describe('POST /events and GET /score', () => {
  test('full match flow with sequence, signature, idempotency and compensation', async () => {
    const init = ev('s1', 'match_init', { sport_id: 'football', home_team_id: 't1', away_team_id: 't2' });
    const r1 = await post('/events', init);
    expect(r1.status).toBe(201);
    expect(r1.body).toEqual({ event_id: init.event_id, match_id: 's1', type: 'match_init', sequence: 1, match_version: 1,
      signature: sign(init.event_id, init.payload, 'demo-salt') });
    expect((await post('/events', init)).status).toBe(200);
    expect((await post('/events', init)).body).toEqual(r1.body);
    expect((await post('/events', { ...init, payload: { ...init.payload, home_team_id: 'zz' } })).body.error.code).toBe('DUPLICATE_EVENT_ID');
    expect((await post('/events', ev('s1', 'match_init', init.payload))).body.error.code).toBe('MATCH_EXISTS');

    const start = { event_id: 'st', match_id: 's1', type: 'match_start' };
    const r2 = await post('/events', start);
    expect(r2.body).toMatchObject({ sequence: 2, match_version: 2, signature: sign('st', {}, 'demo-salt') });
    const goal = ev('s1', 'score', { team_id: 't1', event_type: 'goal' });
    expect((await post('/events', goal)).body.sequence).toBe(3);
    await post('/events', ev('s1', 'score', { team_id: 't2', event_type: 'goal' }));
    await post('/events', ev('s1', 'discipline', { team_id: 't2', points: -1 }));
    const end = ev('s1', 'match_end', {});
    expect((await post('/events', end)).status).toBe(201);
    // Replay of an event that would now be illegal still returns the stored response.
    expect((await post('/events', goal)).status).toBe(200);
    expect((await post('/events', ev('s1', 'score', { team_id: 't1', event_type: 'goal' }))).body.error.code).toBe('MATCH_NOT_IN_PROGRESS');

    const c = ev('s1', 'compensation', { compensates: goal.event_id, reason: 'VAR' });
    expect((await post('/events', c)).status).toBe(201);
    expect((await post('/events', ev('s1', 'compensation', { compensates: goal.event_id, reason: 'again' }))).body.error.code).toBe('INVALID_COMPENSATION');
    expect((await post('/events', ev('s1', 'compensation', { compensates: 'st', reason: 'x' }))).body.error.code).toBe('INVALID_COMPENSATION');
    expect((await post('/events', ev('s1', 'compensation', { compensates: 'nope', reason: 'x' }))).status).toBe(404);

    const s = await request(app).get('/audit/v1/score/s1');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      match_id: 's1', sport_id: 'football', league_id: null, status: 'completed', outcome: 'away_win', winner_team_id: 't2',
      tiebreak_winner_team_id: null, version: 7,
      home: { team_id: 't1', score: 0, wickets: null, balls: null, overs: null, fair_play: 0 },
      away: { team_id: 't2', score: 1, wickets: null, balls: null, overs: null, fair_play: -1 },
    });
    expect(s.body.events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.body.events[2]).toMatchObject({ event_id: goal.event_id, compensated: true, compensated_by: c.event_id,
      signature: sign(goal.event_id, goal.payload, 'demo-salt') });
    expect(await svc.getMatchVersion('s1')).toBe(7);
    expect(await svc.getMatchVersion('none')).toBeNull();
    expect(await svc.getMatchVersion('bad id')).toBeNull();
    expect((await svc.getProjection('s1')).home.score).toBe(0);
    expect(await svc.getProjection('none')).toBeNull();
  });

  test('error ordering and codes', async () => {
    expect((await post('/events', { event_id: 'e', match_id: 'm', type: 'goal' })).body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: ['type'] } });
    expect((await post('/events', ev('nope', 'match_start', {}))).body.error.code).toBe('MATCH_NOT_FOUND');
    expect((await post('/events', ev('x1', 'match_init', { sport_id: 'curling', home_team_id: 'a', away_team_id: 'b' }))).body.error.code).toBe('SPORT_NOT_FOUND');
    await post('/leagues', league());
    expect((await post('/events', ev('m1', 'match_init', { sport_id: 'curling', home_team_id: 'a', away_team_id: 'b' }))).body.error.code).toBe('SPORT_NOT_FOUND');
    expect((await post('/events', ev('m1', 'match_init', { sport_id: 'football', home_team_id: 'a', away_team_id: 'b' }))).body.error.code).toBe('MATCH_EXISTS');
    const bad = await post('/events', ev('m1', 'score', { team_id: 't3', event_type: 'goal' }));
    expect(bad.status).toBe(400);
    expect((await post('/events', ev('m1', 'score', { team_id: 't1', event_type: 'try' }))).body.error.code).toBe('UNKNOWN_EVENT_TYPE');
    expect((await post('/events', ev('m1', 'score', { team_id: 't1', event_type: 'goal' }))).body.error.code).toBe('MATCH_NOT_IN_PROGRESS');
    expect((await post('/events', ev('m1', 'match_end', {}))).body.error.code).toBe('ILLEGAL_TRANSITION');
    await post('/events', ev('m1', 'match_start', {}));
    const g = ev('m1', 'score', { team_id: 't1', event_type: 'goal' });
    await post('/events', g);
    // compensation of an event from another match
    expect((await post('/events', ev('m2', 'compensation', { compensates: g.event_id, reason: 'x' }))).body.error.code).toBe('INVALID_COMPENSATION');
    expect((await request(app).get('/audit/v1/score/missing')).body.error.code).toBe('MATCH_NOT_FOUND');
    expect((await request(app).get("/audit/v1/score/' OR 1=1")).status).toBe(404);
  });

  test('basketball tie needs a tiebreak winner; round model series decided', async () => {
    await post('/events', ev('b1', 'match_init', { sport_id: 'basketball', home_team_id: 'h', away_team_id: 'a' }));
    await post('/events', ev('b1', 'match_start', {}));
    expect((await post('/events', ev('b1', 'match_end', {}))).body.error.code).toBe('TIE_NOT_ALLOWED');
    await post('/events', ev('b1', 'tiebreak_winner', { team_id: 'a' }));
    expect((await post('/events', ev('b1', 'match_end', {}))).status).toBe(201);
    expect((await svc.getScore('b1')).outcome).toBe('away_win');

    await post('/events', ev('e1', 'match_init', { sport_id: 'esports', home_team_id: 'h', away_team_id: 'a' }));
    await post('/events', ev('e1', 'match_start', {}));
    await post('/events', ev('e1', 'score', { team_id: 'h', event_type: 'round_win' }));
    await post('/events', ev('e1', 'score', { team_id: 'h', event_type: 'round_win' }));
    expect((await post('/events', ev('e1', 'score', { team_id: 'a', event_type: 'round_win' }))).body.error.code).toBe('SERIES_ALREADY_DECIDED');
  });

  test('beforeAppend hook sees the current version and can abort', async () => {
    await post('/leagues', league());
    const seen = [];
    await svc.appendEvent(ev('m1', 'match_start', {}), { beforeAppend: ({ version }) => seen.push(version) });
    expect(seen).toEqual([0]);
    await expect(svc.appendEvent(ev('m1', 'score', { team_id: 't1', event_type: 'goal' }), {
      beforeAppend: () => { throw new Error('stop'); },
    })).rejects.toThrow('stop');
    expect(await svc.getMatchVersion('m1')).toBe(1);
    const r = await svc.appendEvent(ev('m1', 'score', { team_id: 't1', event_type: 'goal' }), { client: require('../backend/src/db/pool').pool });
    expect(r).toMatchObject({ statusCode: 201, replay: false, body: { sequence: 2 } });
  });

  test('cricket score exposes balls, wickets and overs', async () => {
    await post('/events', ev('c1', 'match_init', { sport_id: 'cricket', home_team_id: 'h', away_team_id: 'a', league_id: 'lg-x' }));
    await post('/events', ev('c1', 'match_start', {}));
    for (const t of ['four', 'wide', 'six', 'wicket']) await post('/events', ev('c1', 'score', { team_id: 'h', event_type: t }));
    const s = await svc.getScore('c1');
    expect(s.league_id).toBe('lg-x');
    expect(s.home).toEqual({ team_id: 'h', score: 11, wickets: 1, balls: 3, overs: '0.3', fair_play: 0 });
    expect(s.away).toEqual({ team_id: 'a', score: 0, wickets: 0, balls: 0, overs: '0.0', fair_play: 0 });
  });
});
