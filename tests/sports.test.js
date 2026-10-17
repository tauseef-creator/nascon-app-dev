'use strict';
const { validateSportConfig, validTieBreakOrder, TIE_BREAK_TOKENS } = require('../backend/src/domain/scoring');
const { SEED_SPORTS } = require('../backend/src/db/seedData');

const kabaddi = () => ({
  sport_id: 'kabaddi',
  name: 'Kabaddi',
  scoring_model: 'event',
  periods: { count: 2, duration_minutes: 20 },
  scoring_events: { raid_point: { points: 1 }, tackle_point: { points: 1 }, all_out: { points: 2 } },
  draw_allowed: false,
  overtime: { policy: 'golden_score', duration_minutes: 5 },
  tie_break_order: ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'],
  roster: { min_squad_size: 7, max_squad_size: 12, required_positions: { raider: 2, defender: 3 } },
});

const inningsSport = () => ({
  ...kabaddi(),
  sport_id: 'mini_cricket',
  scoring_model: 'innings',
  periods: { innings_per_team: 1, overs_per_innings: 10, balls_per_over: 6, wickets_per_innings: 10 },
  scoring_events: {
    super_six: { runs: 6, legal_ball: true, wicket: false },
    bye_run: { runs: 1, legal_ball: false, wicket: false },
    out: { runs: 0, legal_ball: true, wicket: true },
  },
});

const roundSport = () => ({
  ...kabaddi(),
  sport_id: 'valorant-x',
  scoring_model: 'round',
  periods: { best_of: 5 },
  scoring_events: { map_win: { rounds: 1 } },
});

