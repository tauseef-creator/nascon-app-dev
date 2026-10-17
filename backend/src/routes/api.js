'use strict';
const express = require('express');

const router = express.Router();

// Rate-limit probe (5.13). The limiter is mounted in app.js for all /api/v1 routes.
router.get('/ping', (req, res) => res.status(200).json({ pong: true }));

module.exports = router;
