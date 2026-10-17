'use strict';
// Roster domain (spec 5.11): pure functions only, no DB or HTTP.
module.exports = { ...require('./validate'), ...require('./rules') };
