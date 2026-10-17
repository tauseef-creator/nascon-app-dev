'use strict';
const S = require('../backend/src/domain/scoring');
const { SEED_SPORTS } = require('../backend/src/db/seedData');

const sport = (id) => SEED_SPORTS.find((s) => s.sport_id === id);
const football = sport('football');
const basketball = sport('basketball');
const cricket = sport('cricket');
const esports = sport('esports');
const match = (sportId = 'football', leagueId = 'lg-1') => ({
  match_id: 'm1', sport_id: sportId, league_id: leagueId, home_team_id: 't1', away_team_id: 't2',
});

// Builds an ordered log from [type, payload] pairs; event ids are e1, e2, ...
function log(...items) {
  return items.map(([type, payload = {}], i) => ({
    sequence: i + 1, event_id: `e${i + 1}`, type, payload, signature: `sig${i + 1}`,
  }));
}
const score = (team, eventType) => ['score', { team_id: team, event_type: eventType }];
const comp = (target) => ['compensation', { compensates: target, reason: 'fix' }];
const project = (sp, items, m = match(sp.sport_id)) => S.projectMatch(sp, log(...items), m);
const check = (sp, items, type, payload, ctx) =>
  S.validateEventAgainstState(sp, project(sp, items), { event_id: 'new', match_id: 'm1', type, payload }, ctx);

describe('projectMatch: event model', () => {
  test('empty log is upcoming and pending', () => {
    const p = S.projectMatch(football, [], { ...match(), league_id: undefined });
    expect(p.status).toBe('upcoming');
    expect(p.outcome).toBe('pending');
    expect(p.winner_team_id).toBeNull();
    expect(p.league_id).toBeNull();
    expect(p.version).toBe(0);
    expect(p.home).toMatchObject({ team_id: 't1', score: 0, wickets: null, balls: null, overs: null, fair_play: 0 });
  });

  test('spec example: home win 2-1 with discipline', () => {
    const p = project(football, [
      ['match_init', { sport_id: 'football', home_team_id: 't1', away_team_id: 't2' }],
      ['match_start'], score('t1', 'goal'), score('t2', 'goal'), score('t1', 'goal'),
      ['discipline', { team_id: 't2', points: -1 }], ['match_end'],
    ]);
    expect(p.status).toBe('completed');
    expect(p.outcome).toBe('home_win');
    expect(p.winner_team_id).toBe('t1');
    expect(p.home.score).toBe(2);
    expect(p.away.score).toBe(1);
    expect(p.away.fair_play).toBe(-1);
    expect(p.version).toBe(7);
    expect(p.events[0]).toEqual({
      sequence: 1, event_id: 'e1', type: 'match_init',
      payload: { sport_id: 'football', home_team_id: 't1', away_team_id: 't2' },
      signature: 'sig1', compensated: false, compensated_by: null,
    });
  });

  test('in progress keeps outcome pending and winner null', () => {
    const p = project(football, [['match_start'], score('t2', 'goal')]);
    expect(p.status).toBe('in_progress');
    expect(p.outcome).toBe('pending');
    expect(p.winner_team_id).toBeNull();
  });

  test('away win, draw', () => {
    expect(project(football, [['match_start'], score('t2', 'goal'), ['match_end']]).outcome).toBe('away_win');
    const d = project(football, [['match_start'], ['match_end']]);
    expect(d.outcome).toBe('draw');
    expect(d.winner_team_id).toBeNull();
  });

  test('points come from config, unknown event types and teams are ignored', () => {
    const p = project(basketball, [['match_start'], score('t1', 'three_pointer'), score('t1', 'free_throw'),
      score('t2', 'two_pointer'), score('t3', 'two_pointer'), score('t2', 'constructor'), ['discipline', { team_id: 't1', points: 'x' }]]);
    expect(p.home.score).toBe(4);
    expect(p.away.score).toBe(2);
    expect(p.home.fair_play).toBe(0);
  });

  test('compensation neutralises the target and itself', () => {
    const p = project(football, [['match_start'], score('t1', 'goal'), comp('e2'), comp('e2'), ['match_end']]);
    expect(p.home.score).toBe(0);
    expect(p.outcome).toBe('draw');
    expect(p.events[1]).toMatchObject({ compensated: true, compensated_by: 'e3' });
    expect(p.events[2]).toMatchObject({ compensated: false, compensated_by: null });
    expect(p.events[3].compensated).toBe(false);
  });

  test('compensation of non-compensable or missing targets is ignored', () => {
    const p = project(football, [['match_start'], comp('e1'), comp('zzz'), ['compensation', {}]]);
    expect(p.events[0].compensated).toBe(false);
    expect(p.status).toBe('in_progress');
  });

  test('tiebreak winner decides a level match; compensation makes it undecided', () => {
    const base = [['match_start'], score('t1', 'two_pointer'), score('t2', 'two_pointer'), ['tiebreak_winner', { team_id: 't2' }], ['match_end']];
    const p = project(basketball, base);
    expect(p.outcome).toBe('away_win');
    expect(p.winner_team_id).toBe('t2');
    expect(p.tiebreak_winner_team_id).toBe('t2');
    const q = project(basketball, [...base, comp('e4')]);
    expect(q.outcome).toBe('undecided');
    expect(q.winner_team_id).toBeNull();
    expect(q.tiebreak_winner_team_id).toBeNull();
    const h = project(basketball, [['match_start'], ['tiebreak_winner', { team_id: 't1' }], ['match_end']]);
    expect(h.outcome).toBe('home_win');
    expect(h.winner_team_id).toBe('t1');
  });

  test('tiebreak winner overrides a draw even when draws are allowed; higher score still wins', () => {
    expect(project(football, [['match_start'], ['tiebreak_winner', { team_id: 't1' }], ['match_end']]).outcome).toBe('home_win');
    expect(project(football, [['match_start'], score('t2', 'goal'), ['tiebreak_winner', { team_id: 't1' }], ['match_end']]).winner_team_id).toBe('t2');
  });

  test('duplicate match_start / match_end in the log do not change status twice', () => {
    expect(project(football, [['match_end'], ['match_start'], ['match_start']]).status).toBe('in_progress');
  });

  test('events without payload are tolerated', () => {
    const p = S.projectMatch(football, [{ sequence: 1, event_id: 'x', type: 'match_start' }], match());
    expect(p.status).toBe('in_progress');
  });

  test('toScoreResponse returns exactly the spec fields', () => {
    const r = S.toScoreResponse(project(football, [['match_start']]));
    expect(Object.keys(r)).toEqual(['match_id', 'sport_id', 'league_id', 'status', 'outcome', 'winner_team_id',
      'tiebreak_winner_team_id', 'home', 'away', 'version', 'events']);
    expect(Object.keys(r.home)).toEqual(['team_id', 'score', 'wickets', 'balls', 'overs', 'fair_play']);
  });
});

