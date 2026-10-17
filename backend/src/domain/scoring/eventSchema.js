'use strict';
// Schema-level (400) validation of a POST /audit/v1/events body (spec 5.9). Pure; no match state needed.
const { isObj, isInt, isStr, isId } = require('../../lib/validate');
const { EVENT_TYPES } = require('./constants');
const { FieldErrors } = require('./fields');

function checkPayload(type, p, errs) {
  switch (type) {
    case 'match_init':
      if (!isId(p.sport_id)) errs.add('payload.sport_id');
      if (!isId(p.home_team_id)) errs.add('payload.home_team_id');
      if (!isId(p.away_team_id)) errs.add('payload.away_team_id');
      if (isId(p.home_team_id) && p.home_team_id === p.away_team_id) errs.add('payload.away_team_id');
      if (p.league_id !== undefined && p.league_id !== null && !isId(p.league_id)) errs.add('payload.league_id');
      break;
    case 'score':
      if (!isId(p.team_id)) errs.add('payload.team_id');
      if (!isStr(p.event_type) || p.event_type.length === 0) errs.add('payload.event_type');
      break;
    case 'discipline':
      if (!isId(p.team_id)) errs.add('payload.team_id');
      if (!isInt(p.points)) errs.add('payload.points');
      break;
    case 'tiebreak_winner':
      if (!isId(p.team_id)) errs.add('payload.team_id');
      break;
    case 'compensation':
      if (!isId(p.compensates)) errs.add('payload.compensates');
      if (!isStr(p.reason)) errs.add('payload.reason');
      break;
    default:
      break; // match_start / match_end take {}
  }
}

// Returns { ok, fields, event } where event = { event_id, match_id, type, payload } (payload defaults to {}).
function validateEventBody(body) {
  const errs = new FieldErrors();
  if (!isObj(body)) return { ok: false, fields: ['body'], event: null };
  if (!isId(body.event_id)) errs.add('event_id');
  if (!isId(body.match_id)) errs.add('match_id');
  const typeOk = isStr(body.type) && EVENT_TYPES.includes(body.type);
  if (!typeOk) errs.add('type');
  const payload = body.payload === undefined ? {} : body.payload;
  if (!isObj(payload)) errs.add('payload');
  else if (typeOk) checkPayload(body.type, payload, errs);
  if (!errs.ok) return { ok: false, fields: errs.list, event: null };
  return { ok: true, fields: [], event: { event_id: body.event_id, match_id: body.match_id, type: body.type, payload } };
}

module.exports = { validateEventBody };
