'use strict';
// Demo data for the mobile app: a half-played double round-robin season in league-alpha-1
// (8 clubs), one live match, one postponed match, full squads and a small club store.
// Every id is prefixed "demo-" or uses seeded org ids, so graded vectors never collide with it.
// Deterministic (seeded RNG) so every /reset produces the same season.
// Must never break /reset or /health: callers wrap it in try/catch.
const { query } = require('./pool');
const S = require('./seedData');

const LEAGUE = 'league-alpha-1';

const CLUBS = [
  { club_id: 'club-alpha-1', short: 'au', name: 'Alpha United', venue: 'Alpha Arena', lat: 33.6844, lng: 73.0479, seeded: true },
  { club_id: 'club-alpha-2', short: 'ar', name: 'Alpha Rovers', venue: 'Rovers Ground', lat: 33.7, lng: 73.06, seeded: true },
  { club_id: 'demo-club-3', short: 'as', name: 'Alpha Strikers', venue: 'Strikers Park', lat: 33.6518, lng: 73.0827,
    coach: 'Farhan Qureshi', manager: 'Mariam Saeed', physio: 'Daniyal Rauf', social: '@alphastrikers' },
  { club_id: 'demo-club-4', short: 'af', name: 'Alpha Falcons', venue: 'Falcon Field', lat: 33.7104, lng: 73.0263,
    coach: 'Naveed Aslam', manager: 'Zoya Siddiqui', physio: 'Hassan Tariq', social: '@alphafalcons' },
  { club_id: 'demo-club-5', short: 'ml', name: 'Margalla Lions', venue: 'Margalla Stadium', lat: 33.7386, lng: 73.0742,
    coach: 'Kashif Mehmood', manager: 'Sana Javed', physio: 'Bilal Ahmad', social: '@margallalions' },
  { club_id: 'demo-club-6', short: 'rr', name: 'Rawal Rangers', venue: 'Rawal Lake Ground', lat: 33.7033, lng: 73.1226,
    coach: 'Tariq Lutfi', manager: 'Hira Khalid', physio: 'Usman Ghani', social: '@rawalrangers' },
  { club_id: 'demo-club-7', short: 'pp', name: 'Potohar Panthers', venue: 'Potohar Park', lat: 33.5651, lng: 73.0169,
    coach: 'Imtiaz Hussain', manager: 'Areeba Naz', physio: 'Faisal Kamal', social: '@potoharpanthers' },
  { club_id: 'demo-club-8', short: 'cc', name: 'Capital City FC', venue: 'Capital Sports Complex', lat: 33.6938, lng: 73.0652,
    coach: 'Shahid Afridi Jr', manager: 'Nida Yasir', physio: 'Omer Farooq', social: '@capitalcityfc' },
];

const FIRST = ['Hamza', 'Fahad', 'Saad', 'Talha', 'Junaid', 'Rizwan', 'Asad', 'Noman', 'Waqas', 'Danish', 'Haris', 'Shoaib',
  'Ali', 'Umar', 'Bilal', 'Zain', 'Ahmed', 'Hassan', 'Usman', 'Kamran', 'Imran', 'Adeel', 'Faizan', 'Moiz'];
const LAST = ['Khan', 'Ali', 'Butt', 'Mir', 'Shah', 'Raza', 'Javed', 'Ahmed', 'Malik', 'Akhtar', 'Iqbal', 'Qureshi',
  'Chaudhry', 'Sheikh', 'Abbasi', 'Hashmi', 'Rana', 'Siddiqui'];
// 16-player squad: 2 GK, 5 DF, 5 MF, 4 FW.
const POSITIONS = ['gk', 'gk', 'df', 'df', 'df', 'df', 'df', 'mf', 'mf', 'mf', 'mf', 'mf', 'fw', 'fw', 'fw', 'fw'];

