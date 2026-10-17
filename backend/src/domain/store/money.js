'use strict';
// Money math in integer minor units (paisa).

// items: [{ quantity, unit_price_minor }], discountPercent: integer 0..100 (0 when no code).
function computeTotals(items, discountPercent = 0) {
  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unit_price_minor, 0);
  const discount = Math.floor((subtotal * (discountPercent || 0)) / 100);
  return { subtotal_minor: subtotal, discount_minor: discount, total_minor: subtotal - discount };
}

// 450000 -> "PKR 4500.00" (major units, two decimals, no thousands separator).
function formatPkr(minor) {
  const n = Math.trunc(Number(minor) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const major = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `PKR ${sign}${major}.${cents}`;
}

module.exports = { computeTotals, formatPkr };
