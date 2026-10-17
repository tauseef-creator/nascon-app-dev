'use strict';
// Scoring domain: pure functions only (no DB, no HTTP).
const constants = require('./constants');
const { validateSportConfig, validTieBreakOrder } = require('./sportConfig');
const { validateLeagueBody, duplicateFixtureId, DEFAULT_POINTS } = require('./league');
const { validateEventBody } = require('./eventSchema');
const { projectMatch, toScoreResponse, formatOvers, modelLimits, compensationMap } = require('./projection');
const { validateEventAgainstState } = require('./rules');

module.exports = {
  ...constants,
  validateSportConfig,
  validTieBreakOrder,
  validateLeagueBody,
  duplicateFixtureId,
  DEFAULT_POINTS,
  validateEventBody,
  projectMatch,
  toScoreResponse,
  formatOvers,
  modelLimits,
  compensationMap,
  validateEventAgainstState,
};
