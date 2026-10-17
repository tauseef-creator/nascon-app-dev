'use strict';
// POST /audit/v1/fixtures dispatcher: validates {format, teams, params} and runs the generator.

const { validation } = require('../../lib/errors');
const { isObj, isId } = require('../../lib/validate');
const { roundRobin } = require('./roundRobin');
const { swiss } = require('./swiss');
const { singleElim } = require('./singleElim');
const { doubleElim } = require('./doubleElim');

const FORMATS = {
  round_robin: { min: 2, max: 40, run: roundRobin },
  swiss: { min: 2, max: 64, run: swiss },
  single_elim: { min: 2, max: 128, run: singleElim },
  double_elim: { min: 3, max: 128, run: doubleElim },
};

function generateFixtures(body) {
  if (!isObj(body)) throw validation(['body']);
  const bad = [];
  const fmt = typeof body.format === 'string' && Object.prototype.hasOwnProperty.call(FORMATS, body.format)
    ? FORMATS[body.format]
    : null;
  if (!fmt) bad.push('format');
  const teams = body.teams;
  if (!Array.isArray(teams) || !teams.every(isId) || new Set(teams).size !== teams.length) bad.push('teams');
  else if (fmt && (teams.length < fmt.min || teams.length > fmt.max)) bad.push('teams');
  const params = body.params === undefined || body.params === null ? {} : body.params;
  if (!isObj(params)) bad.push('params');
  if (bad.length) throw validation(bad);
  return fmt.run(teams.slice(), params);
}

module.exports = { generateFixtures, FORMATS };
