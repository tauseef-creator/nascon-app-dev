'use strict';
// GET /audit/v1/standings/:league_id (spec 5.10). Recomputed from the event logs on every call.
const express = require('express');
const { query } = require('../../db/pool');
const { getLotsSeed } = require('../../db/reset');
const { notFound } = require('../../lib/errors');
const { isId } = require('../../lib/validate');
const { computeStandings } = require('../../domain/standings');

const router = express.Router();

const leagueNotFound = (id) => notFound('LEAGUE_NOT_FOUND', `League ${id} does not exist.`, { league_id: id });

router.get('/standings/:league_id', async (req, res) => {
  const leagueId = req.params.league_id;
  if (!isId(leagueId)) throw leagueNotFound(leagueId);

  const lr = await query('SELECT league_id, sport_id, config FROM leagues WHERE league_id = $1', [leagueId]);
  const row = lr.rows[0];
  const cfg = row && row.config;
  if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.teams) || !Array.isArray(cfg.fixtures)) {
    throw leagueNotFound(leagueId);
  }
  const sportId = cfg.sport_id || row.sport_id;

  const sr = await query('SELECT config FROM sports WHERE sport_id = $1', [sportId]);
  const sport = (sr.rows[0] && sr.rows[0].config) || {};

  const matchIds = cfg.fixtures.map((f) => f.match_id);
  const [mr, er] = await Promise.all([
    query('SELECT match_id, sport_id, league_id, home_team_id, away_team_id FROM matches WHERE match_id = ANY($1)', [matchIds]),
    query(
      'SELECT match_id, sequence, event_id, type, payload FROM match_events WHERE match_id = ANY($1) ORDER BY match_id, sequence',
      [matchIds],
    ),
  ]);
  const matches = new Map(mr.rows.map((m) => [m.match_id, m]));
  const eventsByMatch = new Map();
  for (const e of er.rows) {
    if (!eventsByMatch.has(e.match_id)) eventsByMatch.set(e.match_id, []);
    eventsByMatch.get(e.match_id).push({ sequence: e.sequence, event_id: e.event_id, type: e.type, payload: e.payload });
  }

  const { projectMatch } = require('../../domain/scoring');
  const projections = {};
  for (const f of cfg.fixtures) {
    const match = matches.get(f.match_id) || {
      match_id: f.match_id, sport_id: sportId, league_id: leagueId, home_team_id: f.home, away_team_id: f.away,
    };
    projections[f.match_id] = projectMatch(sport, eventsByMatch.get(f.match_id) || [], match);
  }

  const lotsSeed = Number.isInteger(cfg.lots_seed) ? cfg.lots_seed : await getLotsSeed();
  const league = { ...cfg, league_id: row.league_id, sport_id: sportId };
  res.status(200).json(computeStandings({ league, sport, projections, lotsSeed }));
});

module.exports = router;
