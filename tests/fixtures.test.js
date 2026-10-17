'use strict';

const { generateFixtures, FORMATS } = require('../backend/src/domain/fixtures/index');
const { roundRobin, circleLeg } = require('../backend/src/domain/fixtures/roundRobin');
const { swiss, computeStandings } = require('../backend/src/domain/fixtures/swiss');
const { singleElim } = require('../backend/src/domain/fixtures/singleElim');
const { doubleElim } = require('../backend/src/domain/fixtures/doubleElim');
const { seedOrder, bracketSize, parseResults, parseBool } = require('../backend/src/domain/fixtures/bracket');
const { maxMatching, hasPerfect, minCostPerfect } = require('../backend/src/domain/fixtures/matching');

const ids = (n) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const flat = (res) => res.rounds.flatMap((r) => r.matches);
const expectValidation = (fn) => {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).not.toBeNull();
  expect(err.status).toBe(400);
  expect(err.code).toBe('VALIDATION_ERROR');
  return err;
};

describe('round robin', () => {
  test.each([4, 6, 8])('even n=%i structure', (n) => {
    const teams = ids(n);
    const res = roundRobin(teams);
    expect(res.format).toBe('round_robin');
    expect(res.legs).toBe(1);
    expect(res.team_count).toBe(n);
    expect(res.round_count).toBe(n - 1);
    expect(res.rounds).toHaveLength(n - 1);
    const pairs = new Set();
    for (const r of res.rounds) {
      expect(r.matches).toHaveLength(n / 2);
      expect(r.byes).toEqual([]);
      const seen = new Set();
      for (const m of r.matches) {
        expect(seen.has(m.home) || seen.has(m.away)).toBe(false);
        seen.add(m.home);
        seen.add(m.away);
        pairs.add([m.home, m.away].sort().join('|'));
        expect(m.status).toBe('scheduled');
        expect(m.awarded_to).toBeNull();
      }
      expect(seen.size).toBe(n);
    }
    expect(pairs.size).toBe((n * (n - 1)) / 2);
    expect(res.summary).toEqual({ total: (n * (n - 1)) / 2, scheduled: (n * (n - 1)) / 2, forfeit: 0, voided: 0 });
  });

  test.each([3, 5, 7])('odd n=%i has one bye per team per leg', (n) => {
    const teams = ids(n);
    const res = roundRobin(teams);
    expect(res.round_count).toBe(n);
    const byes = [];
    for (const r of res.rounds) {
      expect(r.matches).toHaveLength((n - 1) / 2);
      expect(r.byes).toHaveLength(1);
      byes.push(r.byes[0]);
      const playing = new Set(r.matches.flatMap((m) => [m.home, m.away]));
      expect(playing.has(r.byes[0])).toBe(false);
      expect(playing.size).toBe(n - 1);
    }
    expect([...byes].sort()).toEqual([...teams].sort());
  });

  test('match id format and the spec example summary', () => {
    const res = roundRobin(ids(5), { withdrawals: [{ team_id: 't3', after_round: 2 }] });
    expect(res.rounds[0].matches[0].match_id).toBe('RR-L1-R1-M1');
    expect(res.summary.total).toBe(10);
    expect(res.summary.forfeit).toBe(2);
    expect(res.summary.scheduled).toBe(8);
  });

  test('legs 2 gives every ordered pair once, with global round numbers', () => {
    const teams = ids(6);
    const res = roundRobin(teams, { legs: 2 });
    expect(res.legs).toBe(2);
    expect(res.round_count).toBe(10);
    expect(res.rounds.map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const ordered = new Set(flat(res).map((m) => `${m.home}>${m.away}`));
    expect(ordered.size).toBe(30);
    for (const a of teams) for (const b of teams) if (a !== b) expect(ordered.has(`${a}>${b}`)).toBe(true);
    expect(res.rounds[5].matches[0].match_id).toMatch(/^RR-L2-R6-M1$/);
    expect(res.rounds[5].matches[0].leg).toBe(2);
  });

  test('legs 2 with odd n', () => {
    const res = roundRobin(ids(5), { legs: 2 });
    expect(res.round_count).toBe(10);
    expect(new Set(flat(res).map((m) => `${m.home}>${m.away}`)).size).toBe(20);
  });

  test.each([4, 5, 6, 7, 8, 9])('home/away balance within each leg n=%i', (n) => {
    const teams = ids(n);
    const res = roundRobin(teams, { legs: 2 });
    for (const leg of [1, 2]) {
      const bal = Object.fromEntries(teams.map((t) => [t, 0]));
      for (const m of flat(res).filter((x) => x.leg === leg)) {
        bal[m.home] += 1;
        bal[m.away] -= 1;
      }
      for (const t of teams) expect(Math.abs(bal[t])).toBeLessThanOrEqual(1);
    }
  });

  test('circleLeg is reusable directly', () => {
    const rounds = circleLeg(ids(4));
    expect(rounds).toHaveLength(3);
    expect(rounds[0].bye).toBeNull();
  });

  test('forfeit_remaining: later fixtures forfeited, earlier stay scheduled', () => {
    const res = roundRobin(ids(6), { withdrawals: [{ team_id: 't2', after_round: 2 }] });
    for (const r of res.rounds) {
      for (const m of r.matches) {
        const involved = m.home === 't2' || m.away === 't2';
        if (involved && r.round > 2) {
          expect(m.status).toBe('forfeit');
          expect(m.awarded_to).toBe(m.home === 't2' ? m.away : m.home);
        } else {
          expect(m.status).toBe('scheduled');
          expect(m.awarded_to).toBeNull();
        }
      }
    }
    expect(res.summary.forfeit).toBe(3);
    expect(res.summary.total).toBe(15);
  });

  test('forfeit_remaining after_round 0 never plays and is the default policy', () => {
    const res = roundRobin(ids(4), { withdrawals: [{ team_id: 't1', after_round: 0 }] });
    expect(res.summary.forfeit).toBe(3);
  });

  test('void_all voids every fixture of the withdrawn team, any round', () => {
    const res = roundRobin(ids(6), {
      withdrawal_policy: 'void_all',
      withdrawals: [{ team_id: 't2', after_round: 4 }],
    });
    for (const m of flat(res)) {
      if (m.home === 't2' || m.away === 't2') {
        expect(m.status).toBe('voided');
        expect(m.awarded_to).toBeNull();
      } else expect(m.status).toBe('scheduled');
    }
    expect(res.summary).toEqual({ total: 15, scheduled: 10, forfeit: 0, voided: 5 });
  });

  test('both teams withdrawn voids the fixture even under forfeit_remaining', () => {
    const res = roundRobin(ids(4), {
      withdrawals: [
        { team_id: 't1', after_round: 0 },
        { team_id: 't2', after_round: 0 },
      ],
    });
    const m = flat(res).find((x) => [x.home, x.away].sort().join() === 't1,t2');
    expect(m.status).toBe('voided');
    expect(m.awarded_to).toBeNull();
    expect(res.summary.voided).toBe(1);
    expect(res.summary.forfeit).toBe(4);
    expect(res.summary.total).toBe(6);
  });

  test('both withdrawn with different cutoffs, fixtures are never removed', () => {
    const res = roundRobin(ids(4), {
      legs: 2,
      withdrawals: [
        { team_id: 't1', after_round: 1 },
        { team_id: 't2', after_round: 5 },
      ],
    });
    expect(res.summary.total).toBe(12);
    expect(flat(res)).toHaveLength(12);
  });

  test('duplicate withdrawal entries keep the earliest after_round', () => {
    const a = roundRobin(ids(4), {
      withdrawals: [
        { team_id: 't1', after_round: 2 },
        { team_id: 't1', after_round: 1 },
      ],
    });
    const b = roundRobin(ids(4), { withdrawals: [{ team_id: 't1', after_round: 1 }] });
    expect(a.summary).toEqual(b.summary);
  });

  test('null and missing params are accepted', () => {
    const res = roundRobin(ids(4), { legs: null, withdrawal_policy: null, withdrawals: null });
    expect(res.legs).toBe(1);
    expect(roundRobin(ids(2)).round_count).toBe(1);
  });

  test.each([
    [{ legs: 3 }],
    [{ legs: '2' }],
    [{ legs: 1.5 }],
    [{ withdrawal_policy: 'nope' }],
    [{ withdrawals: 'x' }],
    [{ withdrawals: ['x'] }],
    [{ withdrawals: [{ team_id: 'zzz', after_round: 1 }] }],
    [{ withdrawals: [{ team_id: 't1', after_round: -1 }] }],
    [{ withdrawals: [{ team_id: 't1', after_round: 4 }] }],
    [{ withdrawals: [{ team_id: 't1', after_round: 1.5 }] }],
    [{ withdrawals: [{ team_id: 5, after_round: 1 }] }],
  ])('validation error for %j', (params) => {
    const err = expectValidation(() => roundRobin(ids(4), params));
    expect(err.details.fields.length).toBeGreaterThan(0);
  });

  test('after_round bound depends on legs', () => {
    expect(() => roundRobin(ids(4), { legs: 2, withdrawals: [{ team_id: 't1', after_round: 6 }] })).not.toThrow();
    expectValidation(() => roundRobin(ids(4), { legs: 2, withdrawals: [{ team_id: 't1', after_round: 7 }] }));
  });
});

describe('swiss', () => {
  test('round 1 exact pairing, even n', () => {
    const res = swiss(ids(6), {});
    expect(res.format).toBe('swiss');
    expect(res.round).toBe(1);
    expect(res.total_rounds).toBe(3);
    expect(res.pairings).toEqual([
      { match_id: 'SW-R1-M1', home: 't1', away: 't4' },
      { match_id: 'SW-R1-M2', home: 't2', away: 't5' },
      { match_id: 'SW-R1-M3', home: 't3', away: 't6' },
    ]);
    expect(res.bye).toBeNull();
    expect(res.standings.map((s) => s.team_id)).toEqual(ids(6));
    expect(res.standings[0]).toEqual({ rank: 1, team_id: 't1', score: 0, buchholz: 0 });
  });

  test('round 1 exact pairing, odd n gives last seed the bye', () => {
    const res = swiss(ids(5), { total_rounds: 3 });
    expect(res.pairings.map((p) => [p.home, p.away])).toEqual([
      ['t1', 't3'],
      ['t2', 't4'],
    ]);
    expect(res.bye).toBe('t5');
    expect(res.total_rounds).toBe(3);
  });

  test('spec round 2 example with 5 teams', () => {
    const history = [
      {
        round: 1,
        bye: 't5',
        matches: [
          { home: 't1', away: 't3', result: 'home' },
          { home: 't2', away: 't4', result: 'draw' },
        ],
      },
    ];
    const res = swiss(ids(5), { total_rounds: 3, round: 2, history });
    expect(res.round).toBe(2);
    expect(res.standings.slice(0, 3)).toEqual([
      { rank: 1, team_id: 't1', score: 1, buchholz: 0 },
      { rank: 2, team_id: 't5', score: 1, buchholz: 0 },
      { rank: 3, team_id: 't2', score: 0.5, buchholz: 0.5 },
    ]);
    // t3 (score 0) is the lowest scoring team without a bye.
    expect(res.bye).toBe('t3');
    const used = res.pairings.flatMap((p) => [p.home, p.away]);
    expect(new Set(used).size).toBe(4);
    expect(used).not.toContain('t3');
  });

  // brute-force minimal cost over rematch-free perfect matchings
  function bruteMin(verts, score, met) {
    if (!verts.length) return 0;
    const [a, ...rest] = verts;
    let best = Infinity;
    rest.forEach((b, i) => {
      if (met.has(`${a}|${b}`) || met.has(`${b}|${a}`)) return;
      const c = Math.abs(score[a] - score[b]) + bruteMin(rest.filter((_, k) => k !== i), score, met);
      if (c < best) best = c;
    });
    return best;
  }

  test('round 2 properties for 8 teams: no rematch, minimal score difference', () => {
    const teams = ids(8);
    const r1 = swiss(teams, {});
    const results = ['home', 'away', 'draw', 'home'];
    const history = [
      { round: 1, bye: null, matches: r1.pairings.map((p, i) => ({ home: p.home, away: p.away, result: results[i] })) },
    ];
    const r2 = swiss(teams, { round: 2, history });
    const score = Object.fromEntries(r2.standings.map((s) => [s.team_id, s.score]));
    const met = new Set(history[0].matches.map((m) => `${m.home}|${m.away}`));
    const used = r2.pairings.flatMap((p) => [p.home, p.away]);
    expect(new Set(used).size).toBe(8);
    for (const p of r2.pairings) {
      expect(met.has(`${p.home}|${p.away}`) || met.has(`${p.away}|${p.home}`)).toBe(false);
    }
    const cost = r2.pairings.reduce((s, p) => s + Math.abs(score[p.home] - score[p.away]), 0);
    expect(cost).toBe(bruteMin(teams, score, met));
    expect(r2.bye).toBeNull();
    // home is the better-ranked team
    const rank = Object.fromEntries(r2.standings.map((s) => [s.team_id, s.rank]));
    for (const p of r2.pairings) expect(rank[p.home]).toBeLessThan(rank[p.away]);
  });

  test('round 3 with 6 teams after two random-ish rounds is rematch-free and optimal', () => {
    const teams = ids(6);
    const history = [];
    const met = new Set();
    const outcomes = ['home', 'draw', 'away'];
    let c = 0;
    for (let round = 1; round <= 2; round++) {
      const res = swiss(teams, { round, history, total_rounds: 5 });
      const matches = res.pairings.map((p) => {
        met.add(`${p.home}|${p.away}`);
        return { home: p.home, away: p.away, result: outcomes[c++ % 3] };
      });
      history.push({ round, bye: res.bye, matches });
    }
    const r3 = swiss(teams, { round: 3, history, total_rounds: 5 });
    const score = Object.fromEntries(r3.standings.map((s) => [s.team_id, s.score]));
    for (const p of r3.pairings) {
      expect(met.has(`${p.home}|${p.away}`) || met.has(`${p.away}|${p.home}`)).toBe(false);
    }
    const cost = r3.pairings.reduce((s, p) => s + Math.abs(score[p.home] - score[p.away]), 0);
    expect(cost).toBe(bruteMin(teams, score, met));
  });

  test('bye goes to lowest-scoring team without a prior bye (tie -> largest index)', () => {
    const teams = ids(5);
    const history = [
      {
        round: 1,
        bye: 't5',
        matches: [
          { home: 't1', away: 't3', result: 'draw' },
          { home: 't2', away: 't4', result: 'draw' },
        ],
      },
    ];
    const res = swiss(teams, { total_rounds: 3, round: 2, history });
    // t1..t4 all have 0.5; t5 has 1 and already had a bye; tie -> largest index = t4.
    expect(res.bye).toBe('t4');
  });

  test('computeStandings tracks bye history', () => {
    // n=3, total_rounds up to 2, so craft history with extra bye flags on round 1 and 2 plus round 3 pairing
    const teams = ids(3);
    const st = computeStandings(teams, [
      { round: 1, bye: 't1', matches: [{ home: 't2', away: 't3', result: 'away' }] },
      { round: 2, bye: 't2', matches: [] },
      { round: 3, bye: 't3', matches: [] },
    ]);
    expect(st.hadBye).toEqual([true, true, true]);
    expect(st.standings[0].team_id).toBeDefined();
  });

  test('NO_VALID_PAIRING 409 with details.round', () => {
    const teams = ids(4);
    const history = [
      {
        round: 1,
        bye: null,
        matches: [
          { home: 't1', away: 't2', result: 'home' },
          { home: 't3', away: 't4', result: 'home' },
        ],
      },
      {
        round: 2,
        bye: null,
        matches: [
          { home: 't1', away: 't3', result: 'home' },
          { home: 't2', away: 't4', result: 'home' },
          { home: 't1', away: 't4', result: 'draw' },
        ],
      },
    ];
    let err;
    try {
      swiss(teams, { total_rounds: 3, round: 3, history });
    } catch (e) {
      err = e;
    }
    expect(err.status).toBe(409);
    expect(err.code).toBe('NO_VALID_PAIRING');
    expect(err.details).toEqual({ round: 3 });
  });

  test('NO_VALID_PAIRING with odd n tries every bye candidate', () => {
    const teams = ids(3);
    const history = [
      {
        round: 1,
        bye: null,
        matches: [
          { home: 't1', away: 't2', result: 'home' },
          { home: 't1', away: 't3', result: 'home' },
          { home: 't2', away: 't3', result: 'home' },
        ],
      },
    ];
    expect(() => swiss(teams, { total_rounds: 2, round: 2, history })).toThrow(
      expect.objectContaining({ code: 'NO_VALID_PAIRING' }),
    );
  });

  test('buchholz sums opponents scores, bye contributes 0', () => {
    const st = computeStandings(ids(3), [
      { round: 1, bye: 't3', matches: [{ home: 't1', away: 't2', result: 'home' }] },
    ]);
    const by = Object.fromEntries(st.standings.map((s) => [s.team_id, s]));
    expect(by.t1).toMatchObject({ score: 1, buchholz: 0 });
    expect(by.t3).toMatchObject({ score: 1, buchholz: 0 });
    expect(by.t2).toMatchObject({ score: 0, buchholz: 1 });
    expect(st.standings.map((s) => s.team_id)).toEqual(['t1', 't3', 't2']);
  });

  test('away win scoring', () => {
    const st = computeStandings(ids(2), [{ round: 1, matches: [{ home: 't1', away: 't2', result: 'away' }] }]);
    expect(st.standings[0].team_id).toBe('t2');
    expect(st.pts).toEqual([0, 2]);
  });

  test('defaults and null params', () => {
    const res = swiss(ids(2));
    expect(res.total_rounds).toBe(1);
    const res2 = swiss(ids(4), { total_rounds: null, round: null, history: null });
    expect(res2.total_rounds).toBe(2);
  });

  test.each([
    [{ total_rounds: 0 }],
    [{ total_rounds: 4 }],
    [{ total_rounds: 1.5 }],
    [{ round: 0 }],
    [{ round: 'a' }],
    [{ round: 3 }],
    [{ total_rounds: 3, round: 2, history: 'x' }],
    [{ total_rounds: 3, round: 2, history: [] }],
    [{ total_rounds: 3, round: 2, history: [{ round: 2, matches: [] }] }],
    [{ total_rounds: 3, round: 3, history: [{ round: 1, matches: [] }, { round: 1, matches: [] }] }],
    [{ total_rounds: 3, round: 2, history: ['x'] }],
    [{ total_rounds: 3, round: 2, history: [{ round: 1, bye: 'zz', matches: [] }] }],
    [{ total_rounds: 3, round: 2, history: [{ round: 1, bye: 5, matches: [] }] }],
    [{ total_rounds: 3, round: 2, history: [{ round: 1 }] }],
    [{ total_rounds: 3, round: 2, history: [{ round: 1, matches: ['x'] }] }],
    [{ total_rounds: 3, round: 2, history: [{ round: 1, matches: [{ home: 'zz', away: 't2', result: 'home' }] }] }],
    [{ total_rounds: 3, round: 2, history: [{ round: 1, matches: [{ home: 't1', away: 't1', result: 'home' }] }] }],
    [{ total_rounds: 3, round: 2, history: [{ round: 1, matches: [{ home: 't1', away: 't2', result: 'win' }] }] }],
  ])('validation error for %j', (params) => {
    expectValidation(() => swiss(ids(4), params));
  });
});

describe('single elimination', () => {
  test('seed order', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketSize(1)).toBe(1);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(8)).toBe(8);
  });

  test('n=6 exact spec example', () => {
    const res = singleElim(ids(6), {});
    expect(res.format).toBe('single_elim');
    expect(res.bracket_size).toBe(8);
    expect(res.rounds.map((r) => r.matches.length)).toEqual([4, 2, 1]);
    const [m1, m2, m3, m4] = res.rounds[0].matches;
    expect(m1).toMatchObject({ match_id: 'R1M1', home: 't1', away: null, home_seed: 1, away_seed: null, bye: true, winner: 't1', loser: null });
    expect(m2).toMatchObject({ match_id: 'R1M2', home: 't4', away: 't5', home_seed: 4, away_seed: 5, bye: false, winner: null });
    expect(m3).toMatchObject({ match_id: 'R1M3', home: 't2', away: null, bye: true, winner: 't2' });
    expect(m4).toMatchObject({ match_id: 'R1M4', home: 't3', away: 't6', bye: false });
    expect(m2.winner_to).toEqual({ match_id: 'R2M1', slot: 'away' });
    expect(m4.winner_to).toEqual({ match_id: 'R2M2', slot: 'away' });
    expect(m1.winner_to).toEqual({ match_id: 'R2M1', slot: 'home' });
    expect(m2).toMatchObject({ bracket: 'main', round: 1, index: 2, loser_to: null });
    // bye winners propagated immediately
    expect(res.rounds[1].matches[0].home).toBe('t1');
    expect(res.rounds[1].matches[1].home).toBe('t2');
    expect(res.rounds[1].matches[0].away).toBeNull();
    expect(res.rounds[2].matches[0].winner_to).toBeNull();
  });

  test('results propagate to later rounds and final', () => {
    const res = singleElim(ids(6), {
      results: [
        { match_id: 'R1M2', winner: 't4' },
        { match_id: 'R1M4', winner: 't6' },
        { match_id: 'R2M1', winner: 't1' },
        { match_id: 'R2M2', winner: 't6' },
        { match_id: 'R3M1', winner: 't6' },
      ],
    });
    const byId = Object.fromEntries(flat(res).map((m) => [m.match_id, m]));
    expect(byId.R1M2).toMatchObject({ winner: 't4', loser: 't5' });
    expect(byId.R2M1).toMatchObject({ home: 't1', away: 't4', winner: 't1', loser: 't4' });
    expect(byId.R2M2).toMatchObject({ home: 't2', away: 't6', winner: 't6', loser: 't2', away_seed: 6 });
    expect(byId.R3M1).toMatchObject({ home: 't1', away: 't6', winner: 't6', loser: 't1' });
  });

  test('a result for a bye match is accepted only for the present team', () => {
    expect(() => singleElim(ids(6), { results: [{ match_id: 'R1M1', winner: 't1' }] })).not.toThrow();
    expectValidation(() => singleElim(ids(6), { results: [{ match_id: 'R1M1', winner: 't2' }] }));
  });

  test('n=3 and n=2 and power of two', () => {
    expect(singleElim(ids(2), {}).rounds).toHaveLength(1);
    const r3 = singleElim(ids(3), {});
    expect(r3.bracket_size).toBe(4);
    expect(r3.rounds[0].matches[0].bye).toBe(true);
    const r8 = singleElim(ids(8), {});
    expect(flat(r8).every((m) => !m.bye)).toBe(true);
    expect(r8.rounds[0].matches.map((m) => m.home_seed + '-' + m.away_seed)).toEqual(['1-8', '4-5', '2-7', '3-6']);
  });

  test('invalid results', () => {
    expectValidation(() => singleElim(ids(6), { results: [{ match_id: 'R9M9', winner: 't1' }] }));
    expectValidation(() => singleElim(ids(6), { results: [{ match_id: 'R1M2', winner: 't1' }] }));
    expectValidation(() => singleElim(ids(6), { results: [{ match_id: 'R2M1', winner: 't1' }] }));
    expectValidation(() => singleElim(ids(6), { results: 'x' }));
    expectValidation(() => singleElim(ids(6), { results: ['x'] }));
    expectValidation(() => singleElim(ids(6), { results: [{ match_id: 'R1M2' }] }));
    expectValidation(() => singleElim(ids(6), { results: [{ match_id: 'R1M2', winner: 't4' }, { match_id: 'R1M2', winner: 't5' }] }));
    expectValidation(() => singleElim(ids(6), { third_place_match: 'yes' }));
  });

  test('duplicate identical result is accepted', () => {
    expect(() =>
      singleElim(ids(6), { results: [{ match_id: 'R1M2', winner: 't4' }, { match_id: 'R1M2', winner: 't4' }] }),
    ).not.toThrow();
  });

  test('third place match', () => {
    const res = singleElim(ids(8), {
      third_place_match: true,
      results: [
        { match_id: 'R1M1', winner: 't1' },
        { match_id: 'R1M2', winner: 't4' },
        { match_id: 'R1M3', winner: 't2' },
        { match_id: 'R1M4', winner: 't3' },
        { match_id: 'R2M1', winner: 't1' },
        { match_id: 'R2M2', winner: 't3' },
      ],
    });
    const sf = res.rounds[1].matches;
    const tp = res.rounds[2].matches.find((m) => m.match_id === 'TP');
    expect(tp).toBeDefined();
    expect(tp.bracket).toBe('third_place');
    expect(sf[0].loser_to).toEqual({ match_id: 'TP', slot: 'home' });
    expect(sf[1].loser_to).toEqual({ match_id: 'TP', slot: 'away' });
    expect(tp).toMatchObject({ home: 't4', away: 't2' });
    expect(tp.winner_to).toBeNull();
    const done = singleElim(ids(8), {
      third_place_match: true,
      results: [
        { match_id: 'R1M1', winner: 't1' }, { match_id: 'R1M2', winner: 't4' },
        { match_id: 'R1M3', winner: 't2' }, { match_id: 'R1M4', winner: 't3' },
        { match_id: 'R2M1', winner: 't1' }, { match_id: 'R2M2', winner: 't3' },
        { match_id: 'TP', winner: 't2' },
      ],
    });
    expect(done.rounds[2].matches.find((m) => m.match_id === 'TP')).toMatchObject({ winner: 't2', loser: 't4' });
  });

  test('third place not added for a two team bracket', () => {
    const res = singleElim(ids(2), { third_place_match: true });
    expect(flat(res).map((m) => m.match_id)).toEqual(['R1M1']);
  });

  test('parseBool and parseResults helpers', () => {
    expect(parseBool({}, 'x', true)).toBe(true);
    expect(parseBool({ x: null }, 'x', false)).toBe(false);
    expect(parseBool({ x: true }, 'x', false)).toBe(true);
    expect(parseResults(undefined, new Set()).size).toBe(0);
    expect(parseResults(null, new Set()).size).toBe(0);
  });
});

