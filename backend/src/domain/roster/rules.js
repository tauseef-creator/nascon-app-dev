'use strict';
// Pure roster rules (spec 5.11 / FR-2.2): setup projection, the transfer checks 2..8 in
// exact order, effects, loan auto-return and the squad-on-date replay used by history.

function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function auditId(seq) {
  return 'au-' + String(seq).padStart(4, '0');
}

// Fixed key order for audit entries (matches the spec example).
function auditEntry(e) {
  return {
    audit_id: e.audit_id ?? null,
    action: e.action,
    player_id: e.player_id,
    league_id: e.league_id,
    from_squad_id: e.from_squad_id ?? null,
    to_squad_id: e.to_squad_id ?? null,
    effective_date: e.effective_date,
    state: e.state ?? 'active',
    who: e.who ?? null,
    when: e.when ?? null,
    why: e.why ?? null,
  };
}

// League roster config after applying sport defaults (spec 5.11: omitted limits come from sport.roster).
function resolveLeagueConfig(league, sportConfig) {
  const roster = (sportConfig && sportConfig.roster) || {};
  const max = league.max_squad_size ?? roster.max_squad_size ?? null;
  const req = league.required_positions ?? roster.required_positions ?? {};
  return {
    league_id: league.league_id,
    tenant_id: league.tenant_id,
    sport_id: league.sport_id ?? null,
    transfer_window: league.transfer_window ?? null,
    max_squad_size: Number.isInteger(max) ? max : null,
    required_positions: req && typeof req === 'object' && !Array.isArray(req) ? { ...req } : {},
  };
}

// True when the league needs the sport to fill in a missing limit.
function needsSportDefaults(league) {
  return league.max_squad_size === undefined || league.max_squad_size === null
    || league.required_positions === undefined || league.required_positions === null;
}

// Rows created by a setup body (already validated).
function buildSetup(body, config) {
  const leagueId = config.league_id;
  const squads = body.squads.map((s) => ({
    squad_id: s.squad_id, league_id: leagueId, club_id: s.club_id ?? null, tenant_id: s.tenant_id, name: s.name ?? null,
  }));
  const registrations = (body.players || []).map((p) => ({
    player_id: p.player_id,
    league_id: leagueId,
    name: p.name ?? null,
    position: p.position,
    squad_id: p.squad_id ?? null,
    parent_squad_id: null,
    registration_type: 'initial',
    start_date: null,
    loan_end_date: null,
    role: p.role ?? 'substitute',
  }));
  const matches = (body.matches_in_progress || []).map((m) => ({
    match_id: m.match_id, home_squad_id: m.home_squad_id ?? null, away_squad_id: m.away_squad_id ?? null,
  }));
  const squadCounts = {};
  for (const s of squads) squadCounts[s.squad_id] = 0;
  for (const r of registrations) if (r.squad_id !== null) squadCounts[r.squad_id] += 1;
  const initial = {};
  for (const r of registrations) initial[r.player_id] = r.squad_id;
  return {
    config: { ...config, initial, matches_in_progress: matches },
    squads,
    registrations,
    matches,
    response: { league_id: leagueId, status: 'configured', squad_counts: squadCounts },
  };
}

// Loans whose return date (loan_end_date + 1) is on or before asOfDate.
// Returns [{ player_id, league_id, lender, borrower, return_date, registration, entry }].
function computeLoanReturns(registrations, asOfDate) {
  const out = [];
  for (const r of registrations) {
    if (r.registration_type !== 'loan' || !r.loan_end_date || !(r.loan_end_date < asOfDate)) continue;
    const returnDate = addDays(r.loan_end_date, 1);
    out.push({
      player_id: r.player_id,
      league_id: r.league_id,
      lender: r.parent_squad_id,
      borrower: r.squad_id,
      return_date: returnDate,
      registration: {
        ...r,
        squad_id: r.parent_squad_id,
        parent_squad_id: null,
        registration_type: 'loan_return',
        start_date: returnDate,
        loan_end_date: null,
        role: 'substitute',
      },
      entry: auditEntry({
        action: 'loan_return',
        player_id: r.player_id,
        league_id: r.league_id,
        from_squad_id: r.squad_id,
        to_squad_id: r.parent_squad_id,
        effective_date: returnDate,
        state: 'active',
        who: 'system',
        why: 'Loan ended',
      }),
    });
  }
  return out;
}

