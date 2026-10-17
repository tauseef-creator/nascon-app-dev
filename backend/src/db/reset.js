'use strict';
const bcrypt = require('bcryptjs');
const { pool, tx } = require('./pool');
const { SCHEMA, RESET_TABLES } = require('./schema');
const S = require('./seedData');

let passwordHash = null;
let seeded = false;

async function migrate() {
  await pool.query(SCHEMA);
}

// Wipes all state and re-creates the baseline. Repeatable: identical state every call.
async function resetAndSeed({ seed = 42, stock = {} } = {}) {
  if (!passwordHash) passwordHash = await bcrypt.hash(S.DEMO_PASSWORD, 8);
  const finalStock = { ...S.DEFAULT_STOCK, ...stock };
  await tx(async (c) => {
    await c.query(`TRUNCATE ${RESET_TABLES.join(', ')} RESTART IDENTITY`);
    for (const t of S.TENANTS) {
      await c.query('INSERT INTO tenants VALUES ($1,$2,$3,$4,$5)',
        [t.tenant_id, t.name, t.logo_url, t.primary_color, t.secondary_color]);
    }
    for (const sp of S.SEED_SPORTS) {
      await c.query('INSERT INTO sports (sport_id, config) VALUES ($1,$2)', [sp.sport_id, sp]);
    }
    for (const l of S.LEAGUES) {
      await c.query('INSERT INTO leagues (league_id, tenant_id, sport_id, name, config) VALUES ($1,$2,$3,$4,NULL)',
        [l.league_id, l.tenant_id, l.sport_id, l.name]);
    }
    for (const cl of S.CLUBS) {
      await c.query('INSERT INTO clubs VALUES ($1,$2,$3,$4)', [cl.club_id, cl.tenant_id, cl.name, cl.data]);
    }
    for (const p of S.PLAYERS) {
      await c.query('INSERT INTO players VALUES ($1,$2,$3,$4,$5,$6)',
        [p.player_id, p.tenant_id, p.club_id, p.name, p.position, {}]);
    }
    for (const u of S.USERS) {
      await c.query(
        `INSERT INTO users (user_id, email, password_hash, role, tenant_id, league_id, club_id, player_id, display_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [u.user_id, u.email, passwordHash, u.role, u.tenant_id || null, u.league_id || null,
          u.club_id || null, u.player_id || null, u.display_name]);
    }
    for (const p of S.PRODUCTS) {
      await c.query('INSERT INTO products VALUES ($1,$2,$3,$4,$5,$6)',
        [p.product_id, p.tenant_id, p.club_id, p.name, p.category, p.data]);
    }
    for (const v of S.VARIANTS) {
      await c.query(
        'INSERT INTO variants (variant_id, product_id, size, color, price_minor, currency, stock, reserved) VALUES ($1,$2,$3,$4,$5,$6,$7,0)',
        [v.variant_id, v.product_id, v.size, v.color, v.price_minor, 'PKR', finalStock[v.variant_id] ?? 0]);
    }
    for (const d of S.DISCOUNTS) await c.query('INSERT INTO discount_codes VALUES ($1,$2)', [d.code, d.percent]);
    await c.query("INSERT INTO app_state VALUES ('lots_seed', $1)", [JSON.stringify(seed)]);
  });
  seeded = true;
  return {
    status: 'reset_complete',
    seed,
    sports: S.SEED_SPORTS.map((s) => s.sport_id),
    tenants: S.TENANTS.map((t) => t.tenant_id),
    stock: Object.fromEntries(S.VARIANTS.map((v) => [v.variant_id, finalStock[v.variant_id] ?? 0])),
  };
}

async function getLotsSeed(client = pool) {
  const r = await client.query("SELECT value FROM app_state WHERE key = 'lots_seed'");
  return r.rows.length ? Number(r.rows[0].value) : 42;
}

async function isHealthy() {
  if (!seeded) return false;
  try {
    const r = await pool.query("SELECT 1 FROM tenants WHERE tenant_id = 'tenant-alpha'");
    return r.rowCount === 1;
  } catch {
    return false;
  }
}

module.exports = { migrate, resetAndSeed, getLotsSeed, isHealthy };
