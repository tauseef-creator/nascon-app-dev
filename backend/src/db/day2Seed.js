'use strict';
// Phase II baseline seed (spec Part II 5.2): match-m1 (in_progress, 1-0), QR mappings, guest token,
// empty member cart. Called by /audit/v1/reset and at startup AFTER the Day 1 baseline.
// Unlike demo data, failures here must surface (graded baseline). Every step is idempotent.
const { query } = require('./pool');
const { appendEvent } = require('../services/events');

const MATCH_M1 = {
  match_id: 'match-m1',
  sport_id: 'football',
  league_id: 'league-alpha-1',
  home_team_id: 'club-alpha-1',
  away_team_id: 'club-alpha-2',
};

// match-m1 reaches in_progress 1-0 through the append-only event log, like any graded match.
const M1_EVENTS = [
  { event_id: 'day2-m1-e1', match_id: 'match-m1', type: 'match_start', payload: {} },
  { event_id: 'day2-m1-e2', match_id: 'match-m1', type: 'score', payload: { team_id: 'club-alpha-1', event_type: 'goal' } },
];

const QR_MAPPINGS = [
  { entity_id: 'match-m1', short_code: 'm1-live' },
  { entity_id: 'player-alpha-1', short_code: 'p-alpha-1' },
  { entity_id: 'club-alpha-1', short_code: 'c-alpha-1' },
];

const GUEST_TOKEN = 'guest_anon_tok_7721';
const CART_USER = 'player-alpha-1';

async function seedDay2() {
  const m = MATCH_M1;
  await query(
    `INSERT INTO matches (match_id, sport_id, league_id, home_team_id, away_team_id, scheduled_at)
     VALUES ($1,$2,$3,$4,$5, date_trunc('hour', now())) ON CONFLICT (match_id) DO NOTHING`,
    [m.match_id, m.sport_id, m.league_id, m.home_team_id, m.away_team_id]);
  for (const e of M1_EVENTS) await appendEvent(e); // replay of an existing event_id returns 200
  for (const q of QR_MAPPINGS) {
    // Upsert: a client polling /qr/{id} between reset and this seed may have inserted a fallback code.
    await query(`DELETE FROM qr_codes WHERE short_code = $2 AND entity_id <> $1`, [q.entity_id, q.short_code]);
    await query(
      `INSERT INTO qr_codes (entity_id, short_code, scan_count) VALUES ($1,$2,0)
       ON CONFLICT (entity_id) DO UPDATE SET short_code = EXCLUDED.short_code, scan_count = 0`,
      [q.entity_id, q.short_code]);
  }
  await query(
    `INSERT INTO guest_tokens (token, user_id, merged, revoked, cart) VALUES ($1, NULL, false, false, '[]')
     ON CONFLICT (token) DO NOTHING`, [GUEST_TOKEN]);
  await query(`INSERT INTO member_carts (user_id, items) VALUES ($1, '[]') ON CONFLICT (user_id) DO NOTHING`, [CART_USER]);
}

module.exports = { seedDay2, MATCH_M1, M1_EVENTS, QR_MAPPINGS, GUEST_TOKEN };
