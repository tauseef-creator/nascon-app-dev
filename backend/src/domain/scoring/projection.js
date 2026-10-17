'use strict';
// Score projection rebuilt from an ordered event log (spec 5.9). Pure.
// All sport behaviour comes from sportConfig.scoring_model and sportConfig.scoring_events.
const { COMPENSABLE_TYPES } = require('./constants');
const { has } = require('./fields');

function formatOvers(balls, ballsPerOver) {
  return `${Math.floor(balls / ballsPerOver)}.${balls % ballsPerOver}`;
}

// Model limits derived from config. Null entries do not apply to the model.
function modelLimits(sport) {
  const p = sport.periods || {};
  if (sport.scoring_model === 'innings') {
    return {
      max_balls: p.innings_per_team * p.overs_per_innings * p.balls_per_over,
      max_wickets: p.innings_per_team * p.wickets_per_innings,
      balls_per_over: p.balls_per_over,
      rounds_to_win: null,
    };
  }
  if (sport.scoring_model === 'round') {
    return { max_balls: null, max_wickets: null, balls_per_over: null, rounds_to_win: (p.best_of + 1) / 2 };
  }
  return { max_balls: null, max_wickets: null, balls_per_over: null, rounds_to_win: null };
}

// Map target event_id -> compensating event_id. The first valid compensation of a target wins.
function compensationMap(events) {
  const byId = new Map(events.map((e) => [e.event_id, e]));
  const map = new Map();
  for (const e of events) {
    if (e.type !== 'compensation') continue;
    const targetId = e.payload && e.payload.compensates;
    const target = byId.get(targetId);
    if (!target || map.has(targetId) || !COMPENSABLE_TYPES.includes(target.type)) continue;
    map.set(targetId, e.event_id);
  }
  return map;
}

function newSide(teamId) {
  return { team_id: teamId, score: 0, wickets: 0, balls: 0, fair_play: 0 };
}

function applyScore(model, def, side) {
  if (model === 'event') side.score += def.points;
  else if (model === 'round') side.score += def.rounds;
  else if (model === 'innings') {
    side.score += def.runs;
    if (def.legal_ball) side.balls += 1;
    if (def.wicket) side.wickets += 1;
  }
}

function decideOutcome(status, sport, home, away, tiebreakTeam) {
  if (status !== 'completed') return { outcome: 'pending', winner: null };
  if (home.score > away.score) return { outcome: 'home_win', winner: home.team_id };
  if (away.score > home.score) return { outcome: 'away_win', winner: away.team_id };
  if (tiebreakTeam === home.team_id) return { outcome: 'home_win', winner: home.team_id };
  if (tiebreakTeam === away.team_id) return { outcome: 'away_win', winner: away.team_id };
  if (sport.draw_allowed) return { outcome: 'draw', winner: null };
  return { outcome: 'undecided', winner: null };
}

function publicSide(model, side, limits) {
  const innings = model === 'innings';
  return {
    team_id: side.team_id,
    score: side.score,
    wickets: innings ? side.wickets : null,
    balls: innings ? side.balls : null,
    overs: innings ? formatOvers(side.balls, limits.balls_per_over) : null,
    fair_play: side.fair_play,
    // Internal helpers (not part of the /score response):
    all_out: innings ? side.wickets >= limits.max_wickets : false,
    innings_complete: innings ? (side.balls >= limits.max_balls || side.wickets >= limits.max_wickets) : false,
  };
}

/**
 * projectMatch(sportConfig, events, match)
 * events: ordered [{ sequence, event_id, type, payload, signature? }]
 * match:  { match_id, sport_id, league_id, home_team_id, away_team_id }
 */
function projectMatch(sport, events, match) {
  const model = sport.scoring_model;
  const scoringEvents = sport.scoring_events || {};
  const limits = modelLimits(sport);
  const compensatedBy = compensationMap(events);
  const home = newSide(match.home_team_id);
  const away = newSide(match.away_team_id);
  const sideOf = (teamId) => (teamId === home.team_id ? home : teamId === away.team_id ? away : null);
  let status = 'upcoming';
  let tiebreakTeam = null;

  for (const e of events) {
    const p = e.payload || {};
    const active = !compensatedBy.has(e.event_id);
    if (e.type === 'match_start' && status === 'upcoming') status = 'in_progress';
    else if (e.type === 'match_end' && status === 'in_progress') status = 'completed';
    if (!active) continue;
    const side = sideOf(p.team_id);
    if (e.type === 'score' && side && has(scoringEvents, p.event_type)) applyScore(model, scoringEvents[p.event_type], side);
    else if (e.type === 'discipline' && side && Number.isInteger(p.points)) side.fair_play += p.points;
    else if (e.type === 'tiebreak_winner' && side) tiebreakTeam = side.team_id;
  }

  const { outcome, winner } = decideOutcome(status, sport, home, away, tiebreakTeam);
  return {
    match_id: match.match_id,
    sport_id: match.sport_id,
    league_id: match.league_id ?? null,
    status,
    outcome,
    winner_team_id: winner,
    tiebreak_winner_team_id: tiebreakTeam,
    home: publicSide(model, home, limits),
    away: publicSide(model, away, limits),
    version: events.length,
    events: events.map((e) => ({
      sequence: e.sequence,
      event_id: e.event_id,
      type: e.type,
      payload: e.payload,
      signature: e.signature,
      compensated: compensatedBy.has(e.event_id),
      compensated_by: compensatedBy.get(e.event_id) ?? null,
    })),
    // Internal helpers (not part of the /score response):
    scoring_model: model,
    limits,
  };
}

// Shapes a projection into the exact GET /audit/v1/score/{match_id} response (spec 5.9).
function toScoreResponse(proj) {
  const side = (s) => ({ team_id: s.team_id, score: s.score, wickets: s.wickets, balls: s.balls, overs: s.overs, fair_play: s.fair_play });
  return {
    match_id: proj.match_id,
    sport_id: proj.sport_id,
    league_id: proj.league_id,
    status: proj.status,
    outcome: proj.outcome,
    winner_team_id: proj.winner_team_id,
    tiebreak_winner_team_id: proj.tiebreak_winner_team_id,
    home: side(proj.home),
    away: side(proj.away),
    version: proj.version,
    events: proj.events,
  };
}

module.exports = { projectMatch, toScoreResponse, formatOvers, modelLimits, compensationMap };
