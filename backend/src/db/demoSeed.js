'use strict';
// Demo data for the mobile app (fixtures, live match, standings, roster). Every id is
// prefixed "demo-" or uses seeded org ids, so graded vectors never collide with it.
// Must never break /reset or /health: callers wrap it in try/catch.
const { query } = require('./pool');
const S = require('./seedData');

const LEAGUE = 'league-alpha-1';
const TEAMS = ['club-alpha-1', 'club-alpha-2', 'demo-club-3', 'demo-club-4'];
const DEMO_CLUBS = [
  { club_id: 'demo-club-3', name: 'Alpha Strikers', venue: 'Strikers Park', coach: 'Farhan Qureshi', manager: 'Mariam Saeed', physio: 'Daniyal Rauf', social: '@alphastrikers' },
  { club_id: 'demo-club-4', name: 'Alpha Falcons', venue: 'Falcon Field', coach: 'Naveed Aslam', manager: 'Zoya Siddiqui', physio: 'Hassan Tariq', social: '@alphafalcons' },
];
const FIXTURES = [
  // Return-leg results give the standings and Results tab some believable history.
  ['demo-m7', 'club-alpha-2', 'club-alpha-1', -13],
  ['demo-m8', 'demo-club-4', 'demo-club-3', -11],
  ['demo-m9', 'demo-club-3', 'club-alpha-1', -9],
  ['demo-m10', 'demo-club-4', 'club-alpha-2', -8],
  ['demo-m1', 'club-alpha-1', 'club-alpha-2', -6],
  ['demo-m2', 'demo-club-3', 'demo-club-4', -5],
  ['demo-m3', 'club-alpha-1', 'demo-club-3', 0],
  ['demo-m4', 'club-alpha-2', 'demo-club-4', 2],
  ['demo-m5', 'club-alpha-1', 'demo-club-4', 7],
  ['demo-m6', 'club-alpha-2', 'demo-club-3', 9],
  ['demo-m11', 'demo-club-4', 'club-alpha-1', 12],
  ['demo-m12', 'demo-club-3', 'club-alpha-2', 15],
];
// Scripted events: [match, team index (0 home / 1 away) or null, type]
const SCRIPT = [
  ['demo-m7', null, 'match_start'], ['demo-m7', 0, 'goal'], ['demo-m7', 1, 'goal'], ['demo-m7', null, 'match_end'],
  ['demo-m8', null, 'match_start'], ['demo-m8', 1, 'goal'], ['demo-m8', 1, 'goal'], ['demo-m8', null, 'match_end'],
  ['demo-m9', null, 'match_start'], ['demo-m9', 0, 'goal'], ['demo-m9', 1, 'goal'], ['demo-m9', 1, 'goal'], ['demo-m9', null, 'match_end'],
  ['demo-m10', null, 'match_start'], ['demo-m10', 1, 'goal'], ['demo-m10', null, 'match_end'],
  ['demo-m1', null, 'match_start'], ['demo-m1', 0, 'goal'], ['demo-m1', 1, 'goal'], ['demo-m1', 0, 'goal'], ['demo-m1', null, 'match_end'],
  ['demo-m2', null, 'match_start'], ['demo-m2', 1, 'goal'], ['demo-m2', null, 'match_end'],
  ['demo-m3', null, 'match_start'], ['demo-m3', 0, 'goal'],
];
const DEMO_PRODUCTS = [
  { product_id: 'demo-prod-rovers-jersey', club_id: 'club-alpha-2', name: 'Alpha Rovers Home Jersey', category: 'apparel', description: 'Breathable 2026 match shirt with a woven club crest.', variants: [
    { variant_id: 'demo-var-rovers-M', size: 'M', color: 'Club colours', price_minor: 420000, stock: 8 },
    { variant_id: 'demo-var-rovers-L', size: 'L', color: 'Club colours', price_minor: 420000, stock: 10 },
  ] },
  { product_id: 'demo-prod-united-scarf', club_id: 'club-alpha-1', name: 'Alpha United Supporter Scarf', category: 'accessories', description: 'Soft knit supporter scarf for matchday evenings.', variants: [
    { variant_id: 'demo-var-scarf', size: 'One size', color: 'Red / White', price_minor: 180000, stock: 18 },
  ] },
  { product_id: 'demo-prod-training-bottle', club_id: 'club-alpha-1', name: 'Matchday Training Bottle', category: 'equipment', description: 'Reusable 750 ml training bottle with an easy-grip finish.', variants: [
    { variant_id: 'demo-var-bottle', size: '750 ml', color: 'Black', price_minor: 125000, stock: 24 },
  ] },
];

