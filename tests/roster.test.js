'use strict';
const R = require('../backend/src/domain/roster');

const LEAGUE = {
  league_id: 'lg-r1', tenant_id: 'tenant-alpha', sport_id: 'football',
  transfer_window: { open: '2026-09-01', close: '2026-09-30' }, max_squad_size: 3, required_positions: { gk: 1 },
};

function setupBody(extra = {}) {
  return {
    league: { ...LEAGUE },
    squads: [
      { squad_id: 'sq-a', club_id: 'club-a', tenant_id: 'tenant-alpha', name: 'A' },
      { squad_id: 'sq-b', club_id: 'club-b', tenant_id: 'tenant-alpha', name: 'B' },
    ],
    players: [
      { player_id: 'p1', name: 'Ali', position: 'gk', squad_id: 'sq-a', role: 'captain' },
      { player_id: 'p2', name: 'Bilal', position: 'df', squad_id: 'sq-a', role: 'starter' },
    ],
    matches_in_progress: [{ match_id: 'm-live', home_squad_id: 'sq-a', away_squad_id: 'sq-b' }],
    ...extra,
  };
}

function reg(player_id, squad_id, position, extra = {}) {
  return {
    player_id, league_id: 'lg-r1', name: player_id, position, squad_id, parent_squad_id: null,
    registration_type: 'initial', start_date: null, loan_end_date: null, role: 'starter', ...extra,
  };
}

function state(over = {}) {
  return {
    league: R.resolveLeagueConfig(LEAGUE, null),
    squads: {
      'sq-a': { squad_id: 'sq-a', tenant_id: 'tenant-alpha' },
      'sq-b': { squad_id: 'sq-b', tenant_id: 'tenant-alpha' },
      'sq-x': { squad_id: 'sq-x', tenant_id: 'tenant-beta' },
    },
    registrations: [reg('p1', 'sq-a', 'gk', { role: 'captain' }), reg('p2', 'sq-a', 'df')],
    matches: [],
    ...over,
  };
}

const TR = {
  request_id: 'tr-001', league_id: 'lg-r1', player_id: 'p2', type: 'transfer',
  from_squad_id: 'sq-a', to_squad_id: 'sq-b', effective_date: '2026-09-30',
  loan_end_date: null, reason: 'Tactical move', requested_by: 'user-77',
};
const req = (over = {}) => R.normalizeTransfer({ ...TR, ...over });
const code = (r) => (r.error ? r.error.code : 'OK');

