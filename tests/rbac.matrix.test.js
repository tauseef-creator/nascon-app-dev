'use strict';
// Spec 5.13 expected matrix, row by row, against the pure policy (FR-5.1 negative tests).
const { authorize, tenantScope, ACTIONS, ROLES, MATRIX } = require('../backend/src/domain/rbac');
const S = require('../backend/src/db/seedData');

// Principals exactly as the demo users of 8.3 (and the JWT claims) describe them.
const P = {};
for (const u of S.USERS) {
  P[u.role] = {
    role: u.role, tenant_id: u.tenant_id || null, league_id: u.league_id || null,
    club_id: u.club_id || null, player_id: u.player_id || null,
  };
}

const league = (id) => { const l = S.LEAGUES.find((x) => x.league_id === id); return { tenant_id: l.tenant_id, league_id: l.league_id }; };
const club = (id) => { const c = S.CLUBS.find((x) => x.club_id === id); return { tenant_id: c.tenant_id, club_id: c.club_id }; };
const player = (id) => { const p = S.PLAYERS.find((x) => x.player_id === id); return { tenant_id: p.tenant_id, club_id: p.club_id, player_id: p.player_id }; };

const ORDER = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'];
// [label, action, target, expected per role in ORDER] (A = true, D = false)
const ROWS = [
  ['P1', ACTIONS.TENANT_CREATE, {}, 'ADDDD'],
  ['P2 own league', ACTIONS.LEAGUE_FIXTURES_WRITE, league('league-alpha-1'), 'AADDD'],
  ['P2 other league', ACTIONS.LEAGUE_FIXTURES_WRITE, league('league-alpha-2'), 'ADDDD'],
  ['P2 foreign league', ACTIONS.LEAGUE_FIXTURES_WRITE, league('league-beta-1'), 'ADDDD'],
  ['P3 own club', ACTIONS.CLUB_ROSTER_WRITE, club('club-alpha-1'), 'ADADD'],
  ['P3 other club', ACTIONS.CLUB_ROSTER_WRITE, club('club-alpha-2'), 'ADDDD'],
  ['P3 foreign club', ACTIONS.CLUB_ROSTER_WRITE, club('club-beta-1'), 'ADDDD'],
  ['P4 own club', ACTIONS.CLUB_PRODUCTS_WRITE, club('club-alpha-1'), 'ADADD'],
  ['P4 other club', ACTIONS.CLUB_PRODUCTS_WRITE, club('club-alpha-2'), 'ADDDD'],
  ['P4 foreign club', ACTIONS.CLUB_PRODUCTS_WRITE, club('club-beta-1'), 'ADDDD'],
  ['P5 own player', ACTIONS.PLAYER_UPDATE, player('player-alpha-1'), 'ADAAD'],
  ['P5 other player', ACTIONS.PLAYER_UPDATE, player('player-alpha-2'), 'ADDDD'],
  ['P5 foreign player', ACTIONS.PLAYER_UPDATE, player('player-beta-1'), 'ADDDD'],
  ['P6 own club', ACTIONS.CLUB_READ, club('club-alpha-1'), 'AAAAA'],
  ['P6 other club', ACTIONS.CLUB_READ, club('club-alpha-2'), 'AAAAA'],
  ['P6 foreign club', ACTIONS.CLUB_READ, club('club-beta-1'), 'ADDDD'],
  ['P7', ACTIONS.PLATFORM_CONFIG_READ, {}, 'ADDDD'],
];

describe('RBAC expected matrix (spec 5.13)', () => {
  const cases = [];
  for (const [label, action, target, expected] of ROWS) {
    ORDER.forEach((role, i) => cases.push([label, role, action, target, expected[i] === 'A']));
  }
  test.each(cases)('%s as %s', (label, role, action, target, allowed) => {
    expect(authorize(P[role], action, target)).toBe(allowed);
  });

  test('every role in the matrix is a known role', () => {
    expect(ROLES).toEqual(ORDER);
    for (const rules of Object.values(MATRIX)) for (const r of Object.keys(rules)) expect(ROLES).toContain(r);
  });
});