describe('projectMatch: innings model', () => {
  test('runs, legal balls, wickets and overs', () => {
    const p = project(cricket, [['match_start'], score('t1', 'four'), score('t1', 'wide'), score('t1', 'six'),
      score('t1', 'wicket'), score('t1', 'dot_ball'), score('t1', 'single'), score('t1', 'two'), score('t1', 'no_ball'),
      score('t2', 'single')]);
    expect(p.home).toMatchObject({ score: 15, balls: 6, wickets: 1, overs: '1.0', all_out: false, innings_complete: false });
    expect(p.away).toMatchObject({ score: 1, balls: 1, wickets: 0, overs: '0.1' });
    expect(p.limits).toEqual({ max_balls: 120, max_wickets: 10, balls_per_over: 6, rounds_to_win: null });
    expect(p.scoring_model).toBe('innings');
  });

  test('all out flags', () => {
    const items = [['match_start']];
    for (let i = 0; i < 10; i += 1) items.push(score('t2', 'wicket'));
    const p = project(cricket, items);
    expect(p.away).toMatchObject({ wickets: 10, balls: 10, overs: '1.4', all_out: true, innings_complete: true });
  });

  test('formatOvers', () => {
    expect(S.formatOvers(20, 6)).toBe('3.2');
    expect(S.formatOvers(0, 6)).toBe('0.0');
    expect(S.formatOvers(9, 4)).toBe('2.1');
  });
});

describe('projectMatch: round model', () => {
  test('rounds won and limits', () => {
    const p = project(esports, [['match_start'], score('t1', 'round_win'), score('t2', 'round_win'), score('t1', 'round_win'), ['match_end']]);
    expect(p.home.score).toBe(2);
    expect(p.away.score).toBe(1);
    expect(p.outcome).toBe('home_win');
    expect(p.home.wickets).toBeNull();
    expect(p.limits.rounds_to_win).toBe(2);
  });

  test('modelLimits for unknown periods', () => {
    expect(S.modelLimits({ scoring_model: 'event' })).toEqual({ max_balls: null, max_wickets: null, balls_per_over: null, rounds_to_win: null });
  });

  test('projection with a minimal config has no scoring events', () => {
    const p = S.projectMatch({ scoring_model: 'event' }, log(['match_start'], score('t1', 'goal')), match());
    expect(p.home.score).toBe(0);
  });
});