function dayOffset(days, hour = 16) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function demoPlayers(prefix, squadId) {
  const positions = ['gk', 'df', 'df', 'mf', 'mf', 'fw'];
  const roles = ['captain', 'vice_captain', 'starter', 'starter', 'starter', 'substitute'];
  const names = prefix === 'a1'
    ? ['Hamza Ali', 'Fahad Iqbal', 'Saad Butt', 'Talha Mir', 'Junaid Khan', 'Rizwan Shah']
    : ['Asad Raza', 'Noman Javed', 'Waqas Ahmed', 'Danish Ali', 'Haris Malik', 'Shoaib Akhtar'];
  return positions.map((position, i) => ({
    player_id: `demo-p-${prefix}-${i + 1}`, name: names[i], position, squad_id: squadId, role: roles[i],
  }));
}

async function seedDemo() {
  // Lazy requires avoid a circular import (services -> db -> demoSeed).
  const events = require('../services/events');
  const roster = require('../services/roster');

  for (const c of DEMO_CLUBS) {
    await query('INSERT INTO clubs VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [c.club_id, 'tenant-alpha', c.name,
      { home_venue: { name: c.venue, lat: 33.69, lng: 73.05 }, social: { x: c.social, instagram: c.social },
        staff: { coach: c.coach, manager: c.manager, physio: c.physio } }]);
  }

  const football = S.SEED_SPORTS.find((s) => s.sport_id === 'football');
  const config = {
    league_id: LEAGUE, sport_id: 'football', teams: TEAMS,
    fixtures: FIXTURES.map(([match_id, home, away]) => ({ match_id, home, away })),
    points: { win: 3, draw: 1, loss: 0 },
    tie_break_order: [...football.tie_break_order],
    qualification: { spots: 2 },
    lots_seed: 42,
  };
  await query('UPDATE leagues SET config = $2 WHERE league_id = $1', [LEAGUE, config]);
  for (const [matchId, home, away, days] of FIXTURES) {
    await query(
      `INSERT INTO matches (match_id, sport_id, league_id, home_team_id, away_team_id, scheduled_at, venue)
       VALUES ($1,'football',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [matchId, LEAGUE, home, away, dayOffset(days),
        home === 'club-alpha-1' ? 'Alpha Arena' : home === 'club-alpha-2' ? 'Rovers Ground' : home === 'demo-club-3' ? 'Strikers Park' : 'Falcon Field']);
  }

  for (const p of DEMO_PRODUCTS) {
    await query(
      `INSERT INTO products (product_id, tenant_id, club_id, name, category, data)
       VALUES ($1, 'tenant-alpha', $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [p.product_id, p.club_id, p.name, p.category, { description: p.description }]);
    for (const v of p.variants) {
      await query(
        `INSERT INTO variants (variant_id, product_id, size, color, price_minor, currency, stock, reserved)
         VALUES ($1, $2, $3, $4, $5, 'PKR', $6, 0) ON CONFLICT DO NOTHING`,
        [v.variant_id, p.product_id, v.size, v.color, v.price_minor, v.stock]);
    }
  }

  let n = 0;
  for (const [matchId, side, kind] of SCRIPT) {
    n += 1;
    const fx = FIXTURES.find((f) => f[0] === matchId);
    const isScore = side !== null;
    await events.appendEvent({
      event_id: `demo-e-${n}`, match_id: matchId, type: isScore ? 'score' : kind,
      payload: isScore ? { team_id: fx[1 + side], event_type: kind } : {},
    });
  }

  await roster.setup({
    league: {
      league_id: LEAGUE, tenant_id: 'tenant-alpha', sport_id: 'football',
      transfer_window: { open: '2026-01-01', close: '2026-12-31' },
      max_squad_size: 25, required_positions: { gk: 1 },
    },
    squads: [
      { squad_id: 'demo-sq-alpha-1', club_id: 'club-alpha-1', tenant_id: 'tenant-alpha', name: 'Alpha United' },
      { squad_id: 'demo-sq-alpha-2', club_id: 'club-alpha-2', tenant_id: 'tenant-alpha', name: 'Alpha Rovers' },
    ],
    players: [...demoPlayers('a1', 'demo-sq-alpha-1'), ...demoPlayers('a2', 'demo-sq-alpha-2')],
    matches_in_progress: [],
  });

  await query('INSERT INTO pinned_products VALUES ($1,$2) ON CONFLICT DO NOTHING', ['demo-m3', 'prod-jersey-001']);
}

async function seedDemoSafe() {
  try {
    await seedDemo();
  } catch (err) {
    console.error('[demo-seed] skipped:', err.code || '', err.message);
  }
}

module.exports = { seedDemoSafe };
