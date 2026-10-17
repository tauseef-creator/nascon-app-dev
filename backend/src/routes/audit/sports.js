'use strict';
// POST /audit/v1/sports: mystery sport from JSON (spec 5.6).
const express = require('express');
const { query } = require('../../db/pool');
const { validation, conflict } = require('../../lib/errors');
const { validateSportConfig } = require('../../domain/scoring');

const router = express.Router();

router.post('/sports', async (req, res) => {
  const v = validateSportConfig(req.body);
  if (!v.ok) throw validation(v.fields);
  const r = await query(
    'INSERT INTO sports (sport_id, config) VALUES ($1, $2) ON CONFLICT (sport_id) DO NOTHING',
    [v.config.sport_id, v.config]);
  if (r.rowCount === 0) {
    throw conflict('SPORT_EXISTS', `Sport ${v.config.sport_id} already exists.`, { sport_id: v.config.sport_id });
  }
  res.status(201).json({ sport_id: v.config.sport_id, status: 'created', config: v.config });
});

module.exports = router;
