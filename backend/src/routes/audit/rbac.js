'use strict';
// Spec 5.13: POST /rbac-matrix and the seven authorization probe routes (P1..P7).
// Probe order: 1) authenticate (401), 2) load the target (404 only for ids that do not
// exist at all), 3) authorize via the policy matrix (403 FORBIDDEN, cross-tenant too).
// Probes never validate or read the body and never mutate anything.
const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth, issueToken } = require('../../lib/auth');
const { notFound, forbidden } = require('../../lib/errors');
const { authorize, ACTIONS, ROLES } = require('../../domain/rbac');
const S = require('../../db/seedData');

const router = express.Router();

const CONTEXT = Object.freeze({
  tenant_id: 'tenant-alpha',
  foreign_tenant_id: 'tenant-beta',
  own_league_id: 'league-alpha-1',
  other_league_id: 'league-alpha-2',
  foreign_league_id: 'league-beta-1',
  own_club_id: 'club-alpha-1',
  other_club_id: 'club-alpha-2',
  foreign_club_id: 'club-beta-1',
  own_player_id: 'player-alpha-1',
  other_player_id: 'player-alpha-2',
  foreign_player_id: 'player-beta-1',
});

router.post('/rbac-matrix', async (req, res) => {
  const ids = S.USERS.map((u) => u.user_id);
  const { rows } = await query(
    `SELECT user_id, role, tenant_id, league_id, club_id, player_id FROM users
     WHERE user_id = ANY($1::text[])`, [ids]);
  const byRole = {};
  for (const r of rows) byRole[r.role] = r;
  const tokens = {};
  for (const role of ROLES) {
    // Fall back to the seed definition if the row is missing (should not happen after reset).
    const user = byRole[role] || S.USERS.find((u) => u.role === role);
    tokens[role] = issueToken(user);
  }
  res.status(200).json({ tokens, context: { ...CONTEXT } });
});

async function loadLeague(id) {
  const { rows } = await query('SELECT league_id, tenant_id FROM leagues WHERE league_id = $1', [id]);
  if (!rows.length) throw notFound('LEAGUE_NOT_FOUND', `League ${id} does not exist.`, { league_id: id });
  return { tenant_id: rows[0].tenant_id, league_id: rows[0].league_id };
}

// Appendix B has no club-specific code, so a missing club uses the generic NOT_FOUND.
async function loadClub(id) {
  const { rows } = await query('SELECT club_id, tenant_id FROM clubs WHERE club_id = $1', [id]);
  if (!rows.length) throw notFound('NOT_FOUND', `Club ${id} does not exist.`, { club_id: id });
  return { tenant_id: rows[0].tenant_id, club_id: rows[0].club_id };
}

async function loadPlayer(id) {
  const { rows } = await query('SELECT player_id, tenant_id, club_id FROM players WHERE player_id = $1', [id]);
  if (!rows.length) throw notFound('PLAYER_NOT_FOUND', `Player ${id} does not exist.`, { player_id: id });
  return { tenant_id: rows[0].tenant_id, club_id: rows[0].club_id, player_id: rows[0].player_id };
}

function probe(action, loadTarget) {
  return async (req, res) => {
    const target = loadTarget ? await loadTarget(req.params) : {};
    if (!authorize(req.principal, action, target)) throw forbidden();
    res.status(200).json({ authorized: true });
  };
}

router.post('/rbac/tenants', requireAuth, probe(ACTIONS.TENANT_CREATE));
router.post('/rbac/leagues/:league_id/fixtures', requireAuth,
  probe(ACTIONS.LEAGUE_FIXTURES_WRITE, (p) => loadLeague(p.league_id)));
router.post('/rbac/clubs/:club_id/roster', requireAuth,
  probe(ACTIONS.CLUB_ROSTER_WRITE, (p) => loadClub(p.club_id)));
router.post('/rbac/clubs/:club_id/products', requireAuth,
  probe(ACTIONS.CLUB_PRODUCTS_WRITE, (p) => loadClub(p.club_id)));
router.patch('/rbac/players/:player_id', requireAuth,
  probe(ACTIONS.PLAYER_UPDATE, (p) => loadPlayer(p.player_id)));
router.get('/rbac/clubs/:club_id', requireAuth,
  probe(ACTIONS.CLUB_READ, (p) => loadClub(p.club_id)));
router.get('/rbac/platform/config', requireAuth, probe(ACTIONS.PLATFORM_CONFIG_READ));

module.exports = router;