describe('RBAC boundaries and default deny', () => {
  test('unknown action, role, or malformed principal is denied', () => {
    expect(authorize(P.super_admin, 'does.not.exist', {})).toBe(false);
    expect(authorize(P.super_admin, 'toString', {})).toBe(false);
    expect(authorize({ ...P.viewer, role: 'hacker' }, ACTIONS.CLUB_READ, club('club-alpha-1'))).toBe(false);
    expect(authorize({ ...P.viewer, role: 'constructor' }, ACTIONS.CLUB_READ, club('club-alpha-1'))).toBe(false);
    expect(authorize(null, ACTIONS.CLUB_READ, club('club-alpha-1'))).toBe(false);
    expect(authorize([], ACTIONS.CLUB_READ, club('club-alpha-1'))).toBe(false);
    expect(authorize('super_admin', ACTIONS.TENANT_CREATE, {})).toBe(false);
  });

  test('role without a rule for the action is denied (viewer cannot write)', () => {
    expect(authorize(P.viewer, ACTIONS.PLAYER_UPDATE, player('player-alpha-1'))).toBe(false);
  });

  test('missing or non-object target never grants scoped access', () => {
    expect(authorize(P.viewer, ACTIONS.CLUB_READ, null)).toBe(false);
    expect(authorize(P.club_manager, ACTIONS.CLUB_ROSTER_WRITE, undefined)).toBe(false);
    expect(authorize(P.super_admin, ACTIONS.CLUB_READ, null)).toBe(true);
  });

  test('tenant isolation is absolute even when the scoped id matches', () => {
    const forged = { tenant_id: 'tenant-beta', league_id: 'league-alpha-1' };
    expect(authorize(P.league_organizer, ACTIONS.LEAGUE_FIXTURES_WRITE, forged)).toBe(false);
    expect(authorize(P.club_manager, ACTIONS.CLUB_ROSTER_WRITE, { tenant_id: 'tenant-beta', club_id: 'club-alpha-1' })).toBe(false);
    expect(authorize(P.player, ACTIONS.PLAYER_UPDATE, { tenant_id: 'tenant-beta', club_id: 'club-alpha-1', player_id: 'player-alpha-1' })).toBe(false);
  });

  test('null scope ids on both sides do not match each other', () => {
    const noTenant = { role: 'viewer', tenant_id: null };
    expect(authorize(noTenant, ACTIONS.CLUB_READ, { tenant_id: null })).toBe(false);
    const noLeague = { role: 'league_organizer', tenant_id: 'tenant-alpha', league_id: null };
    expect(authorize(noLeague, ACTIONS.LEAGUE_FIXTURES_WRITE, { tenant_id: 'tenant-alpha', league_id: null })).toBe(false);
    expect(authorize({ ...P.league_organizer, league_id: '' }, ACTIONS.LEAGUE_FIXTURES_WRITE, { tenant_id: 'tenant-alpha', league_id: '' })).toBe(false);
  });

  test('club manager may update players of the own club only', () => {
    const newcomer = { tenant_id: 'tenant-alpha', club_id: 'club-alpha-1', player_id: 'player-new' };
    expect(authorize(P.club_manager, ACTIONS.PLAYER_UPDATE, newcomer)).toBe(true);
    expect(authorize(P.player, ACTIONS.PLAYER_UPDATE, newcomer)).toBe(false);
  });

  test('league and tenant reads are tenant-scoped', () => {
    for (const role of ORDER) {
      expect(authorize(P[role], ACTIONS.LEAGUE_READ, league('league-alpha-2'))).toBe(true);
      expect(authorize(P[role], ACTIONS.TENANT_READ, { tenant_id: 'tenant-alpha' })).toBe(true);
      expect(authorize(P[role], ACTIONS.LEAGUE_READ, league('league-beta-1'))).toBe(role === 'super_admin');
      expect(authorize(P[role], ACTIONS.TENANT_READ, { tenant_id: 'tenant-beta' })).toBe(role === 'super_admin');
    }
  });
});

describe('tenantScope', () => {
  test('super admin is platform wide, others are tenant bound, invalid has no scope', () => {
    expect(tenantScope(P.super_admin)).toBeNull();
    expect(tenantScope(P.viewer)).toBe('tenant-alpha');
    expect(tenantScope({ role: 'viewer', tenant_id: null })).toBeUndefined();
    expect(tenantScope({ role: 'nobody', tenant_id: 'tenant-alpha' })).toBeUndefined();
    expect(tenantScope(null)).toBeUndefined();
  });
});
