'use strict';
// Roster service (spec 5.11): loads state from Postgres, runs the pure rules, persists effects.
// Used by routes/audit/roster.js and by offline sync (applyTransfer, getPlayerAuditCount).
const { query, tx } = require('../db/pool');
const { ApiError, validation, notFound, conflict } = require('../lib/errors');
const { isDate, isId, nowIso, todayDate } = require('../lib/validate');
const { bodyHash } = require('../lib/signing');
const { publish } = require('../lib/queue');
const R = require('../domain/roster');

// All roster writes are serialized by one transaction-scoped advisory lock.
const ROSTER_LOCK = 51101;
const lock = (c) => c.query('SELECT pg_advisory_xact_lock($1)', [ROSTER_LOCK]);

function rowToReg(r) {
  return {
    player_id: r.player_id,
    league_id: r.league_id,
    name: r.name,
    position: r.position,
    squad_id: r.squad_id,
    parent_squad_id: r.parent_squad_id,
    registration_type: r.registration_type,
    start_date: r.start_date,
    loan_end_date: r.loan_end_date,
    role: r.role,
  };
}

async function writeRegistration(c, reg) {
  await c.query(
    `UPDATE registrations SET squad_id = $3, parent_squad_id = $4, registration_type = $5,
       start_date = $6, loan_end_date = $7, role = $8 WHERE player_id = $1 AND league_id = $2`,
    [reg.player_id, reg.league_id, reg.squad_id, reg.parent_squad_id, reg.registration_type,
      reg.start_date, reg.loan_end_date, reg.role],
  );
}

// Appends one immutable audit entry and returns it with audit_id and when filled in.
async function appendAudit(c, draft) {
  const seqRes = await c.query("SELECT nextval(pg_get_serial_sequence('roster_audit', 'seq')) AS seq");
  const seq = Number(seqRes.rows[0].seq);
  const entry = R.auditEntry({ ...draft, audit_id: R.auditId(seq), when: nowIso() });
  await c.query('INSERT INTO roster_audit (seq, audit_id, player_id, league_id, entry) VALUES ($1,$2,$3,$4,$5)',
    [seq, entry.audit_id, entry.player_id, entry.league_id, entry]);
  return entry;
}

async function persistReturns(c, returns) {
  const entries = [];
  for (const ret of returns) {
    await writeRegistration(c, ret.registration);
    entries.push(await appendAudit(c, ret.entry));
  }
  return entries;
}