// Store (FR-2.3): apparel, accessories and digital items with variants.
const DEMO_PRODUCTS = [
  { product_id: 'demo-prod-rovers-jersey', club_id: 'club-alpha-2', name: 'Alpha Rovers Home Jersey', category: 'apparel',
    description: 'Breathable 2026 match shirt with a woven club crest.', variants: [
      ['demo-var-rovers-S', 'S', 'Black / White', 420000, 6], ['demo-var-rovers-M', 'M', 'Black / White', 420000, 8],
      ['demo-var-rovers-L', 'L', 'Black / White', 420000, 10], ['demo-var-rovers-XL', 'XL', 'Black / White', 420000, 0]] },
  { product_id: 'demo-prod-united-travel-shirt', club_id: 'club-alpha-1', name: 'Alpha United Travel Shirt', category: 'apparel',
    description: 'Smart grey button-up worn by the squad on away trips.', variants: [
      ['demo-var-travel-M', 'M', 'Grey', 440000, 9], ['demo-var-travel-L', 'L', 'Grey', 440000, 7],
      ['demo-var-travel-XL', 'XL', 'Grey', 440000, 4]] },
  { product_id: 'demo-prod-training-hoodie', club_id: 'club-alpha-1', name: 'Training Hoodie', category: 'apparel',
    description: 'Warm brushed-fleece hoodie worn by the squad in training.', variants: [
      ['demo-var-hoodie-navy-M', 'M', 'Navy', 560000, 5], ['demo-var-hoodie-navy-L', 'L', 'Navy', 560000, 2],
      ['demo-var-hoodie-grey-M', 'M', 'Grey', 560000, 6], ['demo-var-hoodie-grey-L', 'L', 'Grey', 560000, 3]] },
  { product_id: 'demo-prod-united-scarf', club_id: 'club-alpha-1', name: 'Alpha United Supporter Scarf', category: 'accessories',
    description: 'Soft knit supporter scarf for matchday evenings.', variants: [
      ['demo-var-scarf', 'One size', 'Red / White', 180000, 18]] },
  { product_id: 'demo-prod-supporter-cap', club_id: 'club-alpha-1', name: 'Supporter Cap', category: 'accessories',
    description: 'Adjustable six-panel cap with an embroidered crest.', variants: [
      ['demo-var-cap-red', 'One size', 'Red', 150000, 12], ['demo-var-cap-black', 'One size', 'Black', 150000, 2]] },
  { product_id: 'demo-prod-training-bottle', club_id: 'club-alpha-1', name: 'Matchday Training Bottle', category: 'accessories',
    description: 'Reusable 750 ml bottle with an easy-grip finish.', variants: [
      ['demo-var-bottle', '750 ml', 'Black', 125000, 24]] },
  { product_id: 'demo-prod-season-pass', club_id: 'club-alpha-1', name: 'Season Pass 2026', category: 'digital',
    description: 'Digital pass for every Alpha United home match this season.', variants: [
      ['demo-var-pass-standard', 'Standard', 'Digital', 1200000, 100], ['demo-var-pass-premium', 'Premium seat', 'Digital', 2400000, 20]] },
  { product_id: 'demo-prod-programme', club_id: 'club-alpha-1', name: 'Digital Matchday Programme', category: 'digital',
    description: 'Team news, interviews and stats for the next home match.', variants: [
      ['demo-var-programme', 'Single issue', 'Digital', 30000, 500]] },
];

// Deterministic PRNG (mulberry32) so every reset builds the same season.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Double round-robin by the circle method: returns [{round, home, away}].
function doubleRoundRobin(ids) {
  const n = ids.length;
  const rot = ids.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r += 1) {
    const list = [ids[0], ...rot];
    const pairs = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = list[i];
      const b = list[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    rot.unshift(rot.pop());
  }
  const out = [];
  rounds.forEach((pairs, r) => pairs.forEach(([h, a]) => out.push({ round: r + 1, home: h, away: a })));
  rounds.forEach((pairs, r) => pairs.forEach(([h, a]) => out.push({ round: n + r, home: a, away: h })));
  return out;
}

function kickoff(roundOffset, slot) {
  // Weekly rounds; current round (offset 0) is this week. Slots spread kick-offs over the weekend.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + roundOffset * 7 + (slot % 2));
  d.setUTCHours([11, 14, 11, 14][slot % 4], 0, 0, 0);
  return d.toISOString();
}

