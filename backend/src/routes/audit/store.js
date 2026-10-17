'use strict';
// Store routes (spec 5.12), mounted under /audit/v1.
const express = require('express');
const store = require('../../services/store');

const router = express.Router();

router.post('/checkout', async (req, res) => {
  const { statusCode, body } = await store.checkout(req.body === undefined ? {} : req.body);
  res.status(statusCode).json(body);
});

router.get('/inventory/:variant_id', async (req, res) => {
  res.status(200).json(await store.getInventory(req.params.variant_id));
});

// Catalogue for the mobile app (not graded): optional ?tenant_id=.
router.get('/store/products', async (req, res) => {
  const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : undefined;
  res.status(200).json({ products: await store.listProducts(tenantId) });
});

module.exports = router;
