'use strict';
// Schema validation of POST /audit/v1/leagues (spec 5.8). Pure; existence checks are done by the caller.
const { isObj, isInt, isStr, isId } = require('../../lib/validate');
const { FieldErrors } = require('./fields');
const { validTieBreakOrder } = require('./sportConfig');

const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 };

function checkTeams(teams, errs) {
  if (!Array.isArray(teams) || teams.length < 2 || teams.length > 40) {
    errs.add('teams');
    return new Set();
  }
  const set = new Set();
  teams.forEach((t, i) => {
    if (!isId(t)) errs.add(`teams[${i}]`);
    else if (set.has(t)) errs.add('teams');
    else set.add(t);
  });
  return set;
}

function checkFixtures(fixtures, teamSet, errs) {
  if (!Array.isArray(fixtures)) return errs.add('fixtures');
  fixtures.forEach((f, i) => {
    const base = `fixtures[${i}]`;
    if (!isObj(f)) return errs.add(base);
    if (!isId(f.match_id)) errs.add(`${base}.match_id`);
    const homeOk = isId(f.home) && teamSet.has(f.home);
    const awayOk = isId(f.away) && teamSet.has(f.away);
    if (!homeOk) errs.add(`${base}.home`);
    if (!awayOk) errs.add(`${base}.away`);
    if (homeOk && awayOk && f.home === f.away) errs.add(`${base}.away`);
    return undefined;
  });
  return undefined;
}

function checkPoints(points, errs) {
  if (points === undefined || points === null) return { ...DEFAULT_POINTS };
  if (!isObj(points)) {
    errs.add('points');
    return null;
  }
  const out = { ...DEFAULT_POINTS };
  for (const k of Object.keys(DEFAULT_POINTS)) {
    if (points[k] === undefined) continue;
    if (!isInt(points[k])) errs.add(`points.${k}`);
    else out[k] = points[k];
  }
  return out;
}

// Returns { ok, fields, value }. value holds the normalised league (points defaulted);
// tie_break_order is null when omitted (caller defaults it to the sport's order), lots_seed null when omitted.
function validateLeagueBody(body) {
  const errs = new FieldErrors();
  if (!isObj(body)) return { ok: false, fields: ['body'], value: null };
  if (!isId(body.league_id)) errs.add('league_id');
  if (!isId(body.sport_id)) errs.add('sport_id');
  const teamSet = checkTeams(body.teams, errs);
  checkFixtures(body.fixtures, teamSet, errs);
  const points = checkPoints(body.points, errs);
  const tbo = body.tie_break_order;
  if (tbo !== undefined && tbo !== null && !validTieBreakOrder(tbo)) errs.add('tie_break_order');
  const q = body.qualification;
  if (!isObj(q)) errs.add('qualification');
  else if (!isInt(q.spots) || q.spots < 1 || (Array.isArray(body.teams) && q.spots > body.teams.length)) {
    errs.add('qualification.spots');
  }
  const seed = body.lots_seed;
  if (seed !== undefined && seed !== null && !isInt(seed)) errs.add('lots_seed');

  if (!errs.ok) return { ok: false, fields: errs.list, value: null };
  return {
    ok: true,
    fields: [],
    value: {
      league_id: body.league_id,
      sport_id: body.sport_id,
      name: isStr(body.name) ? body.name : null,
      teams: [...body.teams],
      fixtures: body.fixtures.map((f) => ({ match_id: f.match_id, home: f.home, away: f.away })),
      points,
      tie_break_order: tbo === undefined || tbo === null ? null : [...tbo],
      qualification: { spots: q.spots },
      lots_seed: seed === undefined || seed === null ? null : seed,
    },
  };
}

// First duplicated match_id inside the fixture list, or null.
function duplicateFixtureId(fixtures) {
  const seen = new Set();
  for (const f of fixtures) {
    if (seen.has(f.match_id)) return f.match_id;
    seen.add(f.match_id);
  }
  return null;
}

module.exports = { validateLeagueBody, duplicateFixtureId, DEFAULT_POINTS };
