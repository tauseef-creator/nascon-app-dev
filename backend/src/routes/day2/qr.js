'use strict';
// Spec Part II 5.6: dynamic QR metadata and exports (mounted under /audit/v1).
const express = require('express');
const qr = require('../../services/day2/qr');

const router = express.Router();

router.get('/qr/:entity_id/export.:fmt', async (req, res) => {
  const out = await qr.exportQr(req.params.entity_id, req.params.fmt);
  res.status(200)
    .set('Content-Type', out.contentType)
    .set('Content-Disposition', `inline; filename="${out.filename}"`)
    .set('Cache-Control', 'no-store')
    .send(typeof out.body === 'string' ? out.body : Buffer.from(out.body));
});

router.get('/qr/:entity_id', async (req, res) => {
  const inspect = String(req.query.inspect ?? '').toLowerCase() === 'true';
  const body = await qr.resolveEntity(req.params.entity_id, { inspect, userAgent: req.get('user-agent') || '' });
  res.status(200).set('Cache-Control', 'no-store').json(body);
});

module.exports = router;