describe('validateEventAgainstState', () => {
  test('match_init on an existing stream', () => {
    expect(check(football, [], 'match_init', {})).toMatchObject({ status: 409, code: 'MATCH_EXISTS' });
  });

  test('match_start only from upcoming', () => {
    expect(check(football, [], 'match_start', {})).toBeNull();
    expect(check(football, [['match_start']], 'match_start', {})).toMatchObject({ status: 409, code: 'ILLEGAL_TRANSITION' });
    expect(check(football, [['match_start'], ['match_end']], 'match_start', {}).code).toBe('ILLEGAL_TRANSITION');
  });

  test('score: team check (400) before unknown type (400) before status (409)', () => {
    const r = check(football, [], 'score', { team_id: 't9', event_type: 'nope' });
    expect(r).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(r.details.fields).toContain('payload.team_id');
    expect(check(football, [], 'score', { team_id: 't1', event_type: 'touchdown' })).toMatchObject({ status: 400, code: 'UNKNOWN_EVENT_TYPE' });
    expect(check(football, [], 'score', { team_id: 't1', event_type: 'toString' }).code).toBe('UNKNOWN_EVENT_TYPE');
    expect(check(football, [], 'score', { team_id: 't1', event_type: 'goal' })).toMatchObject({ status: 409, code: 'MATCH_NOT_IN_PROGRESS' });
    expect(check(football, [['match_start'], ['match_end']], 'score', { team_id: 't1', event_type: 'goal' }).code).toBe('MATCH_NOT_IN_PROGRESS');
    expect(check(football, [['match_start']], 'score', { team_id: 't2', event_type: 'goal' })).toBeNull();
  });

  test('discipline and tiebreak_winner need a match team and in_progress', () => {
    for (const type of ['discipline', 'tiebreak_winner']) {
      expect(check(football, [['match_start']], type, { team_id: 'x', points: -1 }).code).toBe('VALIDATION_ERROR');
      expect(check(football, [], type, { team_id: 't1', points: -1 }).code).toBe('MATCH_NOT_IN_PROGRESS');
      expect(check(football, [['match_start']], type, { team_id: 't1', points: -1 })).toBeNull();
    }
  });

  test('match_end transitions and tie rules', () => {
    expect(check(football, [], 'match_end', {})).toMatchObject({ status: 409, code: 'ILLEGAL_TRANSITION' });
    expect(check(football, [['match_start']], 'match_end', {})).toBeNull();
    expect(check(basketball, [['match_start']], 'match_end', {})).toMatchObject({ status: 409, code: 'TIE_NOT_ALLOWED' });
    expect(check(basketball, [['match_start'], score('t1', 'free_throw')], 'match_end', {})).toBeNull();
    expect(check(basketball, [['match_start'], ['tiebreak_winner', { team_id: 't2' }]], 'match_end', {})).toBeNull();
    expect(check(basketball, [['match_start'], ['tiebreak_winner', { team_id: 't2' }], comp('e2')], 'match_end', {}).code)
      .toBe('TIE_NOT_ALLOWED');
    expect(check(basketball, [['match_start'], score('t1', 'free_throw'), comp('e2')], 'match_end', {}).code).toBe('TIE_NOT_ALLOWED');
  });

  test('innings limits: balls and wickets; compensated events do not count', () => {
    const balls = [['match_start']];
    for (let i = 0; i < 120; i += 1) balls.push(score('t1', 'dot_ball'));
    expect(check(cricket, balls, 'score', { team_id: 't1', event_type: 'wide' })).toMatchObject({ status: 409, code: 'INNINGS_COMPLETE' });
    expect(check(cricket, balls, 'score', { team_id: 't2', event_type: 'six' })).toBeNull();
    expect(check(cricket, [...balls, comp('e2')], 'score', { team_id: 't1', event_type: 'six' })).toBeNull();
    const wk = [['match_start']];
    for (let i = 0; i < 10; i += 1) wk.push(score('t2', 'wicket'));
    expect(check(cricket, wk, 'score', { team_id: 't2', event_type: 'single' }).code).toBe('INNINGS_COMPLETE');
    expect(check(cricket, [...wk, comp('e3')], 'score', { team_id: 't2', event_type: 'single' })).toBeNull();
  });

  test('innings limits scale with innings_per_team', () => {
    const two = { ...cricket, periods: { innings_per_team: 2, overs_per_innings: 1, balls_per_over: 2, wickets_per_innings: 1 } };
    const items = [['match_start'], score('t1', 'wicket')];
    expect(check(two, items, 'score', { team_id: 't1', event_type: 'single' })).toBeNull();
    items.push(score('t1', 'wicket'));
    expect(check(two, items, 'score', { team_id: 't1', event_type: 'single' }).code).toBe('INNINGS_COMPLETE');
  });

  test('round model: series decided for either team', () => {
    const items = [['match_start'], score('t1', 'round_win'), score('t1', 'round_win')];
    expect(check(esports, items, 'score', { team_id: 't2', event_type: 'round_win' })).toMatchObject({ status: 409, code: 'SERIES_ALREADY_DECIDED' });
    expect(check(esports, items.slice(0, 2), 'score', { team_id: 't2', event_type: 'round_win' })).toBeNull();
    expect(check(esports, [...items, comp('e3')], 'score', { team_id: 't1', event_type: 'round_win' })).toBeNull();
  });

  test('compensation rules', () => {
    const items = [['match_start'], score('t1', 'goal'), comp('e2')];
    const target = (id, type, matchId = 'm1') => ({ target: { event_id: id, match_id: matchId, type } });
    expect(check(football, items, 'compensation', { compensates: 'zz' }, {})).toMatchObject({ status: 404, code: 'EVENT_NOT_FOUND' });
    expect(check(football, items, 'compensation', { compensates: 'zz' })).toMatchObject({ status: 404, code: 'EVENT_NOT_FOUND' });
    expect(check(football, items, 'compensation', { compensates: 'x' }, target('x', 'score', 'm2'))).toMatchObject({ status: 409, code: 'INVALID_COMPENSATION' });
    expect(check(football, items, 'compensation', { compensates: 'e1' }, target('e1', 'match_start')).code).toBe('INVALID_COMPENSATION');
    expect(check(football, items, 'compensation', { compensates: 'e3' }, target('e3', 'compensation')).code).toBe('INVALID_COMPENSATION');
    expect(check(football, items, 'compensation', { compensates: 'e2' }, target('e2', 'score')).code).toBe('INVALID_COMPENSATION');
    const done = [['match_start'], score('t1', 'goal'), ['match_end']];
    expect(check(football, done, 'compensation', { compensates: 'e2' }, target('e2', 'score'))).toBeNull();
    expect(check(football, [], 'compensation', { compensates: 'e2' }, target('e2', 'discipline'))).toBeNull();
  });

  test('unknown type and missing payload', () => {
    expect(check(football, [], 'bogus', {}).code).toBe('VALIDATION_ERROR');
    expect(S.validateEventAgainstState(football, project(football, []), { type: 'match_start' })).toBeNull();
  });
});

