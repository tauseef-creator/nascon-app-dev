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

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
`;

const RESET_TABLES = [
  'tenants', 'users', 'sports', 'leagues', 'clubs', 'players', 'matches', 'match_events',
  'roster_leagues', 'squads', 'registrations', 'roster_live_matches', 'roster_audit', 'roster_requests',
  'products', 'variants', 'discount_codes', 'orders', 'pinned_products', 'match_status', 'offline_actions', 'app_state',
];

module.exports = { SCHEMA, RESET_TABLES };