// Registrations as they stand on `date` (expired loans returned).
function applyReturns(registrations, date) {
  const returns = computeLoanReturns(registrations, date);
  const byPlayer = new Map(returns.map((x) => [x.player_id, x.registration]));
  return { returns, registrations: registrations.map((r) => byPlayer.get(r.player_id) || r) };
}

function fail(status, code, message, details = {}) {
  return { error: { status, code, message, details } };
}

function inWindow(window, date) {
  if (!window) return true;
  return date >= window.open && date <= window.close;
}

// state = { league: config|null, squads: {squad_id: {squad_id, tenant_id, league_id}},
//           registrations: [league registrations], matches: [{match_id, home_squad_id, away_squad_id}] }
// req   = normalized transfer request (validated by validateTransfer).
// Returns { error: {status, code, message, details} } or the accepted effects.
function evaluateTransfer(state, req) {
  const { league } = state;
  const squads = state.squads || {};
  // 2) referenced ids exist
  if (!league) return fail(404, 'LEAGUE_NOT_FOUND', 'League not found.', { league_id: req.league_id });
  const stored = (state.registrations || []).find((r) => r.player_id === req.player_id);
  if (!stored) return fail(404, 'PLAYER_NOT_FOUND', 'Player not found in this league.', { player_id: req.player_id });
  const squadIds = req.type === 'release' ? [req.from_squad_id] : [req.from_squad_id, req.to_squad_id];
  for (const id of squadIds) {
    if (!squads[id]) return fail(404, 'SQUAD_NOT_FOUND', 'Squad not found.', { squad_id: id });
  }
  // 3) squads belong to the league's tenant
  for (const id of squadIds) {
    if (squads[id].tenant_id !== league.tenant_id) {
      return fail(409, 'CROSS_TENANT_TRANSFER', 'Squad belongs to a different tenant than the league.', {
        squad_id: id, squad_tenant_id: squads[id].tenant_id, league_tenant_id: league.tenant_id,
      });
    }
  }
  // State on the effective date: loans that ended before it are back with the lender.
  const { returns, registrations } = applyReturns(state.registrations || [], req.effective_date);
  const reg = registrations.find((r) => r.player_id === req.player_id);
  const ownReturns = returns.filter((x) => x.player_id === req.player_id);
  // 4) player is in from squad
  if (reg.squad_id !== req.from_squad_id) {
    return fail(409, 'NOT_IN_SQUAD', 'Player is not in the from squad.', {
      player_id: req.player_id, from_squad_id: req.from_squad_id, current_squad_id: reg.squad_id ?? null,
    });
  }
  // 5) window (transfer / loan only, inclusive)
  if (req.type !== 'release' && !inWindow(league.transfer_window, req.effective_date)) {
    return fail(409, 'TRANSFER_WINDOW_CLOSED', 'Effective date is outside the transfer window.', {
      effective_date: req.effective_date,
      open: league.transfer_window.open,
      close: league.transfer_window.close,
    });
  }
  // 6) not currently on loan
  if (reg.registration_type === 'loan') {
    return fail(409, 'PLAYER_ON_LOAN', 'Player is currently on loan.', {
      player_id: req.player_id, parent_squad_id: reg.parent_squad_id, loan_end_date: reg.loan_end_date,
    });
  }
  // 7) destination squad size
  if (req.type !== 'release' && league.max_squad_size !== null && league.max_squad_size !== undefined) {
    const count = registrations.filter((r) => r.squad_id === req.to_squad_id && r.player_id !== req.player_id).length;
    if (count + 1 > league.max_squad_size) {
      return fail(409, 'SQUAD_FULL', 'Destination squad is full.', {
        squad_id: req.to_squad_id, max_squad_size: league.max_squad_size, current_size: count,
      });
    }
  }
  // 8) from squad keeps the required count for the player's position
  const required = (league.required_positions || {})[reg.position];
  if (Number.isInteger(required) && required > 0) {
    const remaining = registrations.filter((r) => r.squad_id === req.from_squad_id
      && r.player_id !== req.player_id && r.position === reg.position).length;
    if (remaining < required) {
      return fail(409, 'MIN_POSITION_VIOLATION', 'From squad would drop below the required count for this position.', {
        squad_id: req.from_squad_id, position: reg.position, required, remaining,
      });
    }
  }

  // Edge case 6: the player's (old) squad is in an in-progress match.
  const blocking = (state.matches || []).find((m) => m.home_squad_id === req.from_squad_id
    || m.away_squad_id === req.from_squad_id);
  const status = blocking ? 'deferred_until_match_end' : 'active';

  let registration = null;
  let stateRow;
  if (req.type === 'release') {
    stateRow = { ...reg, squad_id: null, parent_squad_id: null, registration_type: 'release',
      start_date: req.effective_date, loan_end_date: null, role: null };
  } else {
    registration = {
      player_id: req.player_id,
      league_id: req.league_id,
      squad_id: req.to_squad_id,
      parent_squad_id: req.type === 'loan' ? req.from_squad_id : null,
      registration_type: req.type,
      start_date: req.effective_date,
      loan_end_date: req.type === 'loan' ? req.loan_end_date : null,
      role: 'substitute',
    };
    stateRow = { ...reg, ...registration };
  }

  return {
    returns: ownReturns,
    registration,
    row: stateRow,
    vacated_role: ['captain', 'vice_captain'].includes(reg.role) ? reg.role : null,
    state: status,
    blocking_match_id: blocking ? blocking.match_id : null,
    entry: auditEntry({
      action: req.type,
      player_id: req.player_id,
      league_id: req.league_id,
      from_squad_id: req.from_squad_id,
      to_squad_id: req.to_squad_id,
      effective_date: req.effective_date,
      state: status,
      who: req.requested_by,
      why: req.reason,
    }),
  };
}