describe('roster: validateSetup', () => {
  test('valid spec example', () => {
    expect(R.validateSetup(setupBody())).toEqual([]);
  });
  test('non-object body', () => {
    expect(R.validateSetup(null)).toEqual(['body']);
    expect(R.validateSetup([])).toEqual(['body']);
  });
  test('missing league and squads', () => {
    expect(R.validateSetup({})).toEqual(['league', 'squads']);
  });
  test('bad league fields', () => {
    const bad = R.validateSetup(setupBody({
      league: { league_id: 'bad id', tenant_id: 5, sport_id: 'x|y', transfer_window: { open: '2026-13-01', close: 'x' },
        max_squad_size: -1, required_positions: { gk: 'one' } },
    }));
    expect(bad).toEqual(['league.league_id', 'league.tenant_id', 'league.sport_id',
      'league.transfer_window.open', 'league.transfer_window.close', 'league.max_squad_size',
      'league.required_positions.gk']);
  });
  test('window open after close, non-object window and positions', () => {
    expect(R.validateSetup(setupBody({ league: { ...LEAGUE, transfer_window: { open: '2026-10-01', close: '2026-09-01' } } })))
      .toEqual(['league.transfer_window']);
    expect(R.validateSetup(setupBody({ league: { ...LEAGUE, transfer_window: 'x', required_positions: [] } })))
      .toEqual(['league.transfer_window', 'league.required_positions']);
  });
  test('optional league fields may be omitted', () => {
    expect(R.validateSetup(setupBody({ league: { league_id: 'l', tenant_id: 't' } }))).toEqual([]);
  });
  test('bad squads', () => {
    expect(R.validateSetup(setupBody({ squads: 'x' }))).toEqual(['squads']);
    expect(R.validateSetup(setupBody({
      squads: [5, { squad_id: 'a', tenant_id: 't', club_id: 'c c', name: 3 }, { squad_id: 'a', tenant_id: null }],
      players: [], matches_in_progress: [],
    }))).toEqual(['squads[0]', 'squads[1].club_id', 'squads[1].name', 'squads[2].squad_id', 'squads[2].tenant_id']);
  });
  test('bad players', () => {
    expect(R.validateSetup(setupBody({ players: {} }))).toEqual(['players']);
    expect(R.validateSetup(setupBody({
      players: [null, { player_id: 'p1', name: 1, position: '', squad_id: '!', role: 'boss' }, { player_id: 'p1', position: 'gk' }],
    }))).toEqual(['players[0]', 'players[1].name', 'players[1].position', 'players[1].squad_id',
      'players[1].role', 'players[2].player_id']);
    expect(R.validateSetup(setupBody({ players: [{ player_id: 'x y', position: 'gk' }] }))).toEqual(['players[0].player_id']);
  });
  test('bad matches', () => {
    expect(R.validateSetup(setupBody({ matches_in_progress: 1 }))).toEqual(['matches_in_progress']);
    expect(R.validateSetup(setupBody({ matches_in_progress: ['m', { match_id: '', home_squad_id: 1, away_squad_id: 2 }] })))
      .toEqual(['matches_in_progress[0]', 'matches_in_progress[1].match_id',
        'matches_in_progress[1].home_squad_id', 'matches_in_progress[1].away_squad_id']);
  });
  test('players and matches are optional', () => {
    expect(R.validateSetup(setupBody({ players: undefined, matches_in_progress: null }))).toEqual([]);
  });
  test('unknownSetupSquads finds undeclared squad references once', () => {
    expect(R.unknownSetupSquads(setupBody())).toEqual([]);
    const b = setupBody({
      players: [{ player_id: 'p1', position: 'gk', squad_id: 'sq-z' }, { player_id: 'p2', position: 'gk', squad_id: 'sq-z' },
        { player_id: 'p3', position: 'gk', squad_id: null }],
      matches_in_progress: [{ match_id: 'm', home_squad_id: 'sq-a', away_squad_id: 'sq-q' }],
    });
    expect(R.unknownSetupSquads(b)).toEqual(['sq-z', 'sq-q']);
    expect(R.unknownSetupSquads({ squads: [] })).toEqual([]);
  });
});

