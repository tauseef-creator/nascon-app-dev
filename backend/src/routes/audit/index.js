'use strict';
const express = require('express');
const { resetAndSeed } = require('../../db/reset');
const { seedDemoSafe } = require('../../db/demoSeed');
const { seedDay2 } = require('../../db/day2Seed');
const { validation } = require('../../lib/errors');
const { isObj, isInt } = require('../../lib/validate');

const router = express.Router();

router.post('/reset', async (req, res) => {
  const body = isObj(req.body) ? req.body : {};
  const bad = [];
  if (body.seed !== undefined && body.seed !== null && !isInt(body.seed)) bad.push('seed');
  if (body.stock !== undefined && body.stock !== null) {
    if (!isObj(body.stock)) bad.push('stock');
    else for (const [k, v] of Object.entries(body.stock)) if (!isInt(v) || v < 0) bad.push(`stock.${k}`);
  }
  if (bad.length) throw validation(bad);
  const result = await resetAndSeed({ seed: body.seed ?? 42, stock: body.stock || {} });
  await seedDay2();
  require('../../services/day2/moderation').resetRateLimits?.();
  require('../../services/day2/qr').clearQrCache?.();
  await seedDemoSafe();
  res.status(200).json(result);
});

router.use(require('./sports'));
router.use(require('./fixtures'));
router.use(require('./leagues'));
router.use(require('./events'));
router.use(require('./standings'));
router.use(require('./roster'));
router.use(require('./store'));
router.use(require('./rbac'));
router.use(require('./offlineSync'));
// Phase II audit contract
for (const r of ['streaming', 'costream', 'qr', 'guest', 'moderation', 'privacy']) router.use(require(`../day2/${r}`));

module.exports = router;