describe('validateEventBody', () => {
  const ok = (body) => S.validateEventBody(body);
  test('valid bodies', () => {
    expect(ok({ event_id: 'e1', match_id: 'm1', type: 'match_start' })).toEqual({
      ok: true, fields: [], event: { event_id: 'e1', match_id: 'm1', type: 'match_start', payload: {} },
    });
    expect(ok({ event_id: 'e1', match_id: 'm1', type: 'match_init', payload: { sport_id: 'f', home_team_id: 'a', away_team_id: 'b', league_id: null } }).ok).toBe(true);
    expect(ok({ event_id: 'e1', match_id: 'm1', type: 'score', payload: { team_id: 't', event_type: 'goal' } }).ok).toBe(true);
    expect(ok({ event_id: 'e1', match_id: 'm1', type: 'compensation', payload: { compensates: 'e0', reason: '' } }).ok).toBe(true);
  });

  test('envelope errors', () => {
    expect(ok(null).fields).toEqual(['body']);
    expect(ok({}).fields).toEqual(expect.arrayContaining(['event_id', 'match_id', 'type']));
    expect(ok({ event_id: 'bad|id', match_id: 'm1', type: 'goal' }).fields).toEqual(['event_id', 'type']);
    expect(ok({ event_id: 'e', match_id: 'm', type: 'score', payload: [] }).fields).toEqual(['payload']);
  });

  test('payload errors per type', () => {
    const f = (type, payload) => ok({ event_id: 'e', match_id: 'm', type, payload }).fields;
    expect(f('match_init', {})).toEqual(expect.arrayContaining(['payload', 'payload.sport_id', 'payload.home_team_id', 'payload.away_team_id']));
    expect(f('match_init', { sport_id: 's', home_team_id: 'a', away_team_id: 'a' })).toContain('payload.away_team_id');
    expect(f('match_init', { sport_id: 's', home_team_id: 'a', away_team_id: 'b', league_id: 5 })).toContain('payload.league_id');
    expect(f('score', { team_id: 't' })).toContain('payload.event_type');
    expect(f('score', { event_type: '' })).toEqual(expect.arrayContaining(['payload.team_id', 'payload.event_type']));
    expect(f('discipline', { team_id: 't', points: 1.5 })).toContain('payload.points');
    expect(f('discipline', { points: -1 })).toContain('payload.team_id');
    expect(f('tiebreak_winner', {})).toContain('team_id');
    expect(f('compensation', {})).toEqual(expect.arrayContaining(['payload.compensates', 'payload.reason']));
  });
});

