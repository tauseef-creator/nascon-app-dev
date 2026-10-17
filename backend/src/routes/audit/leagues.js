'use strict';
// POST /audit/v1/leagues: register a standings league and one match stream per fixture (spec 5.8).
const express = require('express');
const { tx } = require('../../db/pool');
const { getLotsSeed } = require('../../db/reset');
const { validation, notFound, conflict } = require('../../lib/errors');
const { validateLeagueBody, duplicateFixtureId, TIE_BREAK_TOKENS } = require('../../domain/scoring');

const router = express.Router();

const matchExists = (id) => conflict('MATCH_EXISTS', `Match ${id} already exists.`, { match_id: id });

router.post('/leagues', async (req, res) => {
  const v = validateLeagueBody(req.body);
  if (!v.ok) throw validation(v.fields);
  const lg = v.value;

  const result = await tx(async (c) => {
    // Serialize league registrations so concurrent requests see each other's ids.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('leagues-register'))");
    const sp = await c.query('SELECT config FROM sports WHERE sport_id = $1', [lg.sport_id]);
    if (!sp.rows.length) throw notFound('SPORT_NOT_FOUND', `Sport ${lg.sport_id} not found.`, { sport_id: lg.sport_id });
    const sport = sp.rows[0].config;

    const ex = await c.query('SELECT 1 FROM leagues WHERE league_id = $1', [lg.league_id]);
    if (ex.rows.length) throw conflict('LEAGUE_EXISTS', `League ${lg.league_id} already exists.`, { league_id: lg.league_id });
    const dupInBody = duplicateFixtureId(lg.fixtures);
    if (dupInBody) throw matchExists(dupInBody);
    const ids = lg.fixtures.map((f) => f.match_id);
    if (ids.length) {
      const used = await c.query('SELECT match_id FROM matches WHERE match_id = ANY($1::text[]) ORDER BY match_id', [ids]);
      if (used.rows.length) {
        const first = ids.find((id) => used.rows.some((r) => r.match_id === id));
        throw matchExists(first);
      }
    }

    const config = {
      league_id: lg.league_id,
      sport_id: lg.sport_id,
      teams: lg.teams,
      fixtures: lg.fixtures,
      points: lg.points,
      tie_break_order: lg.tie_break_order
        || (Array.isArray(sport.tie_break_order) ? [...sport.tie_break_order] : [...TIE_BREAK_TOKENS]),
      qualification: lg.qualification,
      lots_seed: lg.lots_seed === null ? await getLotsSeed(c) : lg.lots_seed,
    };
    await c.query('INSERT INTO leagues (league_id, tenant_id, sport_id, name, config) VALUES ($1, NULL, $2, $3, $4)',
      [lg.league_id, lg.sport_id, lg.name, config]);
    for (const f of lg.fixtures) {
      // ON CONFLICT guards against a concurrent stand-alone match_init with the same id.
      const ins = await c.query(
        `INSERT INTO matches (match_id, sport_id, league_id, home_team_id, away_team_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (match_id) DO NOTHING`,
        [f.match_id, lg.sport_id, lg.league_id, f.home, f.away]);
      if (ins.rowCount === 0) throw matchExists(f.match_id);
    }
    return { league_id: lg.league_id, status: 'created', team_count: lg.teams.length, fixture_count: lg.fixtures.length };
  });
  res.status(201).json(result);
});

module.exports = router;
