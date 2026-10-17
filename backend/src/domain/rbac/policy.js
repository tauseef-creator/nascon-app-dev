'use strict';
// Policy-as-code RBAC layer (FR-5.1, spec 5.13). Pure functions: no DB, no HTTP.
//
// principal = { role, tenant_id, league_id, club_id, player_id }
// target    = { tenant_id, league_id, club_id, player_id }
//   For a player target, club_id is the club the player belongs to.
//
// Rules (each rule is a predicate over principal and target). An action is allowed
// when the principal's role has at least one rule for it that returns true.
// Anything not listed is denied (default deny). Tenant isolation is absolute: every
// non-super-admin rule requires the target to sit inside the principal's tenant.

const ROLES = Object.freeze(['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer']);

const ACTIONS = Object.freeze({
  TENANT_CREATE: 'tenant.create', // P1
  LEAGUE_FIXTURES_WRITE: 'league.fixtures.write', // P2
  CLUB_ROSTER_WRITE: 'club.roster.write', // P3
  CLUB_PRODUCTS_WRITE: 'club.products.write', // P4
  PLAYER_UPDATE: 'player.update', // P5
  CLUB_READ: 'club.read', // P6
  PLATFORM_CONFIG_READ: 'platform.config.read', // P7
  LEAGUE_READ: 'league.read',
  TENANT_READ: 'tenant.read',
});

const present = (v) => typeof v === 'string' && v.length > 0;
const same = (a, b) => present(a) && a === b;

// Building blocks.
const anything = () => true;
const sameTenant = (p, t) => same(p.tenant_id, t.tenant_id);
const ownLeague = (p, t) => sameTenant(p, t) && same(p.league_id, t.league_id);
const ownClub = (p, t) => sameTenant(p, t) && same(p.club_id, t.club_id);
const self = (p, t) => sameTenant(p, t) && same(p.player_id, t.player_id);

// The matrix: action -> role -> rule. Missing role entry means deny.
const MATRIX = Object.freeze({
  [ACTIONS.TENANT_CREATE]: { super_admin: anything },
  [ACTIONS.LEAGUE_FIXTURES_WRITE]: { super_admin: anything, league_organizer: ownLeague },
  [ACTIONS.CLUB_ROSTER_WRITE]: { super_admin: anything, club_manager: ownClub },
  [ACTIONS.CLUB_PRODUCTS_WRITE]: { super_admin: anything, club_manager: ownClub },
  [ACTIONS.PLAYER_UPDATE]: { super_admin: anything, club_manager: ownClub, player: self },
  [ACTIONS.CLUB_READ]: {
    super_admin: anything, league_organizer: sameTenant, club_manager: sameTenant, player: sameTenant, viewer: sameTenant,
  },
  [ACTIONS.PLATFORM_CONFIG_READ]: { super_admin: anything },
  [ACTIONS.LEAGUE_READ]: {
    super_admin: anything, league_organizer: sameTenant, club_manager: sameTenant, player: sameTenant, viewer: sameTenant,
  },
  [ACTIONS.TENANT_READ]: {
    super_admin: anything, league_organizer: sameTenant, club_manager: sameTenant, player: sameTenant, viewer: sameTenant,
  },
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function authorize(principal, action, target) {
  if (!isObj(principal) || !ROLES.includes(principal.role)) return false;
  const rules = Object.prototype.hasOwnProperty.call(MATRIX, action) ? MATRIX[action] : null;
  if (!rules) return false;
  const rule = Object.prototype.hasOwnProperty.call(rules, principal.role) ? rules[principal.role] : null;
  if (!rule) return false;
  return rule(principal, isObj(target) ? target : {}) === true;
}

// Tenant scope for list queries: null = every tenant (super admin), otherwise the
// principal's own tenant id. Returns undefined when the principal has no scope at all.
function tenantScope(principal) {
  if (!isObj(principal) || !ROLES.includes(principal.role)) return undefined;
  if (principal.role === 'super_admin') return null;
  return present(principal.tenant_id) ? principal.tenant_id : undefined;
}

module.exports = { ROLES, ACTIONS, MATRIX, authorize, tenantScope };