function squad(club, rand) {
  return POSITIONS.map((position, i) => {
    const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
    const role = i === 2 ? 'captain' : i === 7 ? 'vice_captain' : i < 13 ? 'starter' : 'substitute';
    return { player_id: `demo-p-${club.short}-${String(i + 1).padStart(2, '0')}`, name, position,
      squad_id: `demo-sq-${club.short}`, role };
  });
}

// ---- Basketball demo season (league-alpha-2) ----
const HOOPS_LEAGUE = 'league-alpha-2';
const HOOPS_CLUBS = [
  { club_id: 'demo-hoops-1', name: 'Islamabad Ballers', venue: 'Jinnah Sports Hall', coach: 'Adnan Riaz', manager: 'Rabia Hamid', physio: 'Saqib Noor', social: '@isbballers' },
  { club_id: 'demo-hoops-2', name: 'Rawalpindi Rockets', venue: 'Liaquat Arena', coach: 'Fawad Alam', manager: 'Mehwish Ali', physio: 'Noman Aziz', social: '@pindirockets' },
  { club_id: 'demo-hoops-3', name: 'Margalla Hawks', venue: 'Hawks Dome', coach: 'Junaid Iqbal', manager: 'Saba Qamar', physio: 'Hamza Tariq', social: '@margallahawks' },
  { club_id: 'demo-hoops-4', name: 'Capital Dunkers', venue: 'Capital Court', coach: 'Owais Shah', manager: 'Iqra Aziz', physio: 'Ali Raza', social: '@capitaldunkers' },
  { club_id: 'demo-hoops-5', name: 'Potohar Blaze', venue: 'Blaze Pavilion', coach: 'Sohail Khan', manager: 'Kinza Malik', physio: 'Umer Gul', social: '@potoharblaze' },
  { club_id: 'demo-hoops-6', name: 'Alpha Hoops Club', venue: 'Alpha Indoor Arena', coach: 'Babar Azam Jr', manager: 'Laiba Khan', physio: 'Zeeshan Ali', social: '@alphahoops' },
];

// Split a basketball score into scoring events (3s, 2s, free throws) defined by the sport config.
function basketPlays(points, rand) {
  const plays = [];
  let left = points;
  while (left > 0) {
    const r = rand();
    const kind = left >= 3 && r < 0.3 ? 'three_pointer' : left >= 2 && r < 0.85 ? 'two_pointer' : 'free_throw';
    plays.push(kind);
    left -= kind === 'three_pointer' ? 3 : kind === 'two_pointer' ? 2 : 1;
  }
  return plays;
}

