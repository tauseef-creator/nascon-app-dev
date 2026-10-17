'use strict';
// Business rules for appending an event to an existing match stream (spec 5.9). Pure.
// Returns null when the event is allowed, else { status, code, message, details }.
const { COMPENSABLE_TYPES } = require('./constants');
const { has } = require('./fields');

const err = (status, code, message, details = {}) => ({ status, code, message, details });

function teamCheck(proj, teamId) {
  if (teamId === proj.home.team_id || teamId === proj.away.team_id) return null;
  return err(400, 'VALIDATION_ERROR', 'team_id must be the home or away team of this match.',
    { fields: ['payload', 'payload.team_id', 'team_id'] });
}

function notInProgress(proj) {
  if (proj.status === 'in_progress') return null;
  return err(409, 'MATCH_NOT_IN_PROGRESS', `Match is ${proj.status}.`, { status: proj.status });
}

function scoreRules(sport, proj, p) {
  const bad = teamCheck(proj, p.team_id);
  if (bad) return bad;
  if (!has(sport.scoring_events || {}, p.event_type)) {
    return err(400, 'UNKNOWN_EVENT_TYPE', `Event type ${p.event_type} is not defined for this sport.`, { event_type: p.event_type });
  }
  const state = notInProgress(proj);
  if (state) return state;
  const side = p.team_id === proj.home.team_id ? proj.home : proj.away;
  if (sport.scoring_model === 'innings' && side.innings_complete) {
    return err(409, 'INNINGS_COMPLETE', `Innings of ${p.team_id} is complete.`, { team_id: p.team_id });
  }
  const toWin = proj.limits.rounds_to_win;
  if (sport.scoring_model === 'round' && Math.max(proj.home.score, proj.away.score) >= toWin) {
    return err(409, 'SERIES_ALREADY_DECIDED', 'The series is already decided.', {});
  }
  return null;
}

function compensationRules(proj, p, target) {
  if (!target) return err(404, 'EVENT_NOT_FOUND', `Event ${p.compensates} not found.`, { event_id: p.compensates });
  if (target.match_id !== proj.match_id) {
    return err(409, 'INVALID_COMPENSATION', 'Target event belongs to another match.', { event_id: p.compensates });
  }
  if (!COMPENSABLE_TYPES.includes(target.type)) {
    return err(409, 'INVALID_COMPENSATION', `Events of type ${target.type} cannot be compensated.`, { event_id: p.compensates });
  }
  const row = proj.events.find((e) => e.event_id === p.compensates);
  if (row && row.compensated) {
    return err(409, 'INVALID_COMPENSATION', 'Target event is already compensated.', { event_id: p.compensates, compensated_by: row.compensated_by });
  }
  return null;
}

/**
 * validateEventAgainstState(sportConfig, projection, event, ctx)
 * projection: result of projectMatch for the current log of an existing stream.
 * ctx.target: for compensation, the targeted event row { event_id, match_id, type } found anywhere, or null.
 */
function validateEventAgainstState(sport, proj, event, ctx = {}) {
  const p = event.payload || {};
  switch (event.type) {
    case 'match_init':
      return err(409, 'MATCH_EXISTS', `Match ${proj.match_id} already exists.`, { match_id: proj.match_id });
    case 'match_start':
      return proj.status === 'upcoming' ? null
        : err(409, 'ILLEGAL_TRANSITION', `Cannot start a match that is ${proj.status}.`, { status: proj.status });
    case 'score':
      return scoreRules(sport, proj, p);
    case 'discipline':
    case 'tiebreak_winner':
      return teamCheck(proj, p.team_id) || notInProgress(proj);
    case 'match_end': {
      if (proj.status !== 'in_progress') {
        return err(409, 'ILLEGAL_TRANSITION', `Cannot end a match that is ${proj.status}.`, { status: proj.status });
      }
      const level = proj.home.score === proj.away.score;
      if (level && !sport.draw_allowed && !proj.tiebreak_winner_team_id) {
        return err(409, 'TIE_NOT_ALLOWED', 'Score is level, draws are not allowed and no tie-break winner exists.', {});
      }
      return null;
    }
    case 'compensation':
      return compensationRules(proj, p, ctx.target || null);
    default:
      return err(400, 'VALIDATION_ERROR', 'Unknown event type.', { fields: ['type'] });
  }
}

module.exports = { validateEventAgainstState };