// POST /audit/v1/roster/setup
async function setup(body) {
  const bad = R.validateSetup(body);
  if (bad.length) throw validation(bad);
  const missing = R.unknownSetupSquads(body);
  if (missing.length) throw notFound('SQUAD_NOT_FOUND', 'Squad not found in setup.', { squad_id: missing[0] });

  const league = body.league;
  let sportConfig = null;
  if (league.sport_id !== undefined && league.sport_id !== null) {
    const sp = await query('SELECT config FROM sports WHERE sport_id = $1', [league.sport_id]);
    if (sp.rowCount) sportConfig = sp.rows[0].config;
    else if (R.needsSportDefaults(league)) {
      throw notFound('SPORT_NOT_FOUND', 'Sport not found.', { sport_id: league.sport_id });
    }
  }
  const built = R.buildSetup(body, R.resolveLeagueConfig(league, sportConfig));
  const leagueId = built.config.league_id;
  const squadIds = built.squads.map((s) => s.squad_id);

  await tx(async (c) => {
    await lock(c);
    // Replace this league's roster state (including its audit trail and stored transfer replies).
    await c.query("DELETE FROM roster_requests WHERE response->'audit_entry'->>'league_id' = $1", [leagueId]);
    await c.query('DELETE FROM roster_audit WHERE league_id = $1', [leagueId]);
    await c.query('DELETE FROM registrations WHERE league_id = $1', [leagueId]);
    await c.query('DELETE FROM roster_live_matches WHERE league_id = $1', [leagueId]);
    // Squad ids are global: a squad id reused from another league moves to this one.
    await c.query('DELETE FROM squads WHERE league_id = $1 OR squad_id = ANY($2::text[])', [leagueId, squadIds]);
    await c.query(
      `INSERT INTO roster_leagues (league_id, config) VALUES ($1, $2)
       ON CONFLICT (league_id) DO UPDATE SET config = EXCLUDED.config`,
      [leagueId, built.config],
    );
    for (const s of built.squads) {
      await c.query('INSERT INTO squads (squad_id, league_id, club_id, tenant_id, name) VALUES ($1,$2,$3,$4,$5)',
        [s.squad_id, s.league_id, s.club_id, s.tenant_id, s.name]);
    }
    for (const r of built.registrations) {
      await c.query(
        `INSERT INTO registrations (player_id, league_id, name, position, squad_id, parent_squad_id,
           registration_type, start_date, loan_end_date, role) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [r.player_id, r.league_id, r.name, r.position, r.squad_id, r.parent_squad_id,
          r.registration_type, r.start_date, r.loan_end_date, r.role],
      );
    }
    for (const m of built.matches) {
      await c.query('INSERT INTO roster_live_matches (league_id, match_id, home_squad_id, away_squad_id) VALUES ($1,$2,$3,$4)',
        [leagueId, m.match_id, m.home_squad_id, m.away_squad_id]);
    }
  });
  return { statusCode: 201, body: built.response };
}

async function loadTransferState(c, req) {
  const lg = await c.query('SELECT config FROM roster_leagues WHERE league_id = $1', [req.league_id]);
  if (!lg.rowCount) return { league: null, squads: {}, registrations: [], matches: [] };
  const league = lg.rows[0].config;
  const regs = await c.query('SELECT * FROM registrations WHERE league_id = $1 ORDER BY player_id', [req.league_id]);
  const ids = [req.from_squad_id, req.to_squad_id].filter((x) => x !== null && x !== undefined);
  const sq = await c.query('SELECT squad_id, league_id, tenant_id FROM squads WHERE squad_id = ANY($1::text[])', [ids]);
  const squads = {};
  for (const s of sq.rows) squads[s.squad_id] = s;
  return {
    league,
    squads,
    registrations: regs.rows.map(rowToReg),
    matches: league.matches_in_progress || [],
  };
}

// POST /audit/v1/roster/transfer. Returns { statusCode, body } or throws ApiError.
async function applyTransfer(body) {
  const bad = R.validateTransfer(body);
  if (bad.length) throw validation(bad);
  const req = R.normalizeTransfer(body);
  const hash = bodyHash(req);

  const out = await tx(async (c) => {
    await lock(c);
    const prev = await c.query('SELECT body_hash, response FROM roster_requests WHERE request_id = $1', [req.request_id]);
    if (prev.rowCount) {
      if (prev.rows[0].body_hash === hash) {
        const stored = prev.rows[0].response; // jsonb reorders keys: rebuild the documented order
        return { statusCode: 200, body: R.transferResponse(stored.request_id, stored, stored.audit_entry) };
      }
      throw conflict('DUPLICATE_REQUEST_ID', 'request_id was already used with a different body.', {
        request_id: req.request_id,
      });
    }
    const state = await loadTransferState(c, req);
    const result = R.evaluateTransfer(state, req);
    if (result.error) {
      const e = result.error;
      throw new ApiError(e.status, e.code, e.message, e.details);
    }
    await persistReturns(c, result.returns);
    await writeRegistration(c, result.row);
    const entry = await appendAudit(c, result.entry);
    const response = R.transferResponse(req.request_id, result, entry);
    await c.query('INSERT INTO roster_requests (request_id, body_hash, status_code, response) VALUES ($1,$2,$3,$4)',
      [req.request_id, hash, 201, response]);
    return { statusCode: 201, body: response };
  });
  if (out.statusCode === 201) publish('roster.' + req.type, out.body.audit_entry);
  return out;
}

// GET /audit/v1/roster/history/:player_id?as_of=YYYY-MM-DD
async function history(playerId, asOfRaw) {
  if (asOfRaw !== undefined && asOfRaw !== null && !isDate(asOfRaw)) throw validation(['as_of']);
  const asOf = asOfRaw ?? todayDate();
  if (!isId(playerId)) throw notFound('PLAYER_NOT_FOUND', 'Player not found.', { player_id: playerId });

  return tx(async (c) => {
    await lock(c);
    // A player may be registered in several roster leagues: use the one with the latest audit activity.
    const regs = await c.query(
      `SELECT r.*, (SELECT max(seq) FROM roster_audit a WHERE a.player_id = r.player_id AND a.league_id = r.league_id) AS last_seq
         FROM registrations r WHERE r.player_id = $1
        ORDER BY last_seq DESC NULLS LAST, r.league_id ASC`,
      [playerId],
    );
    if (!regs.rowCount) throw notFound('PLAYER_NOT_FOUND', 'Player not found.', { player_id: playerId });
    const reg = rowToReg(regs.rows[0]);
    const leagueId = reg.league_id;

    // Automatic loan return: written once, the first time as_of is past loan_end_date.
    await persistReturns(c, R.computeLoanReturns([reg], asOf));

    const cfg = await c.query('SELECT config FROM roster_leagues WHERE league_id = $1', [leagueId]);
    const initial = cfg.rowCount ? (cfg.rows[0].config.initial || {})[playerId] ?? null : null;
    const ent = await c.query('SELECT entry FROM roster_audit WHERE player_id = $1 AND league_id = $2 ORDER BY seq',
      [playerId, leagueId]);
    return { statusCode: 200, body: R.historyResponse(playerId, asOf, leagueId, initial, ent.rows.map((r) => r.entry)) };
  });
}

// Roster version used by offline sync: number of audit entries for the player.
async function getPlayerAuditCount(playerId) {
  const r = await query('SELECT count(*)::int AS n FROM roster_audit WHERE player_id = $1', [playerId]);
  return r.rows[0].n;
}

module.exports = { setup, applyTransfer, history, getPlayerAuditCount };
