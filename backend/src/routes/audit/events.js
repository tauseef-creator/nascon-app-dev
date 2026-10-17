'use strict';
// POST /audit/v1/events, GET /audit/v1/score/:match_id (spec 5.9). Logic lives in services/events.js.
const express = require('express');
const { appendEvent, getScore } = require('../../services/events');

const router = express.Router();

router.post('/events', async (req, res) => {
  const result = await appendEvent(req.body);
  res.status(result.statusCode).json(result.body);
});

router.get('/score/:match_id', async (req, res) => {
  res.status(200).json(await getScore(req.params.match_id));
});

module.exports = router;