describe('roster: setup projection', () => {
  test('resolveLeagueConfig uses league values first', () => {
    const c = R.resolveLeagueConfig(LEAGUE, { roster: { max_squad_size: 25, required_positions: { gk: 2 } } });
    expect(c).toEqual({ league_id: 'lg-r1', tenant_id: 'tenant-alpha', sport_id: 'football',
      transfer_window: LEAGUE.transfer_window, max_squad_size: 3, required_positions: { gk: 1 } });
  });
  test('resolveLeagueConfig falls back to sport roster config, then to no limit', () => {
    const lg = { league_id: 'l', tenant_id: 't' };
    expect(R.resolveLeagueConfig(lg, { roster: { max_squad_size: 25, required_positions: { gk: 1 } } }))
      .toMatchObject({ sport_id: null, transfer_window: null, max_squad_size: 25, required_positions: { gk: 1 } });
    expect(R.resolveLeagueConfig(lg, {})).toMatchObject({ max_squad_size: null, required_positions: {} });
    expect(R.resolveLeagueConfig(lg, null)).toMatchObject({ max_squad_size: null, required_positions: {} });
    expect(R.resolveLeagueConfig({ ...lg, required_positions: null }, { roster: { required_positions: [] } }))
      .toMatchObject({ required_positions: {} });
  });
  test('needsSportDefaults', () => {
    expect(R.needsSportDefaults(LEAGUE)).toBe(false);
    expect(R.needsSportDefaults({ max_squad_size: 3 })).toBe(true);
    expect(R.needsSportDefaults({ required_positions: {} })).toBe(true);
  });
  test('buildSetup response matches the spec example', () => {
    const b = setupBody();
    const built = R.buildSetup(b, R.resolveLeagueConfig(b.league, null));
    expect(built.response).toEqual({ league_id: 'lg-r1', status: 'configured', squad_counts: { 'sq-a': 2, 'sq-b': 0 } });
    expect(built.config.initial).toEqual({ p1: 'sq-a', p2: 'sq-a' });
    expect(built.config.matches_in_progress).toEqual([{ match_id: 'm-live', home_squad_id: 'sq-a', away_squad_id: 'sq-b' }]);
    expect(built.squads[0]).toEqual({ squad_id: 'sq-a', league_id: 'lg-r1', club_id: 'club-a', tenant_id: 'tenant-alpha', name: 'A' });
    expect(built.registrations[0]).toMatchObject({ player_id: 'p1', role: 'captain', squad_id: 'sq-a' });
  });
  test('buildSetup defaults and free agents', () => {
    const b = { league: { league_id: 'l', tenant_id: 't' }, squads: [{ squad_id: 's', tenant_id: 't' }],
      players: [{ player_id: 'p', position: 'df' }] };
    const built = R.buildSetup(b, R.resolveLeagueConfig(b.league, null));
    expect(built.response.squad_counts).toEqual({ s: 0 });
    expect(built.registrations[0]).toMatchObject({ name: null, squad_id: null, role: 'substitute' });
    expect(built.squads[0]).toMatchObject({ club_id: null, name: null });
    expect(built.matches).toEqual([]);
  });
  test('buildSetup normalizes missing match squads', () => {
    const b = setupBody({ players: undefined, matches_in_progress: [{ match_id: 'm' }] });
    expect(R.buildSetup(b, R.resolveLeagueConfig(b.league, null)).matches)
      .toEqual([{ match_id: 'm', home_squad_id: null, away_squad_id: null }]);
  });
});

describe('roster: validateTransfer (check 1)', () => {
  test('valid transfer, loan and release', () => {
    expect(R.validateTransfer(TR)).toEqual([]);
    expect(R.validateTransfer({ ...TR, type: 'loan', loan_end_date: '2026-12-31' })).toEqual([]);
    expect(R.validateTransfer({ ...TR, type: 'release', to_squad_id: null })).toEqual([]);
    expect(R.validateTransfer({ ...TR, type: 'release', to_squad_id: undefined, reason: undefined, requested_by: null })).toEqual([]);
  });
  test('non-object body', () => {
    expect(R.validateTransfer('x')).toEqual(['body']);
  });
  test('all missing', () => {
    expect(R.validateTransfer({})).toEqual(['request_id', 'league_id', 'player_id', 'type', 'from_squad_id',
      'to_squad_id', 'effective_date']);
  });
  test('bad ids, type and dates', () => {
    expect(R.validateTransfer({ ...TR, request_id: "x' OR 1=1", type: 'swap', effective_date: '2026-02-30' }))
      .toEqual(['request_id', 'type', 'effective_date']);
  });
  test('to_squad_id required unless release', () => {
    expect(R.validateTransfer({ ...TR, to_squad_id: null })).toEqual(['to_squad_id']);
    expect(R.validateTransfer({ ...TR, type: 'release', to_squad_id: 'bad id' })).toEqual(['to_squad_id']);
  });
  test('loan_end_date required and after effective_date for loan', () => {
    expect(R.validateTransfer({ ...TR, type: 'loan' })).toEqual(['loan_end_date']);
    expect(R.validateTransfer({ ...TR, type: 'loan', loan_end_date: '2026-09-30' })).toEqual(['loan_end_date']);
    expect(R.validateTransfer({ ...TR, type: 'loan', loan_end_date: '2026-09-29' })).toEqual(['loan_end_date']);
    expect(R.validateTransfer({ ...TR, type: 'loan', loan_end_date: '2026-10-01', effective_date: 'x' }))
      .toEqual(['effective_date']);
  });
  test('loan_end_date on non-loan must be a date or null', () => {
    expect(R.validateTransfer({ ...TR, loan_end_date: 'soon' })).toEqual(['loan_end_date']);
    expect(R.validateTransfer({ ...TR, loan_end_date: '2026-12-01' })).toEqual([]);
  });
  test('reason and requested_by must be strings', () => {
    expect(R.validateTransfer({ ...TR, reason: 1, requested_by: {} })).toEqual(['reason', 'requested_by']);
  });
  test('normalizeTransfer', () => {
    expect(R.normalizeTransfer({ ...TR, extra: 1 })).toEqual(TR);
    expect(R.normalizeTransfer({ ...TR, type: 'release', to_squad_id: 'sq-b', loan_end_date: '2026-12-01',
      reason: undefined, requested_by: undefined }))
      .toEqual({ ...TR, type: 'release', to_squad_id: null, loan_end_date: null, reason: null, requested_by: null });
    expect(R.normalizeTransfer({ ...TR, type: 'loan', loan_end_date: '2026-12-01' }).loan_end_date).toBe('2026-12-01');
  });
});