function registrationView(r) {
  if (!r) return null;
  return {
    player_id: r.player_id,
    league_id: r.league_id,
    squad_id: r.squad_id ?? null,
    parent_squad_id: r.parent_squad_id ?? null,
    registration_type: r.registration_type,
    start_date: r.start_date ?? null,
    loan_end_date: r.loan_end_date ?? null,
    role: r.role ?? null,
  };
}

function transferResponse(requestId, result, entry) {
  return {
    request_id: requestId,
    status: 'accepted',
    state: result.state,
    blocking_match_id: result.blocking_match_id ?? null,
    registration: registrationView(result.registration),
    audit_entry: auditEntry(entry),
  };
}

// Squad (and lender, if on loan) on `asOf`, replaying audit entries effective on or before it.
function squadOnDate(initialSquadId, entries, asOf) {
  let squad = initialSquadId ?? null;
  let parent = null;
  for (const e of entries) {
    if (!(e.effective_date <= asOf)) continue;
    if (e.action === 'release') {
      squad = null;
      parent = null;
    } else {
      squad = e.to_squad_id ?? null;
      parent = e.action === 'loan' ? e.from_squad_id ?? null : null;
    }
  }
  return { current_squad_id: squad, parent_squad_id: parent };
}

function historyResponse(playerId, asOf, leagueId, initialSquadId, entries) {
  const pos = squadOnDate(initialSquadId, entries, asOf);
  return {
    player_id: playerId,
    as_of: asOf,
    league_id: leagueId,
    current_squad_id: pos.current_squad_id,
    parent_squad_id: pos.parent_squad_id,
    history: entries.map(auditEntry),
  };
}

module.exports = {
  addDays, auditId, auditEntry, resolveLeagueConfig, needsSportDefaults, buildSetup,
  computeLoanReturns, applyReturns, evaluateTransfer, registrationView, transferResponse, squadOnDate, historyResponse,
};