describe('validateSportConfig (spec 5.6)', () => {
  test('accepts the kabaddi example and echoes the stored config', () => {
    const r = validateSportConfig({ ...kabaddi(), unknown_field: 1 });
    expect(r.ok).toBe(true);
    expect(r.fields).toEqual([]);
    expect(r.config).toEqual(kabaddi());
    expect(r.config.unknown_field).toBeUndefined();
  });

  test('accepts innings and round fragments', () => {
    expect(validateSportConfig(inningsSport()).ok).toBe(true);
    expect(validateSportConfig(roundSport()).ok).toBe(true);
  });

  test('all seed sports are valid under the same schema', () => {
    for (const s of SEED_SPORTS) expect(validateSportConfig(s).ok).toBe(true);
  });

  test('tie_break_order defaults to the full list', () => {
    const body = kabaddi();
    delete body.tie_break_order;
    const r = validateSportConfig(body);
    expect(r.config.tie_break_order).toEqual(TIE_BREAK_TOKENS);
  });

  test('overtime without duration is fine', () => {
    const r = validateSportConfig({ ...kabaddi(), overtime: { policy: 'none' } });
    expect(r.ok).toBe(true);
  });

  test('non-object body', () => {
    expect(validateSportConfig(null)).toEqual({ ok: false, fields: ['body'], config: null });
    expect(validateSportConfig([]).ok).toBe(false);
  });

  test.each([
    ['sport_id', "x'; DROP TABLE sports;--"],
    ['sport_id', 'A'],
    ['sport_id', 'Kabaddi'],
    ['sport_id', 'a'.repeat(41)],
    ['sport_id', 12],
    ['name', ''],
    ['name', 'n'.repeat(81)],
    ['name', 5],
    ['scoring_model', 'points'],
    ['draw_allowed', 'no'],
  ])('rejects bad %s = %p', (field, value) => {
    const r = validateSportConfig({ ...kabaddi(), [field]: value });
    expect(r.ok).toBe(false);
    expect(r.fields).toContain(field);
  });

  test('missing required fields are all reported', () => {
    const r = validateSportConfig({});
    expect(r.fields).toEqual(expect.arrayContaining(
      ['sport_id', 'name', 'scoring_model', 'periods', 'scoring_events', 'draw_allowed', 'overtime', 'roster']));
  });

  test('round best_of must be odd and >= 1', () => {
    for (const bo of [4, 0, -1, 2.5, '3']) {
      const r = validateSportConfig({ ...roundSport(), periods: { best_of: bo } });
      expect(r.ok).toBe(false);
      expect(r.fields).toEqual(expect.arrayContaining(['periods', 'periods.best_of', 'best_of']));
    }
    expect(validateSportConfig({ ...roundSport(), periods: { best_of: 1 } }).ok).toBe(true);
  });

  test('event periods require count and duration >= 1', () => {
    const r = validateSportConfig({ ...kabaddi(), periods: { count: 0 } });
    expect(r.fields).toEqual(expect.arrayContaining(['periods.count', 'periods.duration_minutes']));
    expect(validateSportConfig({ ...kabaddi(), periods: 3 }).fields).toContain('periods');
  });

  test('innings periods require four integers >= 1', () => {
    const r = validateSportConfig({ ...inningsSport(), periods: { innings_per_team: 1, overs_per_innings: 0, balls_per_over: 6 } });
    expect(r.fields).toEqual(expect.arrayContaining(['periods.overs_per_innings', 'periods.wickets_per_innings']));
    expect(r.fields).not.toContain('periods.innings_per_team');
  });

  test('periods only checked as object when model is invalid', () => {
    const r = validateSportConfig({ ...kabaddi(), scoring_model: 'nope', periods: {} });
    expect(r.fields).toEqual(['scoring_model']);
  });

  test('scoring_events must be a non-empty object with valid keys', () => {
    expect(validateSportConfig({ ...kabaddi(), scoring_events: {} }).fields).toContain('scoring_events');
    expect(validateSportConfig({ ...kabaddi(), scoring_events: [] }).fields).toContain('scoring_events');
    expect(validateSportConfig({ ...kabaddi(), scoring_events: { 'Bad-Key': { points: 1 } } }).fields).toContain('scoring_events');
    expect(validateSportConfig({ ...kabaddi(), scoring_events: { a: 3 } }).fields).toContain('scoring_events.a');
  });

  test('scoring event values per model', () => {
    expect(validateSportConfig({ ...kabaddi(), scoring_events: { a: { points: 0 } } }).fields)
      .toEqual(expect.arrayContaining(['scoring_events', 'scoring_events.a.points', 'points']));
    expect(validateSportConfig({ ...kabaddi(), scoring_events: { a: { rounds: 1 } } }).ok).toBe(false);
    expect(validateSportConfig({ ...roundSport(), scoring_events: { a: { rounds: 0 } } }).fields).toContain('scoring_events.a.rounds');
    const inn = validateSportConfig({ ...inningsSport(), scoring_events: { a: { runs: -1, legal_ball: 'y', wicket: 1 } } });
    expect(inn.fields).toEqual(expect.arrayContaining(['scoring_events.a.runs', 'scoring_events.a.legal_ball', 'scoring_events.a.wicket']));
    expect(validateSportConfig({ ...inningsSport(), scoring_events: { dot: { runs: 0, legal_ball: true, wicket: false } } }).ok).toBe(true);
  });

  test('overtime policy and duration', () => {
    expect(validateSportConfig({ ...kabaddi(), overtime: { policy: 'penalties' } }).fields).toContain('overtime.policy');
    expect(validateSportConfig({ ...kabaddi(), overtime: { policy: 'none', duration_minutes: -1 } }).fields)
      .toContain('overtime.duration_minutes');
    expect(validateSportConfig({ ...kabaddi(), overtime: 'none' }).fields).toContain('overtime');
    for (const policy of ['none', 'extra_time', 'shootout', 'golden_score', 'super_over']) {
      expect(validateSportConfig({ ...kabaddi(), overtime: { policy, duration_minutes: 0 } }).ok).toBe(true);
    }
  });

  test('tie_break_order tokens without repeats', () => {
    expect(validateSportConfig({ ...kabaddi(), tie_break_order: ['scored', 'scored'] }).fields).toContain('tie_break_order');
    expect(validateSportConfig({ ...kabaddi(), tie_break_order: ['goals'] }).fields).toContain('tie_break_order');
    expect(validateSportConfig({ ...kabaddi(), tie_break_order: 'scored' }).fields).toContain('tie_break_order');
    expect(validateSportConfig({ ...kabaddi(), tie_break_order: ['scored', 'h2h_points'] }).config.tie_break_order)
      .toEqual(['scored', 'h2h_points']);
    expect(validTieBreakOrder([])).toBe(true);
    expect(validTieBreakOrder([1])).toBe(false);
  });

  test('roster rules', () => {
    const r1 = validateSportConfig({ ...kabaddi(), roster: { min_squad_size: 12, max_squad_size: 7, required_positions: {} } });
    expect(r1.fields).toEqual(expect.arrayContaining(['roster', 'roster.min_squad_size', 'roster.max_squad_size']));
    const r2 = validateSportConfig({ ...kabaddi(), roster: { min_squad_size: 0, max_squad_size: 'x' } });
    expect(r2.fields).toEqual(expect.arrayContaining(['roster.min_squad_size', 'roster.max_squad_size', 'roster.required_positions']));
    const r3 = validateSportConfig({ ...kabaddi(), roster: { min_squad_size: 1, max_squad_size: 1, required_positions: { gk: -1 } } });
    expect(r3.fields).toContain('roster.required_positions.gk');
    expect(validateSportConfig({ ...kabaddi(), roster: [] }).fields).toContain('roster');
    expect(validateSportConfig({ ...kabaddi(), roster: { min_squad_size: 5, max_squad_size: 5, required_positions: {} } }).ok).toBe(true);
  });
});