describe('roster: evaluateTransfer checks in order', () => {
  test('accepted transfer matches the spec example', () => {
    const r = R.evaluateTransfer(state(), req());
    expect(r.error).toBeUndefined();
    expect(r.state).toBe('active');
    expect(r.blocking_match_id).toBeNull();
    expect(r.registration).toEqual({ player_id: 'p2', league_id: 'lg-r1', squad_id: 'sq-b', parent_squad_id: null,
      registration_type: 'transfer', start_date: '2026-09-30', loan_end_date: null, role: 'substitute' });
    expect(r.entry).toEqual({ audit_id: null, action: 'transfer', player_id: 'p2', league_id: 'lg-r1',
      from_squad_id: 'sq-a', to_squad_id: 'sq-b', effective_date: '2026-09-30', state: 'active',
      who: 'user-77', when: null, why: 'Tactical move' });
    expect(r.returns).toEqual([]);
    expect(r.vacated_role).toBeNull();
    const entry = { ...r.entry, audit_id: 'au-0001', when: '2026-09-30T08:12:44Z' };
    expect(R.transferResponse('tr-001', r, entry)).toEqual({
      request_id: 'tr-001', status: 'accepted', state: 'active', blocking_match_id: null,
      registration: r.registration, audit_entry: entry,
    });
  });
  test('2) LEAGUE_NOT_FOUND', () => {
    const r = R.evaluateTransfer(state({ league: null }), req());
    expect(r.error).toMatchObject({ status: 404, code: 'LEAGUE_NOT_FOUND', details: { league_id: 'lg-r1' } });
  });
  test('2) PLAYER_NOT_FOUND', () => {
    expect(R.evaluateTransfer(state(), req({ player_id: 'ghost' })).error)
      .toMatchObject({ status: 404, code: 'PLAYER_NOT_FOUND' });
    expect(code(R.evaluateTransfer(state({ registrations: undefined }), req()))).toBe('PLAYER_NOT_FOUND');
  });
  test('2) SQUAD_NOT_FOUND for from and to', () => {
    expect(R.evaluateTransfer(state(), req({ from_squad_id: 'sq-z' })).error)
      .toMatchObject({ status: 404, code: 'SQUAD_NOT_FOUND', details: { squad_id: 'sq-z' } });
    expect(R.evaluateTransfer(state(), req({ to_squad_id: 'sq-z' })).error.details).toEqual({ squad_id: 'sq-z' });
    expect(code(R.evaluateTransfer(state({ squads: undefined }), req()))).toBe('SQUAD_NOT_FOUND');
  });
  test('2) 404 wins over 409 (missing squad plus window closed)', () => {
    expect(code(R.evaluateTransfer(state(), req({ to_squad_id: 'sq-z', effective_date: '2027-01-01' }))))
      .toBe('SQUAD_NOT_FOUND');
  });
  test('3) CROSS_TENANT_TRANSFER for to and from squads', () => {
    const r = R.evaluateTransfer(state(), req({ to_squad_id: 'sq-x' }));
    expect(r.error).toMatchObject({ status: 409, code: 'CROSS_TENANT_TRANSFER' });
    // from squad in another tenant is reported before NOT_IN_SQUAD
    expect(code(R.evaluateTransfer(state(), req({ from_squad_id: 'sq-x' })))).toBe('CROSS_TENANT_TRANSFER');
  });
  test('3) release only checks the from squad', () => {
    expect(code(R.evaluateTransfer(state(), req({ type: 'release', to_squad_id: 'sq-x' })))).toBe('OK');
  });
  test('4) NOT_IN_SQUAD beats window closed', () => {
    const r = R.evaluateTransfer(state(), req({ from_squad_id: 'sq-b', to_squad_id: 'sq-a', effective_date: '2027-01-01' }));
    expect(r.error).toMatchObject({ status: 409, code: 'NOT_IN_SQUAD', details: { current_squad_id: 'sq-a' } });
  });
  test('4) released player is in no squad', () => {
    const s = state({ registrations: [reg('p2', null, 'df', { registration_type: 'release' })] });
    expect(R.evaluateTransfer(s, req()).error.details.current_squad_id).toBeNull();
  });
  test('5) TRANSFER_WINDOW_CLOSED, inclusive bounds', () => {
    expect(R.evaluateTransfer(state(), req({ effective_date: '2026-10-01' })).error)
      .toMatchObject({ status: 409, code: 'TRANSFER_WINDOW_CLOSED' });
    expect(code(R.evaluateTransfer(state(), req({ effective_date: '2026-08-31' })))).toBe('TRANSFER_WINDOW_CLOSED');
    expect(code(R.evaluateTransfer(state(), req({ effective_date: '2026-09-01' })))).toBe('OK');
    expect(code(R.evaluateTransfer(state(), req({ effective_date: '2026-09-30' })))).toBe('OK');
    expect(code(R.evaluateTransfer(state(), req({ type: 'loan', effective_date: '2026-10-01', loan_end_date: '2026-12-01' }))))
      .toBe('TRANSFER_WINDOW_CLOSED');
  });
  test('5) release is allowed on any date; no window means always open', () => {
    expect(code(R.evaluateTransfer(state(), req({ type: 'release', effective_date: '2027-05-05' })))).toBe('OK');
    const s = state({ league: { ...state().league, transfer_window: null } });
    expect(code(R.evaluateTransfer(s, req({ effective_date: '2030-01-01' })))).toBe('OK');
  });
  test('6) PLAYER_ON_LOAN beats squad full and window', () => {
    const loaned = reg('p2', 'sq-b', 'df', { registration_type: 'loan', parent_squad_id: 'sq-a', loan_end_date: '2026-12-31' });
    const s = state({ registrations: [reg('p1', 'sq-a', 'gk'), loaned, reg('p3', 'sq-a', 'df'), reg('p4', 'sq-a', 'df')] });
    const r = R.evaluateTransfer(s, req({ from_squad_id: 'sq-b', to_squad_id: 'sq-a', effective_date: '2026-09-15' }));
    expect(r.error).toMatchObject({ status: 409, code: 'PLAYER_ON_LOAN', details: { parent_squad_id: 'sq-a' } });
    expect(code(R.evaluateTransfer(s, req({ type: 'release', from_squad_id: 'sq-b', to_squad_id: null, effective_date: '2026-11-01' }))))
      .toBe('PLAYER_ON_LOAN');
    // lender cannot move the player either: the player's current squad is the borrower
    expect(code(R.evaluateTransfer(s, req({ effective_date: '2026-09-15' })))).toBe('NOT_IN_SQUAD');
  });
  test('6) a loan that ended before effective_date is treated as returned', () => {
    const loaned = reg('p2', 'sq-b', 'df', { registration_type: 'loan', parent_squad_id: 'sq-a', loan_end_date: '2026-09-10' });
    const s = state({ registrations: [reg('p1', 'sq-a', 'gk'), loaned] });
    const r = R.evaluateTransfer(s, req({ effective_date: '2026-09-11' }));
    expect(code(r)).toBe('OK');
    expect(r.returns).toHaveLength(1);
    expect(r.returns[0].entry).toMatchObject({ action: 'loan_return', from_squad_id: 'sq-b', to_squad_id: 'sq-a',
      effective_date: '2026-09-11', who: 'system' });
    // on the last loan day the player is still on loan
    expect(code(R.evaluateTransfer(s, req({ from_squad_id: 'sq-b', to_squad_id: 'sq-a', effective_date: '2026-09-10' }))))
      .toBe('PLAYER_ON_LOAN');
  });
  test('7) SQUAD_FULL counts loaned-in players and ignores loaned-out ones', () => {
    const regs = [reg('p1', 'sq-a', 'gk'), reg('p2', 'sq-a', 'df'),
      reg('b1', 'sq-b', 'df'), reg('b2', 'sq-b', 'df'),
      reg('l1', 'sq-b', 'df', { registration_type: 'loan', parent_squad_id: 'sq-a', loan_end_date: '2026-12-31' })];
    const r = R.evaluateTransfer(state({ registrations: regs }), req());
    expect(r.error).toMatchObject({ status: 409, code: 'SQUAD_FULL', details: { squad_id: 'sq-b', max_squad_size: 3, current_size: 3 } });
    expect(code(R.evaluateTransfer(state({ registrations: regs.slice(0, 4) }), req()))).toBe('OK');
    expect(code(R.evaluateTransfer(state({ registrations: regs }), req({ type: 'loan', loan_end_date: '2026-12-01' }))))
      .toBe('SQUAD_FULL');
  });
  test('7) SQUAD_FULL beats MIN_POSITION_VIOLATION; release skips size', () => {
    const regs = [reg('p1', 'sq-a', 'gk'), reg('b1', 'sq-b', 'df'), reg('b2', 'sq-b', 'df'), reg('b3', 'sq-b', 'df')];
    expect(code(R.evaluateTransfer(state({ registrations: regs }), req({ player_id: 'p1' })))).toBe('SQUAD_FULL');
    expect(code(R.evaluateTransfer(state({ registrations: regs }), req({ player_id: 'p1', type: 'release' }))))
      .toBe('MIN_POSITION_VIOLATION');
  });
  test('7) no max_squad_size means unlimited', () => {
    const regs = [reg('p2', 'sq-a', 'df'), reg('b1', 'sq-b', 'df'), reg('b2', 'sq-b', 'df'), reg('b3', 'sq-b', 'df')];
    const s = state({ registrations: regs, league: { ...state().league, max_squad_size: null } });
    expect(code(R.evaluateTransfer(s, req()))).toBe('OK');
  });
  test('8) MIN_POSITION_VIOLATION for transfer, loan and release', () => {
    const r = R.evaluateTransfer(state(), req({ player_id: 'p1' }));
    expect(r.error).toMatchObject({ status: 409, code: 'MIN_POSITION_VIOLATION',
      details: { squad_id: 'sq-a', position: 'gk', required: 1, remaining: 0 } });
    expect(code(R.evaluateTransfer(state(), req({ player_id: 'p1', type: 'loan', loan_end_date: '2026-12-01' }))))
      .toBe('MIN_POSITION_VIOLATION');
    const two = state({ registrations: [reg('p1', 'sq-a', 'gk'), reg('g2', 'sq-a', 'gk')] });
    expect(code(R.evaluateTransfer(two, req({ player_id: 'p1' })))).toBe('OK');
  });
  test('8) positions without a requirement are free; missing required_positions', () => {
    const s = state({ league: { ...state().league, required_positions: undefined } });
    expect(code(R.evaluateTransfer(s, req({ player_id: 'p1' })))).toBe('OK');
  });
  test('edge case 6: in-progress match defers but accepts (last window day)', () => {
    const s = state({ matches: [{ match_id: 'm-other', home_squad_id: 'sq-c', away_squad_id: 'sq-d' },
      { match_id: 'm-live', home_squad_id: 'sq-b', away_squad_id: 'sq-a' }] });
    const r = R.evaluateTransfer(s, req({ effective_date: '2026-09-30' }));
    expect(r.state).toBe('deferred_until_match_end');
    expect(r.blocking_match_id).toBe('m-live');
    expect(r.entry.state).toBe('deferred_until_match_end');
    expect(R.transferResponse('tr-001', r, r.entry)).toMatchObject({ state: 'deferred_until_match_end', blocking_match_id: 'm-live' });
    // home squad also blocks
    const s2 = state({ matches: [{ match_id: 'm1', home_squad_id: 'sq-a', away_squad_id: 'sq-b' }] });
    expect(R.evaluateTransfer(s2, req()).blocking_match_id).toBe('m1');
    // a match not involving the from squad does not block
    expect(R.evaluateTransfer(state({ matches: undefined }), req()).state).toBe('active');
  });
  test('loan effects: borrower, parent and end date', () => {
    const r = R.evaluateTransfer(state(), req({ type: 'loan', effective_date: '2026-09-10', loan_end_date: '2026-12-31' }));
    expect(r.registration).toEqual({ player_id: 'p2', league_id: 'lg-r1', squad_id: 'sq-b', parent_squad_id: 'sq-a',
      registration_type: 'loan', start_date: '2026-09-10', loan_end_date: '2026-12-31', role: 'substitute' });
    expect(r.row).toMatchObject({ position: 'df', squad_id: 'sq-b', parent_squad_id: 'sq-a' });
    expect(r.entry.action).toBe('loan');
  });
  test('release effects: no registration, row leaves the league', () => {
    const r = R.evaluateTransfer(state(), req({ type: 'release', to_squad_id: null, reason: null }));
    expect(r.registration).toBeNull();
    expect(r.row).toMatchObject({ squad_id: null, parent_squad_id: null, registration_type: 'release', role: null });
    expect(r.entry).toMatchObject({ action: 'release', to_squad_id: null, why: null });
    expect(R.transferResponse('rl', r, r.entry).registration).toBeNull();
  });
  test('captain leaving vacates the role', () => {
    const s = state({ registrations: [reg('p1', 'sq-a', 'gk', { role: 'captain' }), reg('g2', 'sq-a', 'gk')] });
    expect(R.evaluateTransfer(s, req({ player_id: 'p1' })).vacated_role).toBe('captain');
    const s2 = state({ registrations: [reg('p2', 'sq-a', 'df', { role: 'vice_captain' })] });
    const r = R.evaluateTransfer(s2, req());
    expect(r.vacated_role).toBe('vice_captain');
    expect(r.registration.role).toBe('substitute');
  });
});

