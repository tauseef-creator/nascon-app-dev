'use strict';
// Roster endpoints (spec 5.11). All logic lives in services/roster.js (shared with offline sync).
const express = require('express');
const roster = require('../../services/roster');

const router = express.Router();

router.post('/roster/setup', async (req, res) => {
  const out = await roster.setup(req.body);
  res.status(out.statusCode).json(out.body);
});

router.post('/roster/transfer', async (req, res) => {
  const out = await roster.applyTransfer(req.body);
  res.status(out.statusCode).json(out.body);
});

router.get('/roster/history/:player_id', async (req, res) => {
  const out = await roster.history(req.params.player_id, req.query.as_of);
  res.status(out.statusCode).json(out.body);
});

module.exports = router;
