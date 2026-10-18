'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db/pool');
const { issueToken, requireAuth } = require('../lib/auth');
const { validation, unauthenticated, notFound, forbidden } = require('../lib/errors');
const { isObj, isStr } = require('../lib/validate');
const { authorize, tenantScope, ACTIONS } = require('../domain/rbac');

const router = express.Router();

// Rate-limit probe (5.13). The limiter is mounted in app.js for all /api/v1 routes.
router.get('/ping', (req, res) => res.status(200).json({ pong: true }));

const USER_COLS = 'user_id, email, role, tenant_id, league_id, club_id, player_id, display_name';

const publicUser = (u) => ({
  user_id: u.user_id, email: u.email, role: u.role, tenant_id: u.tenant_id,
  league_id: u.league_id, club_id: u.club_id, player_id: u.player_id, display_name: u.display_name,
});

const branding = (t) => ({
  tenant_id: t.tenant_id, name: t.name, primary_color: t.primary_color,
  secondary_color: t.secondary_color, logo_url: t.logo_url,
});

async function loadTenant(tenantId) {
  if (!tenantId) return null;
  const { rows } = await query(
    'SELECT tenant_id, name, primary_color, secondary_color, logo_url FROM tenants WHERE tenant_id = $1', [tenantId]);
  return rows.length ? branding(rows[0]) : null;
}

// Empty result set when the principal has no tenant scope at all (default deny).
function scopeClause(principal, column, params) {
  const scope = tenantScope(principal);
  if (scope === null) return '';
  if (scope === undefined) return ' WHERE FALSE';
  params.push(scope);
  return ` WHERE ${column} = $${params.length}`;
}

// POST /api/v1/auth/login {email, password}
router.post('/auth/login', async (req, res) => {
  const body = isObj(req.body) ? req.body : {};
  const bad = [];
  if (!isStr(body.email) || body.email.length === 0 || body.email.length > 254) bad.push('email');
  if (!isStr(body.password) || body.password.length === 0 || body.password.length > 128) bad.push('password');
  if (bad.length) throw validation(bad);
  const { rows } = await query(
    `SELECT ${USER_COLS}, password_hash FROM users WHERE lower(email) = lower($1)`, [body.email.trim()]);
  const user = rows[0];
  const ok = user ? await bcrypt.compare(body.password, user.password_hash) : false;
  if (!ok) throw unauthenticated('Invalid email or password.');
  res.status(200).json({ token: issueToken(user), user: publicUser(user), tenant: await loadTenant(user.tenant_id) });
});

// POST /api/v1/auth/register {email, password, display_name?, tenant_id?, guest_token?}
// Progressive registration (FR-4.4). The guest token travels in the body, never as a Bearer, so
// the global guest write guard (FR-4.3) still rejects every write made with a guest Bearer token.
router.post('/auth/register', async (req, res) => {
  // eslint-disable-next-line global-require
  const { user, cart_merge: cartMerge } = await require('../services/day2/registration').register(req.body);
  res.status(201).json({
    token: issueToken(user), user: publicUser(user), tenant: await loadTenant(user.tenant_id), cart_merge: cartMerge,
  });
});

// GET /api/v1/me
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE user_id = $1`, [req.principal.user_id]);
  if (!rows.length) throw unauthenticated('User no longer exists.');
  res.status(200).json({ user: publicUser(rows[0]), tenant: await loadTenant(rows[0].tenant_id) });
});

// GET /api/v1/clubs (tenant-scoped; super admin sees every tenant)
router.get('/clubs', requireAuth, async (req, res) => {
  const params = [];
  const where = scopeClause(req.principal, 'tenant_id', params);
  const { rows } = await query(`SELECT club_id, tenant_id, name, data FROM clubs${where} ORDER BY club_id`, params);
  res.status(200).json({
    clubs: rows.map((c) => ({
      club_id: c.club_id, tenant_id: c.tenant_id, name: c.name,
      home_venue: (c.data && c.data.home_venue) || null,
    })),
  });
});

// GET /api/v1/clubs/:club_id (club profile: info, roster, staff, home venue)
router.get('/clubs/:club_id', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT club_id, tenant_id, name, data FROM clubs WHERE club_id = $1', [req.params.club_id]);
  if (!rows.length) throw notFound('NOT_FOUND', `Club ${req.params.club_id} does not exist.`, { club_id: req.params.club_id });
  const club = rows[0];
  if (!authorize(req.principal, ACTIONS.CLUB_READ, { tenant_id: club.tenant_id, club_id: club.club_id })) throw forbidden();
  // Once a roster is configured, registrations are the source of truth. The
  // original players table is only a fallback for clubs without a roster yet.
  const roster = await query(
    'SELECT 1 FROM squads WHERE club_id = $1 AND tenant_id = $2 LIMIT 1',
    [club.club_id, club.tenant_id]);
  const players = roster.rowCount
    ? await query(
      `SELECT DISTINCT ON (r.player_id) r.player_id, r.name, r.position, r.role
         FROM registrations r JOIN squads s ON s.squad_id = r.squad_id
        WHERE s.club_id = $1 AND s.tenant_id = $2
        ORDER BY r.player_id, r.league_id`,
      [club.club_id, club.tenant_id])
    : await query(
      'SELECT player_id, name, position FROM players WHERE club_id = $1 AND tenant_id = $2 ORDER BY player_id',
      [club.club_id, club.tenant_id]);
  const data = club.data || {};
  res.status(200).json({
    club_id: club.club_id,
    tenant_id: club.tenant_id,
    name: club.name,
    home_venue: data.home_venue || null,
    social: data.social || {},
    staff: data.staff || {},
    players: players.rows,
  });
});

// GET /api/v1/leagues (tenant-scoped)
router.get('/leagues', requireAuth, async (req, res) => {
  const params = [];
  const where = scopeClause(req.principal, 'tenant_id', params);
  const { rows } = await query(`SELECT league_id, tenant_id, sport_id, name FROM leagues${where} ORDER BY league_id`, params);
  res.status(200).json({ leagues: rows });
});

// GET /api/v1/tenants/:tenant_id/branding
router.get('/tenants/:tenant_id/branding', requireAuth, async (req, res) => {
  const tenant = await loadTenant(req.params.tenant_id);
  if (!tenant) throw notFound('NOT_FOUND', `Tenant ${req.params.tenant_id} does not exist.`, { tenant_id: req.params.tenant_id });
  if (!authorize(req.principal, ACTIONS.TENANT_READ, { tenant_id: tenant.tenant_id })) throw forbidden();
  res.status(200).json(tenant);
});

// Mobile app endpoints (matches, products, sports, pins, roster view).
router.use(require('./app'));

module.exports = router;
