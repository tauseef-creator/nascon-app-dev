'use strict';
// Relational schema. Sport rules live as JSON data (no sport-specific columns or code).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT,
  secondary_color TEXT
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  tenant_id TEXT,
  league_id TEXT,
  club_id TEXT,
  player_id TEXT,
  display_name TEXT
);

CREATE TABLE IF NOT EXISTS sports (
  sport_id TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leagues: RBAC/org leagues (seeded) and standings leagues registered through /audit/v1/leagues.
CREATE TABLE IF NOT EXISTS leagues (
  league_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  sport_id TEXT,
  name TEXT,
  config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clubs (
  club_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  club_id TEXT,
  name TEXT NOT NULL,
  position TEXT,
  data JSONB NOT NULL DEFAULT '{}'
);

-- Match streams (league fixtures or stand-alone match_init).
CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL,
  league_id TEXT,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  venue TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only event log. Rows are never updated or deleted (except by /reset).
CREATE TABLE IF NOT EXISTS match_events (
  match_id TEXT NOT NULL,
  sequence INT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_canonical TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, sequence)
);

-- Roster scenarios (5.11)
CREATE TABLE IF NOT EXISTS roster_leagues (
  league_id TEXT PRIMARY KEY,
  config JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS squads (
  squad_id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL,
  club_id TEXT,
  tenant_id TEXT NOT NULL,
  name TEXT
);
CREATE TABLE IF NOT EXISTS registrations (
  player_id TEXT NOT NULL,
  league_id TEXT NOT NULL,
  name TEXT,
  position TEXT,
  squad_id TEXT,
  parent_squad_id TEXT,
  registration_type TEXT,
  start_date TEXT,
  loan_end_date TEXT,
  role TEXT,
  PRIMARY KEY (player_id, league_id)
);
CREATE TABLE IF NOT EXISTS roster_live_matches (
  league_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  home_squad_id TEXT,
  away_squad_id TEXT
);
CREATE TABLE IF NOT EXISTS roster_audit (
  seq BIGSERIAL PRIMARY KEY,
  audit_id TEXT NOT NULL UNIQUE,
  player_id TEXT NOT NULL,
  league_id TEXT NOT NULL,
  entry JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS roster_requests (
  request_id TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  status_code INT NOT NULL,
  response JSONB NOT NULL
);

-- Store (5.12)
CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  club_id TEXT,
  name TEXT NOT NULL,
  category TEXT,
  data JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS variants (
  variant_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  size TEXT,
  color TEXT,
  price_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  stock INT NOT NULL CHECK (stock >= 0),
  reserved INT NOT NULL DEFAULT 0 CHECK (reserved >= 0)
);
CREATE TABLE IF NOT EXISTS discount_codes (
  code TEXT PRIMARY KEY,
  percent INT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  customer_id TEXT,
  status TEXT NOT NULL,
  status_code INT,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Administrative match status overrides (FR-1.3: postponed / abandoned / cancelled).
CREATE TABLE IF NOT EXISTS match_status (
  match_id TEXT PRIMARY KEY,
  status TEXT, -- NULL = no override (event log is authoritative)
  reason TEXT,
  scheduled_at TIMESTAMPTZ,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  history JSONB NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS pinned_products (
  match_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL
);

-- Offline sync (5.14)
CREATE TABLE IF NOT EXISTS offline_actions (
  device_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  result JSONB NOT NULL,
  PRIMARY KEY (device_id, action_id)
);

-- Domain events mirrored by the worker from the Redis stream.
CREATE TABLE IF NOT EXISTS domain_events (
  id BIGSERIAL PRIMARY KEY,
  stream_id TEXT,
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== Phase II (Day 2) =====================
-- Streaming (FR-3.2, 5.4)
CREATE TABLE IF NOT EXISTS stream_keys (
  stream_key TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL,              -- active | revoked
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS vods (
  vod_id TEXT PRIMARY KEY,
  stream_key TEXT NOT NULL,
  player_id TEXT NOT NULL,
  object_key TEXT,
  duration_s INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  storage_bucket TEXT,               -- MinIO bucket of the archived recording (FR-3.2)
  storage_keys JSONB NOT NULL DEFAULT '[]'  -- MinIO object keys of the recorded segments
);
ALTER TABLE vods ADD COLUMN IF NOT EXISTS storage_bucket TEXT;
ALTER TABLE vods ADD COLUMN IF NOT EXISTS storage_keys JSONB NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  athlete_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, athlete_id)
);
-- Co-stream (FR-3.3, 5.5)
CREATE TABLE IF NOT EXISTS costream_sessions (
  session_id TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  status_code INT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Chat (FR-3.3 unified chat, FR-5.3 moderation)
CREATE TABLE IF NOT EXISTS chat_messages (
  room_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  message_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  flagged BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, seq)
);
CREATE TABLE IF NOT EXISTS moderation_actions (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,              -- kick | mute
  first_seq BIGSERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id, action)
);
CREATE INDEX IF NOT EXISTS chat_messages_room_msg ON chat_messages (room_id, message_id);
-- Notification bus DLQ (FR-5.2)
CREATE TABLE IF NOT EXISTS dlq_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  event JSONB NOT NULL,
  attempts INT NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Dynamic QR (FR-4.1, 5.6); scans keep no IP / UA / cookies (NFR-9)
CREATE TABLE IF NOT EXISTS qr_codes (
  entity_id TEXT PRIMARY KEY,
  short_code TEXT NOT NULL UNIQUE,
  scan_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS qr_scans (
  id BIGSERIAL PRIMARY KEY,
  entity_id TEXT NOT NULL,
  device_family TEXT NOT NULL,       -- mobile | desktop
  bucket TEXT NOT NULL               -- UTC hour bucket, e.g. 2026-10-18T11:00Z
);
-- Guest access and carts (FR-4.2 - FR-4.4, 5.7)
CREATE TABLE IF NOT EXISTS guest_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT,                      -- linked member after merge (unlinked by privacy erasure)
  merged BOOLEAN NOT NULL DEFAULT false,
  revoked BOOLEAN NOT NULL DEFAULT false,
  cart JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ             -- short-lived (FR-4.2); NULL never expires (seeded fixture)
);
ALTER TABLE guest_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS member_carts (
  user_id TEXT PRIMARY KEY,
  items JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cart_merges (
  guest_token TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  response JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
`;

const RESET_TABLES = [
  'tenants', 'users', 'sports', 'leagues', 'clubs', 'players', 'matches', 'match_events',
  'roster_leagues', 'squads', 'registrations', 'roster_live_matches', 'roster_audit', 'roster_requests',
  'products', 'variants', 'discount_codes', 'orders', 'pinned_products', 'match_status', 'offline_actions', 'app_state',
  'stream_keys', 'vods', 'follows', 'costream_sessions', 'chat_messages', 'moderation_actions', 'dlq_events',
  'qr_codes', 'qr_scans', 'guest_tokens', 'member_carts', 'cart_merges',
];

module.exports = { SCHEMA, RESET_TABLES };