describe('validateLeagueBody (spec 5.8)', () => {
  const body = () => ({
    league_id: 'lg-1', sport_id: 'football', teams: ['t1', 't2', 't3', 't4'],
    fixtures: [{ match_id: 'm1', home: 't1', away: 't2' }, { match_id: 'm2', home: 't3', away: 't4' }],
    points: { win: 3, draw: 1, loss: 0 },
    tie_break_order: ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'],
    qualification: { spots: 2 }, lots_seed: 42,
  });

  test('spec example is valid', () => {
    const r = S.validateLeagueBody({ ...body(), name: 'L' });
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ league_id: 'lg-1', name: 'L', points: { win: 3, draw: 1, loss: 0 }, lots_seed: 42, qualification: { spots: 2 } });
  });

  test('defaults for optional fields', () => {
    const b = body();
    delete b.points; delete b.tie_break_order; delete b.lots_seed;
    const r = S.validateLeagueBody(b);
    expect(r.value).toMatchObject({ points: { win: 3, draw: 1, loss: 0 }, tie_break_order: null, lots_seed: null, name: null });
    expect(S.validateLeagueBody({ ...body(), points: { win: 2 } }).value.points).toEqual({ win: 2, draw: 1, loss: 0 });
    expect(S.validateLeagueBody({ ...body(), fixtures: [] }).ok).toBe(true);
  });

  test.each([
    ['league_id', 'bad id'], ['sport_id', 7], ['teams', ['t1']], ['teams', 'x'], ['teams', ['t1', 't1']],
    ['fixtures', {}], ['points', 3], ['tie_break_order', ['x']], ['qualification', null], ['lots_seed', '42'],
  ])('rejects %s = %p', (field, value) => {
    const r = S.validateLeagueBody({ ...body(), [field]: value });
    expect(r.ok).toBe(false);
    expect(r.fields).toContain(field);
  });

  test('too many teams, bad team id', () => {
    const many = Array.from({ length: 41 }, (_, i) => `t${i}`);
    expect(S.validateLeagueBody({ ...body(), teams: many }).fields).toContain('teams');
    expect(S.validateLeagueBody({ ...body(), teams: ['t1', 'a|b', 't3', 't4'] }).fields).toContain('teams[1]');
  });

  test('fixture rules', () => {
    const f = (fixtures) => S.validateLeagueBody({ ...body(), fixtures }).fields;
    expect(f([{ match_id: 'm1', home: 't1', away: 't1' }])).toEqual(expect.arrayContaining(['fixtures', 'fixtures[0].away', 'away']));
    expect(f([{ match_id: 'm1', home: 't9', away: 't1' }])).toContain('fixtures[0].home');
    expect(f([{ home: 't2', away: 't1' }])).toContain('fixtures[0].match_id');
    expect(f([5])).toContain('fixtures[0]');
  });

  test('points values and qualification spots', () => {
    expect(S.validateLeagueBody({ ...body(), points: { draw: 'x' } }).fields).toContain('points.draw');
    expect(S.validateLeagueBody({ ...body(), qualification: { spots: 5 } }).fields).toContain('qualification.spots');
    expect(S.validateLeagueBody({ ...body(), qualification: { spots: 0 } }).fields).toContain('qualification.spots');
    expect(S.validateLeagueBody({ ...body(), qualification: { spots: 4 } }).ok).toBe(true);
  });

  test('non-object body and duplicate fixture ids', () => {
    expect(S.validateLeagueBody('x').fields).toEqual(['body']);
    expect(S.duplicateFixtureId([{ match_id: 'a' }, { match_id: 'b' }, { match_id: 'a' }])).toBe('a');
    expect(S.duplicateFixtureId([{ match_id: 'a' }])).toBeNull();
  });
});
