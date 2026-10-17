'use strict';
const express = require('express');
const { generateFixtures } = require('../../domain/fixtures');

const router = express.Router();

// Spec 5.7: pure computation, stores nothing.
router.post('/fixtures', (req, res) => {
  res.status(200).json(generateFixtures(req.body));
});

module.exports = router;