describe('roster: loan auto-return and history', () => {
  const loaned = reg('p2', 'sq-b', 'df', { registration_type: 'loan', parent_squad_id: 'sq-a',
    start_date: '2026-09-10', loan_end_date: '2027-01-01', role: 'substitute' });

  test('addDays and auditId', () => {
    expect(R.addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(R.addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(R.auditId(1)).toBe('au-0001');
    expect(R.auditId(12345)).toBe('au-12345');
  });
  test('no return on or before loan_end_date', () => {
    expect(R.computeLoanReturns([loaned], '2027-01-01')).toEqual([]);
    expect(R.computeLoanReturns([loaned], '2026-10-01')).toEqual([]);
  });
  test('return on the day after loan_end_date', () => {
    const [ret] = R.computeLoanReturns([loaned, reg('p1', 'sq-a', 'gk')], '2027-01-02');
    expect(ret.lender).toBe('sq-a');
    expect(ret.borrower).toBe('sq-b');
    expect(ret.return_date).toBe('2027-01-02');
    expect(ret.registration).toMatchObject({ squad_id: 'sq-a', parent_squad_id: null, role: 'substitute',
      loan_end_date: null, start_date: '2027-01-02', position: 'df' });
    expect(ret.entry).toEqual({ audit_id: null, action: 'loan_return', player_id: 'p2', league_id: 'lg-r1',
      from_squad_id: 'sq-b', to_squad_id: 'sq-a', effective_date: '2027-01-02', state: 'active',
      who: 'system', when: null, why: 'Loan ended' });
  });
  test('returned registration produces no second return (written once)', () => {
    const [ret] = R.computeLoanReturns([loaned], '2027-01-05');
    expect(R.computeLoanReturns([ret.registration], '2027-01-05')).toEqual([]);
    expect(R.computeLoanReturns([{ ...loaned, loan_end_date: null }], '2027-01-05')).toEqual([]);
  });
  test('applyReturns only replaces expired loans', () => {
    const out = R.applyReturns([loaned, reg('p1', 'sq-a', 'gk')], '2027-02-01');
    expect(out.returns).toHaveLength(1);
    expect(out.registrations.map((r) => r.squad_id)).toEqual(['sq-a', 'sq-a']);
  });
  test('squadOnDate replays entries effective on or before as_of', () => {
    const entries = [
      { action: 'loan', from_squad_id: 'sq-a', to_squad_id: 'sq-b', effective_date: '2026-09-10' },
      { action: 'loan_return', from_squad_id: 'sq-b', to_squad_id: 'sq-a', effective_date: '2027-01-02' },
      { action: 'release', from_squad_id: 'sq-a', to_squad_id: null, effective_date: '2027-03-01' },
    ];
    expect(R.squadOnDate('sq-a', entries, '2026-09-01')).toEqual({ current_squad_id: 'sq-a', parent_squad_id: null });
    expect(R.squadOnDate('sq-a', entries, '2026-09-10')).toEqual({ current_squad_id: 'sq-b', parent_squad_id: 'sq-a' });
    expect(R.squadOnDate('sq-a', entries, '2027-01-05')).toEqual({ current_squad_id: 'sq-a', parent_squad_id: null });
    expect(R.squadOnDate('sq-a', entries, '2027-03-01')).toEqual({ current_squad_id: null, parent_squad_id: null });
    expect(R.squadOnDate(undefined, [], '2027-03-01')).toEqual({ current_squad_id: null, parent_squad_id: null });
    expect(R.squadOnDate('sq-a', [{ action: 'loan', effective_date: '2026-01-01' }], '2026-02-01'))
      .toEqual({ current_squad_id: null, parent_squad_id: null });
  });
  test('historyResponse matches the spec shape, oldest first', () => {
    const loanEntry = R.auditEntry({ audit_id: 'au-0001', action: 'loan', player_id: 'p2', league_id: 'lg-r1',
      from_squad_id: 'sq-a', to_squad_id: 'sq-b', effective_date: '2026-09-10', who: 'user-77',
      when: '2026-09-10T08:00:00Z', why: 'Loan' });
    const [ret] = R.computeLoanReturns([loaned], '2027-01-05');
    const retEntry = { ...ret.entry, audit_id: 'au-0002', when: '2026-10-17T10:00:00Z' };
    const h = R.historyResponse('p2', '2027-01-05', 'lg-r1', 'sq-a', [loanEntry, retEntry]);
    expect(h).toEqual({ player_id: 'p2', as_of: '2027-01-05', league_id: 'lg-r1', current_squad_id: 'sq-a',
      parent_squad_id: null, history: [loanEntry, retEntry] });
    expect(Object.keys(h.history[0])).toEqual(['audit_id', 'action', 'player_id', 'league_id', 'from_squad_id',
      'to_squad_id', 'effective_date', 'state', 'who', 'when', 'why']);
  });
  test('registrationView and transferResponse normalize stored replies', () => {
    expect(R.registrationView(null)).toBeNull();
    expect(R.registrationView({ player_id: 'p', league_id: 'l', registration_type: 'transfer' })).toEqual({
      player_id: 'p', league_id: 'l', squad_id: null, parent_squad_id: null, registration_type: 'transfer',
      start_date: null, loan_end_date: null, role: null });
    expect(R.transferResponse('r', { state: 'active' }, { action: 'release', player_id: 'p', league_id: 'l',
      effective_date: '2026-01-01' })).toMatchObject({ blocking_match_id: null, registration: null,
      audit_entry: { audit_id: null, state: 'active', who: null, when: null, why: null } });
  });
});
