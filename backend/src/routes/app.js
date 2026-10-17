'use strict';
// Production endpoints used by the mobile app (mounted under /api/v1, all require a JWT).
const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../lib/auth');
const { notFound, forbidden, validation } = require('../lib/errors');
const { isId } = require('../lib/validate');
const { hub } = require('../lib/realtime');
const { tenantScope } = require('../domain/rbac');
const events = require('../services/events');
const store = require('../services/store');
const roster = require('../services/roster');

const router = express.Router();
const PIN_ROLES = ['super_admin', 'league_organizer', 'club_manager'];

// Tenant the caller may see: null = all (super admin), undefined = none.
const scopeOf = (req) => tenantScope(req.principal);

function inScope(req, tenantId) {
  const scope = scopeOf(req);
  return scope === null || (scope !== undefined && scope === tenantId);
}

async function matchSummary(row, clubNames) {
  const p = await events.getProjection(row.match_id).catch(() => null);
  return {
    match_id: row.match_id,
    league_id: row.league_id,
    sport_id: row.sport_id,
    home_team_id: row.home_team_id,
    away_team_id: row.away_team_id,
    home_name: clubNames[row.home_team_id] || row.home_team_id,
    away_name: clubNames[row.away_team_id] || row.away_team_id,
    scheduled_at: row.scheduled_at ? new Date(row.scheduled_at).toISOString().replace(/\.\d{3}Z$/, 'Z') : null,
    venue: row.venue || null,
    status: p ? p.status : 'upcoming',
    home_score: p ? p.home.score : 0,
    away_score: p ? p.away.score : 0,
    version: p ? p.version : 0,
  };
}

async function clubNameMap() {
  const { rows } = await query('SELECT club_id, name FROM clubs');
  return Object.fromEntries(rows.map((r) => [r.club_id, r.name]));
}

async function productById(productId) {
  const { rows } = await query('SELECT tenant_id FROM products WHERE product_id = $1', [productId]);
  if (!rows.length) return null;
  const list = await store.listProducts(rows[0].tenant_id);
  return list.find((p) => p.product_id === productId) || null;
}

// GET /api/v1/matches?league_id=
router.get('/matches', requireAuth, async (req, res) => {
  const leagueId = req.query.league_id;
  const params = [];
  let sql = `SELECT m.* FROM matches m LEFT JOIN leagues l ON l.league_id = m.league_id WHERE TRUE`;
  if (leagueId !== undefined) {
    if (!isId(leagueId)) throw validation(['league_id']);
    params.push(leagueId);
    sql += ` AND m.league_id = $${params.length}`;
  }
  const scope = scopeOf(req);
  if (scope === undefined) return res.json({ matches: [] });
  if (scope !== null) {
    params.push(scope);
    sql += ` AND l.tenant_id = $${params.length}`;
  }
  sql += ' ORDER BY m.scheduled_at NULLS LAST, m.match_id';
  const { rows } = await query(sql, params);
  const names = await clubNameMap();
  const matches = [];
  for (const row of rows) matches.push(await matchSummary(row, names));
  res.json({ matches });
});

// GET /api/v1/products
router.get('/products', requireAuth, async (req, res) => {
  const scope = scopeOf(req);
  if (scope === undefined) return res.json({ products: [] });
  res.json({ products: await store.listProducts(scope === null ? undefined : scope) });
});

// GET /api/v1/sports/:sport_id
router.get('/sports/:sport_id', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT sport_id, config FROM sports WHERE sport_id = $1', [req.params.sport_id]);
  if (!rows.length) throw notFound('SPORT_NOT_FOUND', 'Sport not found.', { sport_id: req.params.sport_id });
  res.json({ sport_id: rows[0].sport_id, config: rows[0].config });
});

// GET /api/v1/matches/:match_id/pinned
router.get('/matches/:match_id/pinned', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT product_id FROM pinned_products WHERE match_id = $1', [req.params.match_id]);
  const product = rows.length ? await productById(rows[0].product_id) : null;
  res.json({ product });
});

// POST /api/v1/matches/:match_id/pin {product_id}
router.post('/matches/:match_id/pin', requireAuth, async (req, res) => {
  if (!PIN_ROLES.includes(req.principal.role)) throw forbidden();
  const productId = req.body && req.body.product_id;
  if (!isId(productId)) throw validation(['product_id']);
  const m = await query('SELECT match_id FROM matches WHERE match_id = $1', [req.params.match_id]);
  if (!m.rowCount) throw notFound('MATCH_NOT_FOUND', 'Match not found.', { match_id: req.params.match_id });
  const product = await productById(productId);
  if (!product) throw notFound('NOT_FOUND', 'Product not found.', { product_id: productId });
  await query(
    `INSERT INTO pinned_products (match_id, product_id) VALUES ($1,$2)
     ON CONFLICT (match_id) DO UPDATE SET product_id = EXCLUDED.product_id`, [req.params.match_id, productId]);
  hub.emit('pinned', req.params.match_id);
  res.status(200).json({ match_id: req.params.match_id, product });
});

// GET /api/v1/roster/:club_id -> roster state for the club's squad (club manager screen)
router.get('/roster/:club_id', requireAuth, async (req, res) => {
  const club = await query('SELECT club_id, tenant_id FROM clubs WHERE club_id = $1', [req.params.club_id]);
  if (!club.rowCount) throw notFound('NOT_FOUND', 'Club not found.', { club_id: req.params.club_id });
  if (!inScope(req, club.rows[0].tenant_id)) throw forbidden();
  const sq = await query('SELECT * FROM squads WHERE club_id = $1 ORDER BY squad_id LIMIT 1', [req.params.club_id]);
  if (!sq.rowCount) return res.json({ league_id: null, squad_id: null, transfer_window: null, squads: [], players: [] });
  const { squad_id: squadId, league_id: leagueId } = sq.rows[0];
  const league = await query('SELECT config FROM roster_leagues WHERE league_id = $1', [leagueId]);
  const cfg = league.rowCount ? league.rows[0].config : {};
  const squads = await query('SELECT squad_id, club_id, name FROM squads WHERE league_id = $1 ORDER BY squad_id', [leagueId]);
  const players = await query(
    `SELECT player_id, name, position, role, squad_id, parent_squad_id, registration_type
     FROM registrations WHERE league_id = $1 AND (squad_id = $2 OR parent_squad_id = $2) ORDER BY name`,
    [leagueId, squadId]);
  res.json({
    league_id: leagueId,
    squad_id: squadId,
    transfer_window: cfg.transfer_window || null,
    squads: squads.rows,
    players: players.rows,
  });
});

// POST /api/v1/roster/:club_id/players: add one player without replacing the league roster.
router.post('/roster/:club_id/players', requireAuth, async (req, res) => {
  const out = await roster.addPlayer(req.params.club_id, req.body, req.principal);
  res.status(out.statusCode).json(out.body);
});

module.exports = router;