// Bulk-append a match's events in one statement, with the same sequence, signature and stored
// response the events service would produce (much faster than one transaction per event).
async function bulkAppend(matchId, list, startId) {
  const { sign, canonical } = require('../lib/signing');
  const { requestHash } = require('../services/events');
  const values = [];
  const params = [];
  list.forEach((ev, i) => {
    const sequence = i + 1;
    const event = { event_id: `${startId}-${sequence}`, match_id: matchId, type: ev.type, payload: ev.payload || {} };
    const signature = sign(event.event_id, event.payload);
    const response = { event_id: event.event_id, match_id: matchId, type: event.type, sequence, match_version: sequence, signature };
    const b = params.length;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`);
    params.push(matchId, sequence, event.event_id, event.type, JSON.stringify(event.payload), canonical(event.payload),
      requestHash(event), signature, response);
  });
  await query(
    `INSERT INTO match_events (match_id, sequence, event_id, type, payload, payload_canonical, body_hash, signature, response)
     VALUES ${values.join(',')}`, params);
}

async function seedHoops(rand) {
  for (const c of HOOPS_CLUBS) {
    await query('INSERT INTO clubs VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [c.club_id, 'tenant-alpha', c.name,
      { home_venue: { name: c.venue, lat: 33.68, lng: 73.04 }, social: { x: c.social, instagram: c.social },
        staff: { coach: c.coach, manager: c.manager, physio: c.physio } }]);
  }
  const ids = HOOPS_CLUBS.map((c) => c.club_id);
  const venueOf = Object.fromEntries(HOOPS_CLUBS.map((c) => [c.club_id, c.venue]));
  const rounds = ids.length - 1;
  const schedule = doubleRoundRobin(ids).filter((f) => f.round <= rounds)
    .map((f, i) => ({ ...f, match_id: `demo-b${String(i + 1).padStart(2, '0')}` }));
  const CURRENT = 4; // rounds 1-3 played, round 4 this week, round 5 next week
  const basketball = S.SEED_SPORTS.find((x) => x.sport_id === 'basketball');
  await query('UPDATE leagues SET config = $2 WHERE league_id = $1', [HOOPS_LEAGUE, {
    league_id: HOOPS_LEAGUE, sport_id: 'basketball', teams: ids,
    fixtures: schedule.map(({ match_id, home, away }) => ({ match_id, home, away })),
    points: { win: 2, draw: 0, loss: 1 },
    tie_break_order: [...basketball.tie_break_order],
    qualification: { spots: 4 },
    lots_seed: 42,
  }]);
  const perRound = {};
  for (const f of schedule) {
    const slot = (perRound[f.round] = (perRound[f.round] || 0) + 1) - 1;
    await query(
      `INSERT INTO matches (match_id, sport_id, league_id, home_team_id, away_team_id, scheduled_at, venue)
       VALUES ($1,'basketball',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [f.match_id, HOOPS_LEAGUE, f.home, f.away, kickoff(f.round - CURRENT, slot + 1), venueOf[f.home]]);
  }
  const score = (team, pts) => basketPlays(pts, rand).map((k) => ({ type: 'score', payload: { team_id: team, event_type: k } }));
  for (const f of schedule.filter((x) => x.round < CURRENT)) {
    let hp = 68 + Math.floor(rand() * 30);
    let ap = 68 + Math.floor(rand() * 30);
    if (hp === ap) hp += 2; // no draws in basketball
    await bulkAppend(f.match_id, [{ type: 'match_start' }, ...score(f.home, hp), ...score(f.away, ap), { type: 'match_end' }], `demo-be-${f.match_id}`);
  }
  const live = schedule.find((x) => x.round === CURRENT);
  await bulkAppend(live.match_id, [{ type: 'match_start' }, ...score(live.home, 41), ...score(live.away, 38)], `demo-be-${live.match_id}`);
}

async function seedDemo() {
  // Lazy requires avoid a circular import (services -> db -> demoSeed).
  const events = require('../services/events');
  const roster = require('../services/roster');
  const rand = rng(2026);

  for (const c of CLUBS.filter((x) => !x.seeded)) {
    await query('INSERT INTO clubs VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [c.club_id, 'tenant-alpha', c.name,
      { home_venue: { name: c.venue, lat: c.lat, lng: c.lng }, social: { x: c.social, instagram: c.social },
        staff: { coach: c.coach, manager: c.manager, physio: c.physio } }]);
  }

  const venueOf = Object.fromEntries(CLUBS.map((c) => [c.club_id, c.venue]));
  const schedule = doubleRoundRobin(CLUBS.map((c) => c.club_id))
    .map((f, i) => ({ ...f, match_id: `demo-m${String(i + 1).padStart(2, '0')}` }));
  const CURRENT_ROUND = 8; // rounds 1-7 played, round 8 in progress this week, 9-14 to come

  const football = S.SEED_SPORTS.find((s) => s.sport_id === 'football');
  await query('UPDATE leagues SET config = $2 WHERE league_id = $1', [LEAGUE, {
    league_id: LEAGUE, sport_id: 'football', teams: CLUBS.map((c) => c.club_id),
    fixtures: schedule.map(({ match_id, home, away }) => ({ match_id, home, away })),
    points: { win: 3, draw: 1, loss: 0 },
    tie_break_order: [...football.tie_break_order],
    qualification: { spots: 4 },
    lots_seed: 42,
  }]);

  const perRound = {};
  for (const f of schedule) {
    const slot = (perRound[f.round] = (perRound[f.round] || 0) + 1) - 1;
    await query(
      `INSERT INTO matches (match_id, sport_id, league_id, home_team_id, away_team_id, scheduled_at, venue)
       VALUES ($1,'football',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [f.match_id, LEAGUE, f.home, f.away, kickoff(f.round - CURRENT_ROUND, slot), venueOf[f.home]]);
  }

  let n = 0;
  const append = (matchId, type, payload = {}) => {
    n += 1;
    return events.appendEvent({ event_id: `demo-e-${n}`, match_id: matchId, type, payload });
  };
  const goals = () => [0, 0, 1, 1, 1, 2, 2, 3][Math.floor(rand() * 8)];

  // Played rounds: start, goals, an occasional booking (fair play), end.
  for (const f of schedule.filter((x) => x.round < CURRENT_ROUND)) {
    await append(f.match_id, 'match_start');
    // Small bias so the demo users' club (Alpha United) is a title contender.
    const bias = (team) => (team === 'club-alpha-1' ? 1 : 0);
    const [hg, ag] = [goals() + bias(f.home), goals() + bias(f.away)];
    for (let g = 0; g < hg; g += 1) await append(f.match_id, 'score', { team_id: f.home, event_type: 'goal' });
    for (let g = 0; g < ag; g += 1) await append(f.match_id, 'score', { team_id: f.away, event_type: 'goal' });
    if (rand() < 0.3) await append(f.match_id, 'discipline', { team_id: rand() < 0.5 ? f.home : f.away, points: -1 });
    await append(f.match_id, 'match_end');
  }

  // Current round: Alpha United's match is live (1-0), one other match postponed.
  const current = schedule.filter((x) => x.round === CURRENT_ROUND);
  const live = current.find((x) => x.home === 'club-alpha-1' || x.away === 'club-alpha-1') || current[0];
  await append(live.match_id, 'match_start');
  await append(live.match_id, 'score', { team_id: live.home, event_type: 'goal' });
  const postponed = current.find((x) => x !== live);
  await query(
    `INSERT INTO match_status (match_id, status, reason, updated_by, history)
     VALUES ($1, 'postponed', 'Waterlogged pitch', 'user-organizer', $2) ON CONFLICT DO NOTHING`,
    [postponed.match_id, JSON.stringify([{ from: 'upcoming', to: 'postponed', reason: 'Waterlogged pitch',
      by: 'user-organizer', at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }])]);

  for (const p of DEMO_PRODUCTS) {
    await query(
      `INSERT INTO products (product_id, tenant_id, club_id, name, category, data)
       VALUES ($1, 'tenant-alpha', $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [p.product_id, p.club_id, p.name, p.category, { description: p.description, image: `products/${p.product_id}.jpg` }]);
    for (const [variantId, size, color, price, stock] of p.variants) {
      await query(
        `INSERT INTO variants (variant_id, product_id, size, color, price_minor, currency, stock, reserved)
         VALUES ($1, $2, $3, $4, $5, 'PKR', $6, 0) ON CONFLICT DO NOTHING`,
        [variantId, p.product_id, size, color, price, stock]);
    }
  }

  await roster.setup({
    league: {
      league_id: LEAGUE, tenant_id: 'tenant-alpha', sport_id: 'football',
      transfer_window: { open: '2026-01-01', close: '2026-12-31' },
      max_squad_size: 25, required_positions: { gk: 1 },
    },
    squads: CLUBS.map((c) => ({ squad_id: `demo-sq-${c.short}`, club_id: c.club_id, tenant_id: 'tenant-alpha', name: c.name })),
    players: CLUBS.flatMap((c) => squad(c, rand)),
    matches_in_progress: [],
  });

  await query('INSERT INTO pinned_products VALUES ($1,$2) ON CONFLICT DO NOTHING', [live.match_id, 'prod-jersey-001']);

  await seedHoops(rand);
}

async function seedDemoSafe() {
  try {
    await seedDemo();
  } catch (err) {
    console.error('[demo-seed] skipped:', err.code || '', err.message);
  }
}

module.exports = { seedDemoSafe, doubleRoundRobin, rng };
