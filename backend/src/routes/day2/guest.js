'use strict';
// Spec Part II 5.7: guest write-block verification and progressive cart merge (mounted under /audit/v1).
const express = require('express');
const guest = require('../../services/day2/guest');

const router = express.Router();

router.post('/guest/cart-merge', async (req, res) => {
  const out = await guest.mergeGuestCart(req.body);
  res.status(out.statusCode).json(out.body);
});

module.exports = router;