describe('double elimination', () => {
  const byIdOf = (res) =>
    Object.fromEntries(
      [...res.winners, ...res.losers].flatMap((r) => r.matches).concat(res.grand_final).map((m) => [m.match_id, m]),
    );

  test('counts for 8 teams', () => {
    const res = doubleElim(ids(8), { bracket_reset: true });
    expect(res.format).toBe('double_elim');
    expect(res.bracket_size).toBe(8);
    expect(res.bracket_reset).toBe(true);
    expect(res.winners.map((r) => r.matches.length)).toEqual([4, 2, 1]);
    expect(res.winners.flatMap((r) => r.matches)).toHaveLength(7);
    expect(res.losers.map((r) => r.matches.length)).toEqual([2, 2, 1, 1]);
    expect(res.losers.flatMap((r) => r.matches)).toHaveLength(6);
    expect(res.grand_final.map((m) => m.match_id)).toEqual(['GF1', 'GF2']);
  });

  test.each([3, 4, 5, 8, 12, 16, 33])('B-2 losers matches for n=%i', (n) => {
    const res = doubleElim(ids(n), {});
    const B = bracketSize(n);
    expect(res.losers.flatMap((r) => r.matches)).toHaveLength(B - 2);
    expect(res.losers).toHaveLength(2 * (Math.log2(B) - 1));
    expect(res.grand_final).toHaveLength(1);
  });

  test('routing graph: every slot except WR1 is fed exactly once', () => {
    const res = doubleElim(ids(8), { bracket_reset: true });
    const all = byIdOf(res);
    const feeds = {};
    for (const m of Object.values(all)) {
      for (const t of [m.winner_to, m.loser_to]) {
        if (t) feeds[`${t.match_id}.${t.slot}`] = (feeds[`${t.match_id}.${t.slot}`] || 0) + 1;
      }
      if (m.bracket === 'winners') expect(m.loser_to).not.toBeNull();
      if (m.bracket === 'losers') expect(m.loser_to).toBeNull();
      if (m.match_id !== 'GF2') expect(m.winner_to).not.toBeNull();
    }
    for (const m of Object.values(all)) {
      if (m.round === 1 && m.bracket === 'winners') continue;
      for (const slot of ['home', 'away']) {
        if (m.match_id === 'GF2') continue;
        expect(feeds[`${m.match_id}.${slot}`]).toBe(1);
      }
    }
    expect(all.WR3M1.winner_to).toEqual({ match_id: 'GF1', slot: 'home' });
    expect(all.LR4M1.winner_to).toEqual({ match_id: 'GF1', slot: 'away' });
    expect(all.WR3M1.loser_to).toEqual({ match_id: 'LR4M1', slot: 'away' });
  });

  test('without reset GF1 has no winner_to and there is no GF2', () => {
    const res = doubleElim(ids(4), {});
    expect(res.bracket_reset).toBe(false);
    expect(res.grand_final).toHaveLength(1);
    expect(res.grand_final[0]).toMatchObject({ conditional: false, required: true, winner_to: null });
  });

  test('GF2 conditional and required null until GF1 played', () => {
    const res = doubleElim(ids(4), { bracket_reset: true });
    const [gf1, gf2] = res.grand_final;
    expect(gf1).toMatchObject({ conditional: false });
    expect(gf2).toMatchObject({ conditional: true, required: null, match_id: 'GF2' });
  });

  // 4 teams: WR1M1 t1-t4, WR1M2 t2-t3
  const playToGF = (extra) => [
    { match_id: 'WR1M1', winner: 't1' },
    { match_id: 'WR1M2', winner: 't2' },
    { match_id: 'WR2M1', winner: 't1' }, // t2 drops to LR2M1
    { match_id: 'LR1M1', winner: 't4' }, // t4 beats t3
    { match_id: 'LR2M1', winner: 't2' }, // t2 beats t4
    ...extra,
  ];

  test('results propagate through the bracket', () => {
    const res = doubleElim(ids(4), { bracket_reset: true, results: playToGF([]) });
    const all = byIdOf(res);
    expect(all.WR1M1).toMatchObject({ winner: 't1', loser: 't4' });
    expect(all.LR1M1).toMatchObject({ home: 't4', away: 't3', winner: 't4', loser: 't3' });
    expect(all.LR2M1).toMatchObject({ home: 't4', away: 't2', winner: 't2' });
    expect(all.GF1).toMatchObject({ home: 't1', away: 't2', winner: null });
    expect(all.GF2.required).toBeNull();
  });

  test('GF2 required true when losers champion wins GF1', () => {
    const res = doubleElim(ids(4), { bracket_reset: true, results: playToGF([{ match_id: 'GF1', winner: 't2' }]) });
    const [gf1, gf2] = res.grand_final;
    expect(gf1).toMatchObject({ winner: 't2', loser: 't1' });
    expect(gf2.required).toBe(true);
    expect(gf2).toMatchObject({ conditional: true, home: 't1', away: 't2' });
  });

  test('GF2 required false when winners champion wins GF1', () => {
    const res = doubleElim(ids(4), { bracket_reset: true, results: playToGF([{ match_id: 'GF1', winner: 't1' }]) });
    expect(res.grand_final[1].required).toBe(false);
    expect(res.grand_final[1]).toMatchObject({ home: 't1', away: 't2', winner: null });
  });

  test('result for GF2 is rejected when not required, accepted when required', () => {
    expectValidation(() =>
      doubleElim(ids(4), {
        bracket_reset: true,
        results: playToGF([{ match_id: 'GF1', winner: 't1' }, { match_id: 'GF2', winner: 't1' }]),
      }),
    );
    const ok = doubleElim(ids(4), {
      bracket_reset: true,
      results: playToGF([{ match_id: 'GF1', winner: 't2' }, { match_id: 'GF2', winner: 't1' }]),
    });
    expect(ok.grand_final[1]).toMatchObject({ winner: 't1', loser: 't2', required: true });
  });

  test('without bracket_reset GF1 result leaves a single final', () => {
    const res = doubleElim(ids(4), { results: playToGF([{ match_id: 'GF1', winner: 't2' }]) });
    expect(res.grand_final).toHaveLength(1);
    expect(res.grand_final[0].winner).toBe('t2');
  });

  test('non power of two field: WR1 byes handled', () => {
    const res = doubleElim(ids(5), {});
    const wr1 = res.winners[0].matches;
    expect(wr1.filter((m) => m.bye)).toHaveLength(3);
    expect(res.winners[1].matches[0].home).toBe('t1');
    const res6 = doubleElim(ids(3), {});
    expect(res6.winners[0].matches[0].bye).toBe(true);
  });

  test('invalid results and flags', () => {
    expectValidation(() => doubleElim(ids(4), { results: [{ match_id: 'XX', winner: 't1' }] }));
    expectValidation(() => doubleElim(ids(4), { results: [{ match_id: 'WR1M1', winner: 't2' }] }));
    expectValidation(() => doubleElim(ids(4), { bracket_reset: 'true' }));
  });
});

