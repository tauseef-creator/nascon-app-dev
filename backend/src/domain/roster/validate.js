'use strict';
// Schema checks for the roster endpoints (spec 5.11, check 1). Pure: returns bad field names.
const { isObj, isInt, isStr, isId, isDate } = require('../../lib/validate');

const ROLES = ['captain', 'vice_captain', 'starter', 'substitute'];
const TYPES = ['transfer', 'loan', 'release'];

const isNullish = (v) => v === undefined || v === null;
const optStr = (v) => isNullish(v) || isStr(v);

function validateLeague(league, bad) {
  if (!isObj(league)) {
    bad.push('league');
    return;
  }
  if (!isId(league.league_id)) bad.push('league.league_id');
  if (!isId(league.tenant_id)) bad.push('league.tenant_id');
  if (!isNullish(league.sport_id) && !isId(league.sport_id)) bad.push('league.sport_id');
  if (!isNullish(league.transfer_window)) {
    const w = league.transfer_window;
    if (!isObj(w)) bad.push('league.transfer_window');
    else {
      if (!isDate(w.open)) bad.push('league.transfer_window.open');
      if (!isDate(w.close)) bad.push('league.transfer_window.close');
      if (isDate(w.open) && isDate(w.close) && w.open > w.close) bad.push('league.transfer_window');
    }
  }
  if (!isNullish(league.max_squad_size) && (!isInt(league.max_squad_size) || league.max_squad_size < 0)) {
    bad.push('league.max_squad_size');
  }
  if (!isNullish(league.required_positions)) {
    const rp = league.required_positions;
    if (!isObj(rp)) bad.push('league.required_positions');
    else {
      for (const [k, v] of Object.entries(rp)) {
        if (!isInt(v) || v < 0) bad.push(`league.required_positions.${k}`);
      }
    }
  }
}

function validateSquads(squads, bad) {
  if (!Array.isArray(squads)) {
    bad.push('squads');
    return;
  }
  const seen = new Set();
  squads.forEach((s, i) => {
    if (!isObj(s)) {
      bad.push(`squads[${i}]`);
      return;
    }
    if (!isId(s.squad_id)) bad.push(`squads[${i}].squad_id`);
    else if (seen.has(s.squad_id)) bad.push(`squads[${i}].squad_id`);
    else seen.add(s.squad_id);
    if (!isNullish(s.club_id) && !isId(s.club_id)) bad.push(`squads[${i}].club_id`);
    if (!isId(s.tenant_id)) bad.push(`squads[${i}].tenant_id`);
    if (!optStr(s.name)) bad.push(`squads[${i}].name`);
  });
}

function validatePlayers(players, bad) {
  if (isNullish(players)) return;
  if (!Array.isArray(players)) {
    bad.push('players');
    return;
  }
  const seen = new Set();
  players.forEach((p, i) => {
    if (!isObj(p)) {
      bad.push(`players[${i}]`);
      return;
    }
    if (!isId(p.player_id)) bad.push(`players[${i}].player_id`);
    else if (seen.has(p.player_id)) bad.push(`players[${i}].player_id`);
    else seen.add(p.player_id);
    if (!optStr(p.name)) bad.push(`players[${i}].name`);
    if (!isStr(p.position) || p.position.length === 0) bad.push(`players[${i}].position`);
    if (!isNullish(p.squad_id) && !isId(p.squad_id)) bad.push(`players[${i}].squad_id`);
    if (!isNullish(p.role) && !ROLES.includes(p.role)) bad.push(`players[${i}].role`);
  });
}

function validateMatches(matches, bad) {
  if (isNullish(matches)) return;
  if (!Array.isArray(matches)) {
    bad.push('matches_in_progress');
    return;
  }
  matches.forEach((m, i) => {
    if (!isObj(m)) {
      bad.push(`matches_in_progress[${i}]`);
      return;
    }
    if (!isId(m.match_id)) bad.push(`matches_in_progress[${i}].match_id`);
    if (!isNullish(m.home_squad_id) && !isId(m.home_squad_id)) bad.push(`matches_in_progress[${i}].home_squad_id`);
    if (!isNullish(m.away_squad_id) && !isId(m.away_squad_id)) bad.push(`matches_in_progress[${i}].away_squad_id`);
  });
}

// POST /roster/setup body. Returns an array of offending field names (empty = valid).
function validateSetup(body) {
  if (!isObj(body)) return ['body'];
  const bad = [];
  validateLeague(body.league, bad);
  validateSquads(body.squads, bad);
  validatePlayers(body.players, bad);
  validateMatches(body.matches_in_progress, bad);
  return bad;
}

// Squad ids referenced by players / live matches that are not part of the setup (-> 404 SQUAD_NOT_FOUND).
function unknownSetupSquads(body) {
  const ids = new Set(body.squads.map((s) => s.squad_id));
  const missing = [];
  const check = (id) => {
    if (!isNullish(id) && !ids.has(id) && !missing.includes(id)) missing.push(id);
  };
  for (const p of body.players || []) check(p.squad_id);
  for (const m of body.matches_in_progress || []) {
    check(m.home_squad_id);
    check(m.away_squad_id);
  }
  return missing;
}

// POST /roster/transfer body, check 1 of spec 5.11.
function validateTransfer(body) {
  if (!isObj(body)) return ['body'];
  const bad = [];
  if (!isId(body.request_id)) bad.push('request_id');
  if (!isId(body.league_id)) bad.push('league_id');
  if (!isId(body.player_id)) bad.push('player_id');
  const typeOk = TYPES.includes(body.type);
  if (!typeOk) bad.push('type');
  if (!isId(body.from_squad_id)) bad.push('from_squad_id');
  if (body.type === 'release') {
    if (!isNullish(body.to_squad_id) && !isId(body.to_squad_id)) bad.push('to_squad_id');
  } else if (!isId(body.to_squad_id)) bad.push('to_squad_id');
  const effOk = isDate(body.effective_date);
  if (!effOk) bad.push('effective_date');
  if (body.type === 'loan') {
    if (!isDate(body.loan_end_date)) bad.push('loan_end_date');
    else if (effOk && !(body.loan_end_date > body.effective_date)) bad.push('loan_end_date');
  } else if (!isNullish(body.loan_end_date) && !isDate(body.loan_end_date)) {
    bad.push('loan_end_date');
  }
  if (!optStr(body.reason)) bad.push('reason');
  if (!optStr(body.requested_by)) bad.push('requested_by');
  return bad;
}

// The fields that define a transfer request (unknown fields ignored, absent -> null).
function normalizeTransfer(body) {
  const release = body.type === 'release';
  return {
    request_id: body.request_id,
    league_id: body.league_id,
    player_id: body.player_id,
    type: body.type,
    from_squad_id: body.from_squad_id,
    to_squad_id: release ? null : body.to_squad_id,
    effective_date: body.effective_date,
    loan_end_date: body.type === 'loan' ? body.loan_end_date : null,
    reason: isNullish(body.reason) ? null : body.reason,
    requested_by: isNullish(body.requested_by) ? null : body.requested_by,
  };
}

module.exports = { ROLES, TYPES, validateSetup, unknownSetupSquads, validateTransfer, normalizeTransfer };
