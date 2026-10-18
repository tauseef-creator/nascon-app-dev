'use strict';
// Administrative match status (FR-1.3): postpone, reschedule, abandon, cancel.
const { query, tx } = require('../db/pool');
const { ApiError, validation, notFound, forbidden } = require('../lib/errors');
const { isStr, nowIso } = require('../lib/validate');
const { hub } = require('../lib/realtime');
const { publish } = require('../lib/queue');
const { authorize, ACTIONS } = require('../domain/rbac');
const MS = require('../domain/matchStatus');
const events = require('./events');

const iso = (d) => (d ? new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);

async function loadMatch(matchId) {
  const { rows } = await query(
    `SELECT m.match_id, m.league_id, m.scheduled_at, l.tenant_id
       FROM matches m LEFT JOIN leagues l ON l.league_id = m.league_id WHERE m.match_id = $1`, [matchId]);
  return rows[0] || null;
}

async function loadOverride(matchId, client = { query }) {
  const { rows } = await client.query('SELECT * FROM match_status WHERE match_id = $1', [matchId]);
  return rows[0] || null;
}

function view(matchId, logStatus, override, scheduledAt) {
  const status = MS.effectiveStatus(logStatus, override);
  return {
    match_id: matchId,
    status,
    log_status: logStatus,
    reason: override ? override.reason : null,
    scheduled_at: iso((override && override.scheduled_at) || scheduledAt),
    allowed_transitions: MS.allowedTargets(status),
    history: override ? override.history : [],
  };
}

async function getStatus(matchId) {
  const match = await loadMatch(matchId);
  if (!match) throw notFound('MATCH_NOT_FOUND', 'Match not found.', { match_id: matchId });
  const projection = await events.getProjection(matchId);
  return view(matchId, projection ? projection.status : 'upcoming', await loadOverride(matchId), match.scheduled_at);
}

// body = { status, reason?, scheduled_at? }; principal = verified JWT claims.
async function setStatus(matchId, body, principal) {
  const bad = [];
  if (!body || typeof body !== 'object') bad.push('body');
  else {
    if (!MS.ADMIN_TARGETS.includes(body.status)) bad.push('status');
    if (body.reason !== undefined && body.reason !== null && (!isStr(body.reason) || body.reason.length > 200)) bad.push('reason');
    if (body.scheduled_at !== undefined && body.scheduled_at !== null && Number.isNaN(Date.parse(body.scheduled_at))) bad.push('scheduled_at');
  }
  if (bad.length) throw validation(bad);

  const match = await loadMatch(matchId);
  if (!match) throw notFound('MATCH_NOT_FOUND', 'Match not found.', { match_id: matchId });
  const allowed = principal.role === 'super_admin'
    || (match.league_id && authorize(principal, ACTIONS.LEAGUE_FIXTURES_WRITE, { tenant_id: match.tenant_id, league_id: match.league_id }));
  if (!allowed) throw forbidden('Only the league organizer can change this match status.');

  const result = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`match:${matchId}`]);
    const projection = await events.getProjection(matchId, c);
    const logStatus = projection ? projection.status : 'upcoming';
    const override = await loadOverride(matchId, c);
    const current = MS.effectiveStatus(logStatus, override);
    const err = MS.checkTransition(current, body.status, { scheduledAt: body.scheduled_at });
    if (err) throw new ApiError(err.status, err.code, err.message, err.details);

    const entry = { from: current, to: body.status, reason: body.reason || null, by: principal.user_id, at: nowIso() };
    const history = [...(override ? override.history : []), entry];
    const scheduledAt = body.scheduled_at || (override && override.scheduled_at) || null;
    if (body.status === 'upcoming') {
      // Rescheduled: the event log is authoritative again; move the fixture to its new date.
      await c.query(
        `INSERT INTO match_status (match_id, status, reason, scheduled_at, updated_by, updated_at, history)
         VALUES ($1, NULL, NULL, NULL, $2, now(), $3)
         ON CONFLICT (match_id) DO UPDATE SET status = NULL, reason = NULL, scheduled_at = NULL,
           updated_by = $2, updated_at = now(), history = $3`, [matchId, principal.user_id, JSON.stringify(history)]);
      await c.query('UPDATE matches SET scheduled_at = $2 WHERE match_id = $1', [matchId, body.scheduled_at]);
    } else {
      await c.query(
        `INSERT INTO match_status (match_id, status, reason, scheduled_at, updated_by, updated_at, history)
         VALUES ($1,$2,$3,$4,$5,now(),$6)
         ON CONFLICT (match_id) DO UPDATE SET status = $2, reason = $3, scheduled_at = $4,
           updated_by = $5, updated_at = now(), history = $6`,
        [matchId, body.status, body.reason || null, scheduledAt, principal.user_id, JSON.stringify(history)]);
    }
    return entry;
  });

  hub.emit('status', matchId);
  publish('match.status_changed', { match_id: matchId, ...result });
  return getStatus(matchId);
}

module.exports = { getStatus, setStatus, loadOverride };
