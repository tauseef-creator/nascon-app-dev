'use strict';
const { computeStandings, round3, resolveCriteria, resolvePoints, isPlayed } = require('../backend/src/domain/standings');

const EVENT_SPORT = {
  sport_id: 'kabaddi',
  scoring_model: 'event',
  periods: { count: 2, duration_minutes: 20 },
  draw_allowed: true,
  tie_break_order: ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'],
};
const INNINGS_SPORT = {
  sport_id: 'mini-cricket',
  scoring_model: 'innings',
  periods: { innings_per_team: 1, overs_per_innings: 10, balls_per_over: 6, wickets_per_innings: 10 },
  draw_allowed: false,
};

// Build a completed projection. side = { score, fair_play, balls, wickets }.
function done(home, away, hs, as, extra = {}) {
  const h = typeof hs === 'object' ? hs : { score: hs };
  const a = typeof as === 'object' ? as : { score: as };
  let outcome = 'draw';
  let winner = null;
  if (h.score > a.score) { outcome = 'home_win'; winner = home; }
  if (a.score > h.score) { outcome = 'away_win'; winner = away; }
  return {
    status: 'completed',
    outcome,
    winner_team_id: winner,
    home: { team_id: home, fair_play: 0, balls: null, wickets: null, ...h },
    away: { team_id: away, fair_play: 0, balls: null, wickets: null, ...a },
    ...extra,
  };
}

// matches: [[match_id, home, away, projection|null]]
function build(teams, matches, opts = {}) {
  const fixtures = matches.map(([match_id, home, away]) => ({ match_id, home, away }));
  const projections = {};
  for (const [id, , , p] of matches) if (p) projections[id] = p;
  const league = {
    league_id: opts.league_id || 'lg-1',
    sport_id: (opts.sport || EVENT_SPORT).sport_id,
    teams,
    fixtures,
    points: opts.points,
    tie_break_order: opts.tie_break_order,
    qualification: { spots: opts.spots || 2 },
  };
  return computeStandings({ league, sport: opts.sport || EVENT_SPORT, projections, lotsSeed: opts.lotsSeed ?? 42 });
}

const order = (r) => r.table.map((x) => x.team_id);
const row = (r, t) => r.table.find((x) => x.team_id === t);

