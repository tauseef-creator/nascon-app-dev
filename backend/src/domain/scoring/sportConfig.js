'use strict';
// Validation and normalisation of a sport config (spec 5.6). Pure.
const { isObj, isInt, isStr, isBool } = require('../../lib/validate');
const {
  SCORING_MODELS, OVERTIME_POLICIES, TIE_BREAK_TOKENS, SPORT_ID_RE, EVENT_KEY_RE,
} = require('./constants');
const { FieldErrors } = require('./fields');

const PERIOD_FIELDS = {
  event: ['count', 'duration_minutes'],
  innings: ['innings_per_team', 'overs_per_innings', 'balls_per_over', 'wickets_per_innings'],
  round: ['best_of'],
};

// Validates a tie_break_order array: known tokens, no repeats. Returns true when valid.
function validTieBreakOrder(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const t of value) {
    if (!isStr(t) || !TIE_BREAK_TOKENS.includes(t) || seen.has(t)) return false;
    seen.add(t);
  }
  return true;
}

function checkPeriods(model, periods, errs) {
  if (!isObj(periods)) return errs.add('periods');
  if (!PERIOD_FIELDS[model]) return undefined;
  for (const f of PERIOD_FIELDS[model]) {
    const v = periods[f];
    if (!isInt(v) || v < 1 || (f === 'best_of' && v % 2 === 0)) errs.add(`periods.${f}`);
  }
  return undefined;
}

function checkScoringEvent(model, key, def, errs) {
  const base = `scoring_events.${key}`;
  if (!isObj(def)) return errs.add(base);
  if (model === 'event' && (!isInt(def.points) || def.points < 1)) errs.add(`${base}.points`);
  if (model === 'round' && (!isInt(def.rounds) || def.rounds < 1)) errs.add(`${base}.rounds`);
  if (model === 'innings') {
    if (!isInt(def.runs) || def.runs < 0) errs.add(`${base}.runs`);
    if (!isBool(def.legal_ball)) errs.add(`${base}.legal_ball`);
    if (!isBool(def.wicket)) errs.add(`${base}.wicket`);
  }
  return undefined;
}

function checkScoringEvents(model, events, errs) {
  if (!isObj(events) || Object.keys(events).length === 0) return errs.add('scoring_events');
  for (const [key, def] of Object.entries(events)) {
    if (!EVENT_KEY_RE.test(key)) {
      errs.add('scoring_events');
      continue;
    }
    checkScoringEvent(model, key, def, errs);
  }
  return undefined;
}

function checkOvertime(overtime, errs) {
  if (!isObj(overtime)) return errs.add('overtime');
  if (!OVERTIME_POLICIES.includes(overtime.policy)) errs.add('overtime.policy');
  if (overtime.duration_minutes !== undefined && (!isInt(overtime.duration_minutes) || overtime.duration_minutes < 0)) {
    errs.add('overtime.duration_minutes');
  }
  return undefined;
}

function checkRoster(roster, errs) {
  if (!isObj(roster)) return errs.add('roster');
  const { min_squad_size: min, max_squad_size: max, required_positions: req } = roster;
  const minOk = isInt(min) && min >= 1;
  const maxOk = isInt(max) && max >= 1;
  if (!minOk) errs.add('roster.min_squad_size');
  if (!maxOk) errs.add('roster.max_squad_size');
  if (minOk && maxOk && min > max) {
    errs.add('roster.min_squad_size');
    errs.add('roster.max_squad_size');
  }
  if (!isObj(req)) errs.add('roster.required_positions');
  else {
    for (const [pos, n] of Object.entries(req)) {
      if (!isInt(n) || n < 0) errs.add(`roster.required_positions.${pos}`);
    }
  }
  return undefined;
}

// Returns { ok, fields, config }. config is the normalised config to store (known fields only).
function validateSportConfig(body) {
  const errs = new FieldErrors();
  if (!isObj(body)) return { ok: false, fields: ['body'], config: null };

  if (!isStr(body.sport_id) || !SPORT_ID_RE.test(body.sport_id)) errs.add('sport_id');
  if (!isStr(body.name) || body.name.length < 1 || body.name.length > 80) errs.add('name');
  const model = body.scoring_model;
  if (!SCORING_MODELS.includes(model)) errs.add('scoring_model');
  checkPeriods(model, body.periods, errs);
  checkScoringEvents(model, body.scoring_events, errs);
  if (!isBool(body.draw_allowed)) errs.add('draw_allowed');
  checkOvertime(body.overtime, errs);
  if (body.tie_break_order !== undefined && !validTieBreakOrder(body.tie_break_order)) errs.add('tie_break_order');
  checkRoster(body.roster, errs);

  if (!errs.ok) return { ok: false, fields: errs.list, config: null };

  const config = {
    sport_id: body.sport_id,
    name: body.name,
    scoring_model: model,
    periods: body.periods,
    scoring_events: body.scoring_events,
    draw_allowed: body.draw_allowed,
    overtime: body.overtime,
    tie_break_order: body.tie_break_order === undefined ? [...TIE_BREAK_TOKENS] : body.tie_break_order,
    roster: body.roster,
  };
  return { ok: true, fields: [], config };
}

module.exports = { validateSportConfig, validTieBreakOrder };