describe('generateFixtures dispatcher', () => {
  test('exposes format limits', () => {
    expect(FORMATS.round_robin).toMatchObject({ min: 2, max: 40 });
    expect(FORMATS.swiss).toMatchObject({ min: 2, max: 64 });
    expect(FORMATS.single_elim).toMatchObject({ min: 2, max: 128 });
    expect(FORMATS.double_elim).toMatchObject({ min: 3, max: 128 });
  });

  test('dispatches each format', () => {
    expect(generateFixtures({ format: 'round_robin', teams: ids(4) }).format).toBe('round_robin');
    expect(generateFixtures({ format: 'swiss', teams: ids(4), params: null }).format).toBe('swiss');
    expect(generateFixtures({ format: 'single_elim', teams: ids(4), params: {} }).format).toBe('single_elim');
    expect(generateFixtures({ format: 'double_elim', teams: ids(4) }).format).toBe('double_elim');
  });

  test('does not mutate the input teams', () => {
    const teams = ids(4);
    generateFixtures({ format: 'single_elim', teams });
    expect(teams).toEqual(ids(4));
  });

  test('validation errors', () => {
    const fields = (b) => expectValidation(() => generateFixtures(b)).details.fields;
    expect(fields(null)).toEqual(['body']);
    expect(fields([])).toEqual(['body']);
    expect(fields({ format: 'nope', teams: ids(4) })).toEqual(['format']);
    expect(fields({ format: 'constructor', teams: ids(4) })).toEqual(['format']);
    expect(fields({ teams: ids(4) })).toEqual(['format']);
    expect(fields({ format: 'swiss', teams: 'x' })).toEqual(['teams']);
    expect(fields({ format: 'swiss', teams: ['a', 'a'] })).toEqual(['teams']);
    expect(fields({ format: 'swiss', teams: ['a', ''] })).toEqual(['teams']);
    expect(fields({ format: 'swiss', teams: [1, 2] })).toEqual(['teams']);
    expect(fields({ format: 'swiss', teams: ['a'] })).toEqual(['teams']);
    expect(fields({ format: 'round_robin', teams: ids(41) })).toEqual(['teams']);
    expect(fields({ format: 'swiss', teams: ids(65) })).toEqual(['teams']);
    expect(fields({ format: 'single_elim', teams: ids(129) })).toEqual(['teams']);
    expect(fields({ format: 'double_elim', teams: ids(2) })).toEqual(['teams']);
    expect(fields({ format: 'double_elim', teams: ids(129) })).toEqual(['teams']);
    expect(fields({ format: 'swiss', teams: ids(4), params: 'x' })).toEqual(['params']);
    expect(fields({ format: 'bad', teams: 'x', params: 5 })).toEqual(['format', 'teams', 'params']);
  });

  test('limits are inclusive', () => {
    expect(generateFixtures({ format: 'round_robin', teams: ids(40) }).team_count).toBe(40);
    expect(generateFixtures({ format: 'swiss', teams: ids(64) }).pairings).toHaveLength(32);
    expect(generateFixtures({ format: 'single_elim', teams: ids(128) }).bracket_size).toBe(128);
    expect(generateFixtures({ format: 'double_elim', teams: ids(3) }).bracket_size).toBe(4);
  });
});

