'use strict';
// Spec Part II 5.9 / NFR-9: right-to-erasure probe (mounted under /audit/v1).
const express = require('express');
const privacy = require('../../services/day2/privacy');

const router = express.Router();

router.delete('/privacy/user/:user_id', async (req, res) => {
  res.status(200).json(await privacy.eraseUser(req.params.user_id));
});

module.exports = router;