describe('standings: draw_lots (Appendix A test vector 2)', () => {
  test('no matches played: teams ordered ascending by lots key', () => {
    const r = build(['t1', 't2', 't3'], [['m1', 't1', 't2', null], ['m2', 't2', 't3', null], ['m3', 't3', 't1', null]]);
    // keys: t1 0613..., t3 c8f2..., t2 e3e3...
    expect(order(r)).toEqual(['t1', 't3', 't2']);
    expect(r.table.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(r.table.map((x) => x.resolved_by)).toEqual(['draw_lots', 'draw_lots', null]);
    expect(r.league_id).toBe('lg-1');
    expect(r.sport_id).toBe('kabaddi');
    expect(r.qualification_spots).toBe(2);
    expect(row(r, 't1')).toEqual({
      rank: 1, team_id: 't1', played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0, diff: 0,
      points: 0, fair_play: 0, status: 'still_possible', resolved_by: 'draw_lots',
    });
  });

  test('lots seed changes the draw', () => {
    const a = build(['t1', 't2', 't3'], [], { lotsSeed: 42 });
    const b = build(['t1', 't2', 't3'], [], { lotsSeed: 7 });
    expect(order(a)).toEqual(['t1', 't3', 't2']);
    expect(order(b)).toHaveLength(3);
  });

  test('lotsSeed falls back to league.lots_seed, then 42', () => {
    const league = { league_id: 'lg-1', sport_id: 'kabaddi', teams: ['t1', 't2', 't3'], fixtures: [], qualification: { spots: 1 } };
    const r1 = computeStandings({ league, sport: EVENT_SPORT, projections: {} });
    expect(order(r1)).toEqual(['t1', 't3', 't2']);
    const r2 = computeStandings({ league: { ...league, lots_seed: 42 }, sport: EVENT_SPORT });
    expect(order(r2)).toEqual(['t1', 't3', 't2']);
  });
});

describe('standings: basic table and h2h', () => {
  const teams = ['t1', 't2', 't3', 't4'];
  const r = build(teams, [
    ['m1', 't1', 't2', done('t1', 't2', { score: 2, fair_play: 0 }, { score: 1, fair_play: -1 })],
    ['m2', 't3', 't4', done('t3', 't4', 1, 1)],
    ['m3', 't1', 't3', null],
    ['m4', 't2', 't4', { status: 'in_progress', outcome: 'pending', winner_team_id: null, home: { team_id: 't2', score: 5 }, away: { team_id: 't4', score: 0 } }],
  ]);

  test('counts only completed matches', () => {
    expect(row(r, 't1')).toMatchObject({ played: 1, won: 1, drawn: 0, lost: 0, scored: 2, conceded: 1, diff: 1, points: 3, fair_play: 0 });
    expect(row(r, 't2')).toMatchObject({ played: 1, won: 0, lost: 1, scored: 1, conceded: 2, diff: -1, points: 0, fair_play: -1 });
    expect(row(r, 't3')).toMatchObject({ played: 1, drawn: 1, points: 1, scored: 1, conceded: 1, diff: 0 });
    expect(row(r, 't1').resolved_by).toBeNull();
  });

  test('t3 and t4 tied on points: h2h_points equal, h2h_diff equal, overall_diff equal, scored equal, fair_play equal -> draw_lots', () => {
    expect(order(r).slice(1, 3).sort()).toEqual(['t3', 't4']);
    const first = r.table[1];
    expect(first.resolved_by).toBe('draw_lots');
    expect(r.table[2].resolved_by).toBeNull();
  });

  test('h2h present for every ordered pair with zeros', () => {
    expect(Object.keys(r.h2h).sort()).toEqual(teams);
    for (const a of teams) {
      expect(Object.keys(r.h2h[a]).sort()).toEqual(teams.filter((t) => t !== a));
    }
    expect(r.h2h.t1.t2).toEqual({ played: 1, points: 3, scored: 2, conceded: 1 });
    expect(r.h2h.t2.t1).toEqual({ played: 1, points: 0, scored: 1, conceded: 2 });
    expect(r.h2h.t3.t4).toEqual({ played: 1, points: 1, scored: 1, conceded: 1 });
    expect(r.h2h.t1.t3).toEqual({ played: 0, points: 0, scored: 0, conceded: 0 });
    expect(r.h2h.t2.t4).toEqual({ played: 0, points: 0, scored: 0, conceded: 0 });
  });

  test('serialises as plain JSON', () => {
    const json = JSON.parse(JSON.stringify(r));
    expect(json.h2h.t1.t2.points).toBe(3);
    expect(Object.keys(json)).toEqual(['league_id', 'sport_id', 'qualification_spots', 'table', 'h2h']);
    expect(Object.keys(json.table[0])).toEqual(['rank', 'team_id', 'played', 'won', 'drawn', 'lost', 'scored', 'conceded', 'diff', 'points', 'fair_play', 'status', 'resolved_by']);
  });
});

describe('standings: three-way tie (edge case 4)', () => {
  // A beat B 3-0, B beat C 1-0, C beat A 1-0. Everyone beat D.
  const r = build(['A', 'B', 'C', 'D'], [
    ['m1', 'A', 'B', done('A', 'B', 3, 0)],
    ['m2', 'B', 'C', done('B', 'C', 1, 0)],
    ['m3', 'C', 'A', done('C', 'A', 1, 0)],
    ['m4', 'A', 'D', done('A', 'D', 1, 0)],
    ['m5', 'B', 'D', done('B', 'D', 1, 0)],
    ['m6', 'D', 'C', done('D', 'C', 0, 1)],
  ]);

  test('h2h_points equal (3 each), mini-league h2h_diff splits A(+2) C(0) B(-2)', () => {
    expect(order(r)).toEqual(['A', 'C', 'B', 'D']);
    expect(r.table.map((x) => x.points)).toEqual([6, 6, 6, 0]);
    expect(r.table.map((x) => x.resolved_by)).toEqual(['h2h_diff', 'h2h_diff', null, null]);
  });

  test('mini-league ignores matches against teams outside the group', () => {
    // Overall diff would be A +3, B -1, C +1 if D matches counted differently; make C crush D.
    const r2 = build(['A', 'B', 'C', 'D'], [
      ['m1', 'A', 'B', done('A', 'B', 3, 0)],
      ['m2', 'B', 'C', done('B', 'C', 1, 0)],
      ['m3', 'C', 'A', done('C', 'A', 1, 0)],
      ['m4', 'A', 'D', done('A', 'D', 1, 0)],
      ['m5', 'B', 'D', done('B', 'D', 1, 0)],
      ['m6', 'D', 'C', done('D', 'C', 0, 9)],
    ]);
    expect(order(r2)).toEqual(['A', 'C', 'B', 'D']);
    expect(row(r2, 'C').diff).toBe(9);
  });
});

describe('standings: restart on split', () => {
  // A, B, C all on 9 points. Mini-league h2h_points: A 9, B 3, C 3 -> {A}, {B, C}.
  // Restart on {B, C}: h2h_points B 3, C 0 -> B above C (h2h_points).
  // Without restart, the 3-team h2h_diff (B -1, C +3) would wrongly put C above B.
  const r = build(['A', 'B', 'C', 'D'], [
    ['m1', 'A', 'B', done('A', 'B', 1, 0)],
    ['m2', 'B', 'A', done('B', 'A', 0, 1)],
    ['m3', 'A', 'C', done('A', 'C', 0, 5)],
    ['m4', 'C', 'A', done('C', 'A', 0, 1)],
    ['m5', 'B', 'C', done('B', 'C', 1, 0)],
    ['m6', 'B', 'D', done('B', 'D', 2, 0)],
    ['m7', 'D', 'B', done('D', 'B', 0, 2)],
    ['m8', 'C', 'D', done('C', 'D', 1, 0)],
    ['m9', 'D', 'C', done('D', 'C', 0, 1)],
  ]);

  test('order and resolved_by', () => {
    expect(order(r)).toEqual(['A', 'B', 'C', 'D']);
    expect(r.table.map((x) => x.points)).toEqual([9, 9, 9, 0]);
    expect(r.table.map((x) => x.resolved_by)).toEqual(['h2h_points', 'h2h_points', null, null]);
  });

  test('table rows', () => {
    expect(row(r, 'A')).toMatchObject({ played: 4, won: 3, lost: 1, scored: 3, conceded: 5, diff: -2 });
    expect(row(r, 'B')).toMatchObject({ played: 5, won: 3, lost: 2, scored: 5, conceded: 2, diff: 3 });
    expect(row(r, 'C')).toMatchObject({ played: 5, won: 3, lost: 2, scored: 7, conceded: 2, diff: 5 });
    expect(row(r, 'D')).toMatchObject({ played: 4, won: 0, lost: 4, scored: 0, conceded: 6, diff: -6, points: 0 });
    expect(r.h2h.A.B).toEqual({ played: 2, points: 6, scored: 2, conceded: 0 });
    expect(r.h2h.C.A).toEqual({ played: 2, points: 3, scored: 5, conceded: 1 });
  });

  test('restart after a non-h2h criterion split', () => {
    // order: scored first, then h2h_points. X, Y, Z on 3 points each.
    // scored: X 5, Y 2, Z 2 -> {X}, {Y, Z}; restart on {Y, Z}: scored equal, h2h_points Y beat Z.
    const r2 = build(['X', 'Y', 'Z'], [
      ['m1', 'X', 'Y', done('X', 'Y', 4, 0)],
      ['m2', 'Y', 'Z', done('Y', 'Z', 2, 0)],
      ['m3', 'Z', 'X', done('Z', 'X', 2, 1)],
    ], { tie_break_order: ['scored', 'h2h_points'] });
    expect(order(r2)).toEqual(['X', 'Y', 'Z']);
    expect(r2.table.map((x) => x.resolved_by)).toEqual(['scored', 'h2h_points', null]);
  });
});

describe('standings: criteria and configuration', () => {
  test('overall_diff, scored, fair_play criteria', () => {
    // P and Q never meet, both 3 points.
    const base = (pHome, qHome) => [
      ['m1', 'P', 'R', done('P', 'R', pHome, 0)],
      ['m2', 'Q', 'S', done('Q', 'S', qHome, 0)],
    ];
    const r1 = build(['P', 'Q', 'R', 'S'], base(3, 1));
    expect(order(r1).slice(0, 2)).toEqual(['P', 'Q']);
    expect(r1.table[0].resolved_by).toBe('overall_diff');

    // equal diff, different scored
    const r2 = build(['P', 'Q', 'R', 'S'], [
      ['m1', 'P', 'R', done('P', 'R', 2, 1)],
      ['m2', 'Q', 'S', done('Q', 'S', 3, 2)],
    ]);
    expect(order(r2).slice(0, 2)).toEqual(['Q', 'P']);
    expect(r2.table[0].resolved_by).toBe('scored');

    // equal everything except fair play
    const r3 = build(['P', 'Q', 'R', 'S'], [
      ['m1', 'P', 'R', done('P', 'R', { score: 1, fair_play: -3 }, 0)],
      ['m2', 'Q', 'S', done('Q', 'S', { score: 1, fair_play: -1 }, 0)],
    ]);
    expect(order(r3).slice(0, 2)).toEqual(['Q', 'P']);
    expect(r3.table[0].resolved_by).toBe('fair_play');
    expect(row(r3, 'P').fair_play).toBe(-3);
  });

  test('custom points and win via tiebreak_winner with level scores', () => {
    const r = build(['A', 'B'], [
      ['m1', 'A', 'B', { ...done('A', 'B', 1, 1), outcome: 'away_win', winner_team_id: 'B', tiebreak_winner_team_id: 'B' }],
      ['m2', 'B', 'A', { ...done('B', 'A', 2, 2), outcome: undefined, winner_team_id: 'A' }],
    ], { points: { win: 2, loss: 1 } });
    expect(row(r, 'A')).toMatchObject({ played: 2, won: 1, lost: 1, drawn: 0, points: 3, scored: 3, conceded: 3, diff: 0 });
    expect(row(r, 'B')).toMatchObject({ played: 2, won: 1, lost: 1, points: 3 });
  });

  test('draw points default to 1, loss to 0', () => {
    expect(resolvePoints(undefined)).toEqual({ win: 3, draw: 1, loss: 0 });
    expect(resolvePoints({ win: 2 })).toEqual({ win: 2, draw: 1, loss: 0 });
    expect(resolvePoints({ win: 'x', draw: 0, loss: -1 })).toEqual({ win: 3, draw: 0, loss: -1 });
  });

  test('undecided and in-progress matches are not played', () => {
    expect(isPlayed({ status: 'completed', outcome: 'undecided' })).toBe(false);
    expect(isPlayed({ status: 'in_progress', outcome: 'pending' })).toBe(false);
    expect(isPlayed(null)).toBe(false);
    expect(isPlayed({ status: 'completed', outcome: 'draw' })).toBe(true);
    const r = build(['A', 'B'], [['m1', 'A', 'B', { ...done('A', 'B', 1, 1), outcome: 'undecided' }]]);
    expect(row(r, 'A').played).toBe(0);
    expect(r.h2h.A.B.played).toBe(0);
  });

  test('tie_break_order resolution: league, sport, default; draw_lots moved last; dedupe and unknown dropped', () => {
    expect(resolveCriteria({ tie_break_order: ['draw_lots', 'scored', 'scored', 'bogus'] }, EVENT_SPORT)).toEqual(['scored', 'draw_lots']);
    expect(resolveCriteria({}, { tie_break_order: ['fair_play'] })).toEqual(['fair_play', 'draw_lots']);
    expect(resolveCriteria({}, {})).toEqual(['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots']);
    expect(resolveCriteria({}, null)).toHaveLength(6);
    expect(resolveCriteria({ tie_break_order: [] }, EVENT_SPORT)).toEqual(['draw_lots']);
  });

  test('fair_play only order skips h2h (A beat B but has worse fair play)', () => {
    const r = build(['A', 'B', 'C'], [
      ['m1', 'A', 'B', done('A', 'B', { score: 1, fair_play: -5 }, 0)],
      ['m2', 'B', 'C', done('B', 'C', 1, 0)],
      ['m3', 'C', 'A', done('C', 'A', 1, 0)],
    ], { tie_break_order: ['fair_play'] });
    expect(order(r)[2]).toBe('A');
    expect(r.table[1].resolved_by).toBe('fair_play');
  });

  test('round model diff is rounds won minus rounds lost', () => {
    const sport = { sport_id: 'esports', scoring_model: 'round', periods: { best_of: 5 } };
    const r = build(['A', 'B'], [['m1', 'A', 'B', done('A', 'B', 3, 1)]], { sport });
    expect(row(r, 'A').diff).toBe(2);
    expect(row(r, 'B').diff).toBe(-2);
  });

  test('ids that collide with Object.prototype keys are safe', () => {
    const r = build(['__proto__', 'constructor'], [['m1', '__proto__', 'constructor', done('__proto__', 'constructor', 2, 0)]]);
    expect(order(r)).toEqual(['__proto__', 'constructor']);
    expect(JSON.parse(JSON.stringify(r)).h2h.__proto__.constructor.points).toBe(3);
  });

  test('missing qualification spots yields null', () => {
    const r = computeStandings({ league: { league_id: 'x', sport_id: 's', teams: ['a', 'b'] }, sport: EVENT_SPORT, projections: {}, lotsSeed: 1 });
    expect(r.qualification_spots).toBeNull();
    expect(r.table).toHaveLength(2);
  });
});

describe('standings: innings model net run rate', () => {
  const side = (score, balls, wickets) => ({ score, balls, wickets });
  // X beat Y, Y beat Z, Z beat X: all 3 points, h2h_points equal; NRR decides.
  const r = build(['X', 'Y', 'Z'], [
    ['m1', 'X', 'Y', done('X', 'Y', side(100, 57, 3), side(80, 45, 10))],
    ['m2', 'Y', 'Z', done('Y', 'Z', side(120, 60, 5), side(90, 50, 10))],
    ['m3', 'Z', 'X', done('Z', 'X', side(150, 60, 2), side(149, 60, 8))],
  ], { sport: INNINGS_SPORT });

  test('NRR with all-out innings counted as full overs, rounded to 3 decimals', () => {
    // X: 249/19.5 - 230/20 = 1.2692 ; Y: 200/20 - 190/19.5 = 0.2564 ; Z: 240/20 - 269/20 = -1.45
    expect(row(r, 'X').diff).toBe(1.269);
    expect(row(r, 'Y').diff).toBe(0.256);
    expect(row(r, 'Z').diff).toBe(-1.45);
    expect(row(r, 'X')).toMatchObject({ scored: 249, conceded: 230, points: 3 });
  });

  test('h2h_diff uses NRR over mini-league matches', () => {
    expect(order(r)).toEqual(['X', 'Y', 'Z']);
    expect(r.table.map((x) => x.resolved_by)).toEqual(['h2h_diff', 'h2h_diff', null]);
  });

  test('zero overs guarded', () => {
    const r2 = build(['X', 'Y'], [['m1', 'X', 'Y', null]], { sport: INNINGS_SPORT });
    expect(row(r2, 'X').diff).toBe(0);
    const r3 = build(['X', 'Y'], [['m1', 'X', 'Y', done('X', 'Y', side(4, 0, 0), side(0, 6, 0))]], { sport: INNINGS_SPORT });
    // X faced 0 balls: its run rate term and Y's conceded-rate term are guarded to 0.
    expect(row(r3, 'X').diff).toBe(0);
    expect(row(r3, 'Y').diff).toBe(0);
  });

  test('missing periods fall back safely', () => {
    const sport = { sport_id: 'c2', scoring_model: 'innings' };
    const r4 = build(['X', 'Y'], [['m1', 'X', 'Y', done('X', 'Y', side(12, 12, 0), side(6, 12, 0))]], { sport });
    expect(row(r4, 'X').diff).toBe(3);
  });

  test('round3 behaves like Python round', () => {
    expect(round3(1.2692307)).toBe(1.269);
    expect(round3(0.0625)).toBe(0.062);
    expect(round3(0.1875)).toBe(0.188);
    expect(round3(-0.0004)).toBe(0);
    expect(Object.is(round3(-0.0004), 0)).toBe(true);
    expect(round3(2.0005)).toBe(2.001);
  });
});

describe('standings: qualification status', () => {
  // A 9, B 3, C 3, D 0; only B-C remains (undecided counts as remaining). k = 2.
  const r = build(['A', 'B', 'C', 'D'], [
    ['m1', 'A', 'B', done('A', 'B', 1, 0)],
    ['m2', 'C', 'D', done('C', 'D', 1, 0)],
    ['m3', 'A', 'C', done('A', 'C', 1, 0)],
    ['m4', 'B', 'D', done('B', 'D', 1, 0)],
    ['m5', 'A', 'D', done('A', 'D', 1, 0)],
    ['m6', 'B', 'C', { ...done('B', 'C', 0, 0), outcome: 'undecided' }],
  ]);

  test('clinched / still_possible / eliminated', () => {
    expect(row(r, 'A').status).toBe('clinched');
    expect(row(r, 'B').status).toBe('still_possible');
    expect(row(r, 'C').status).toBe('still_possible');
    expect(row(r, 'D').status).toBe('eliminated');
  });

  test('after a correction removes a win, statuses recompute (edge case 5)', () => {
    const r2 = build(['A', 'B', 'C', 'D'], [
      ['m1', 'A', 'B', done('A', 'B', 1, 0)],
      ['m2', 'C', 'D', done('C', 'D', 1, 0)],
      ['m3', 'A', 'C', done('A', 'C', 1, 0)],
      ['m4', 'B', 'D', done('B', 'D', 1, 0)],
      ['m5', 'A', 'D', done('A', 'D', 0, 0)],
      ['m6', 'B', 'C', done('B', 'C', 1, 0)],
    ]);
    // A 7, B 6, C 3, D 1; nothing remains.
    expect(r2.table.map((x) => [x.team_id, x.points, x.status])).toEqual([
      ['A', 7, 'clinched'], ['B', 6, 'clinched'], ['C', 3, 'eliminated'], ['D', 1, 'eliminated'],
    ]);
  });

  test('spots equal to team count: everyone clinched', () => {
    const r3 = build(['A', 'B'], [['m1', 'A', 'B', null]], { spots: 2 });
    expect(r3.table.map((x) => x.status)).toEqual(['clinched', 'clinched']);
    const r4 = build(['A', 'B'], [['m1', 'A', 'B', null]], { spots: 1 });
    expect(r4.table.map((x) => x.status)).toEqual(['still_possible', 'still_possible']);
  });
});