describe('matching helpers', () => {
  test('maxMatching on path, triangle plus tail (blossom) and empty graph', () => {
    expect(maxMatching(0, [])).toBe(0);
    expect(maxMatching(4, [[1], [0, 2], [1, 3], [2]])).toBe(2);
    // triangle 0-1-2 with pendant 3 on 2 and pendant 4 on 3: needs augmenting through a blossom
    const adj = [[1, 2], [0, 2], [0, 1, 3], [2, 4], [3]];
    expect(maxMatching(5, adj)).toBe(2);
    // blossom requiring augmentation: 5-cycle with tail
    const adj2 = [[1, 4], [0, 2], [1, 3], [2, 4, 5], [3, 0], [3]];
    expect(maxMatching(6, adj2)).toBe(3);
    // single edge missing: no match
    expect(maxMatching(3, [[], [], []])).toBe(0);
  });

  test('maxMatching handles a graph where greedy start is suboptimal', () => {
    // path 0-1, 1-2, 2-3 where greedy picks (0,1) then (2,3): fine; star-ish: 1-0, 1-2, 1-3, 2-4
    const adj = [[1], [0, 2, 3], [1, 4], [1], [2]];
    expect(maxMatching(5, adj)).toBe(2);
    // greedy picks 1-2 first, optimum 0-1, 2-3 (path of 4 in the order 1,2 first)
    const adj3 = [[1], [0, 2], [1, 3], [2]];
    expect(maxMatching(4, adj3)).toBe(2);
    // odd cycle of 7 with chords to force blossom contractions
    const n = 7;
    const adj7 = Array.from({ length: n }, (_, i) => [(i + 1) % n, (i + n - 1) % n]);
    expect(maxMatching(n, adj7)).toBe(3);
    // two triangles joined by an edge
    const tri = [[1, 2], [0, 2], [0, 1, 3], [2, 4, 5], [3, 5], [3, 4]];
    expect(maxMatching(6, tri)).toBe(3);
  });

  test('hasPerfect', () => {
    const all4 = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => i !== j));
    expect(hasPerfect([], all4)).toBe(true);
    expect(hasPerfect([0, 1, 2], all4)).toBe(false);
    expect(hasPerfect([0, 1, 2, 3], all4)).toBe(true);
    const star = [
      [false, true, true, true],
      [true, false, false, false],
      [true, false, false, false],
      [true, false, false, false],
    ];
    expect(hasPerfect([0, 1, 2, 3], star)).toBe(false);
  });

  test('minCostPerfect picks the minimum |dw| pairing', () => {
    const w = [4, 3, 1, 0];
    const allowed = w.map((_, i) => w.map((_, j) => i !== j));
    const res = minCostPerfect(w, allowed);
    expect(res.cost).toBe(2);
    expect(res.pairs).toEqual([[0, 1], [2, 3]]);
  });

  test('minCostPerfect honours forbidden pairs and branches', () => {
    const w = [4, 3, 1, 0];
    const allowed = w.map((_, i) => w.map((_, j) => i !== j));
    allowed[0][1] = false;
    allowed[1][0] = false;
    const res = minCostPerfect(w, allowed);
    // remaining options: (0,2)+(1,3)=3+3=6 ; (0,3)+(1,2)=4+2=6
    expect(res.cost).toBe(6);
  });

  test('minCostPerfect needs backtracking when the cheapest local choice is infeasible', () => {
    const w = [3, 3, 2, 0, 0, 0];
    const allowed = w.map((_, i) => w.map((_, j) => i !== j));
    const forbid = (a, b) => {
      allowed[a][b] = false;
      allowed[b][a] = false;
    };
    forbid(0, 1);
    forbid(0, 2);
    const res = minCostPerfect(w, allowed);
    const total = res.pairs.reduce((s, [a, b]) => s + Math.abs(w[a] - w[b]), 0);
    expect(total).toBe(res.cost);
    expect(res.pairs).toHaveLength(3);
    // brute force
    let best = Infinity;
    const rec = (free, c) => {
      if (!free.length) return void (best = Math.min(best, c));
      const [a, ...rest] = free;
      rest.forEach((b, i) => allowed[a][b] && rec(rest.filter((_, k) => k !== i), c + Math.abs(w[a] - w[b])));
    };
    rec([0, 1, 2, 3, 4, 5], 0);
    expect(res.cost).toBe(best);
  });

  test('minCostPerfect returns null when impossible', () => {
    expect(minCostPerfect([1, 1, 1], [[false, true, true], [true, false, true], [true, true, false]])).toBeNull();
    const none = [[false, false], [false, false]];
    expect(minCostPerfect([1, 0], none)).toBeNull();
  });

  test('minCostPerfect on the empty set', () => {
    expect(minCostPerfect([], [])).toEqual({ cost: 0, pairs: [] });
  });
});
