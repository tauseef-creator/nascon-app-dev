'use strict';
// Baseline data for /audit/v1/reset (spec 5.5, 8.3). Sports are plain data in the same schema as 5.6.

const FULL_TIE_BREAK = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];

const SEED_SPORTS = [
  {
    sport_id: 'football', name: 'Football', scoring_model: 'event',
    periods: { count: 2, duration_minutes: 45 },
    scoring_events: { goal: { points: 1 } },
    draw_allowed: true,
    overtime: { policy: 'none' },
    tie_break_order: FULL_TIE_BREAK,
    roster: { min_squad_size: 11, max_squad_size: 25, required_positions: { gk: 1 } },
  },
  {
    sport_id: 'basketball', name: 'Basketball', scoring_model: 'event',
    periods: { count: 4, duration_minutes: 12 },
    scoring_events: { free_throw: { points: 1 }, two_pointer: { points: 2 }, three_pointer: { points: 3 } },
    draw_allowed: false,
    overtime: { policy: 'extra_time', duration_minutes: 5 },
    tie_break_order: FULL_TIE_BREAK,
    roster: { min_squad_size: 5, max_squad_size: 15, required_positions: {} },
  },
  {
    sport_id: 'cricket', name: 'Cricket', scoring_model: 'innings',
    periods: { innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 10 },
    scoring_events: {
      dot_ball: { runs: 0, legal_ball: true, wicket: false },
      single: { runs: 1, legal_ball: true, wicket: false },
      two: { runs: 2, legal_ball: true, wicket: false },
      four: { runs: 4, legal_ball: true, wicket: false },
      six: { runs: 6, legal_ball: true, wicket: false },
      wide: { runs: 1, legal_ball: false, wicket: false },
      no_ball: { runs: 1, legal_ball: false, wicket: false },
      wicket: { runs: 0, legal_ball: true, wicket: true },
    },
    draw_allowed: true,
    overtime: { policy: 'super_over' },
    tie_break_order: FULL_TIE_BREAK,
    roster: { min_squad_size: 11, max_squad_size: 18, required_positions: { wicketkeeper: 1 } },
  },
  {
    sport_id: 'esports', name: 'Esports', scoring_model: 'round',
    periods: { best_of: 3 },
    scoring_events: { round_win: { rounds: 1 } },
    draw_allowed: false,
    overtime: { policy: 'none' },
    tie_break_order: FULL_TIE_BREAK,
    roster: { min_squad_size: 5, max_squad_size: 8, required_positions: {} },
  },
];

const TENANTS = [
  { tenant_id: 'tenant-alpha', name: 'Alpha Sports', logo_url: null, primary_color: '#0B5FFF', secondary_color: '#FFB800' },
  { tenant_id: 'tenant-beta', name: 'Beta Athletics', logo_url: null, primary_color: '#0E9F6E', secondary_color: '#1F2937' },
];

const LEAGUES = [
  { league_id: 'league-alpha-1', tenant_id: 'tenant-alpha', sport_id: 'football', name: 'Alpha Premier League' },
  { league_id: 'league-alpha-2', tenant_id: 'tenant-alpha', sport_id: 'basketball', name: 'Alpha Hoops League' },
  { league_id: 'league-beta-1', tenant_id: 'tenant-beta', sport_id: 'football', name: 'Beta Championship' },
];

const CLUBS = [
  { club_id: 'club-alpha-1', tenant_id: 'tenant-alpha', name: 'Alpha United', data: {
    home_venue: { name: 'Alpha Arena', lat: 33.6844, lng: 73.0479 },
    social: { x: '@alphaunited', instagram: '@alphaunited' },
    staff: { coach: 'Imran Khan', manager: 'Sara Ahmed', physio: 'Bilal Raza' } } },
  { club_id: 'club-alpha-2', tenant_id: 'tenant-alpha', name: 'Alpha Rovers', data: {
    home_venue: { name: 'Rovers Ground', lat: 33.7, lng: 73.06 },
    social: { x: '@alpharovers' },
    staff: { coach: 'Ali Shah', manager: 'Hina Malik', physio: 'Omar Farooq' } } },
  { club_id: 'club-beta-1', tenant_id: 'tenant-beta', name: 'Beta City', data: {
    home_venue: { name: 'Beta Stadium', lat: 31.52, lng: 74.35 },
    social: { x: '@betacity' },
    staff: { coach: 'Zain Ali', manager: 'Ayesha Noor', physio: 'Usman Tariq' } } },
];

const PLAYERS = [
  { player_id: 'player-alpha-1', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1', name: 'Ahmed Raza', position: 'fw' },
  { player_id: 'player-alpha-2', tenant_id: 'tenant-alpha', club_id: 'club-alpha-2', name: 'Usman Ghani', position: 'gk' },
  { player_id: 'player-beta-1', tenant_id: 'tenant-beta', club_id: 'club-beta-1', name: 'Kamran Akmal', position: 'df' },
];

const DEMO_PASSWORD = 'Nascon@26';
const USERS = [
  { user_id: 'user-admin', email: 'admin@nascon.test', role: 'super_admin', tenant_id: null, display_name: 'Ayesha Khan' },
  { user_id: 'user-organizer', email: 'organizer@nascon.test', role: 'league_organizer', tenant_id: 'tenant-alpha', league_id: 'league-alpha-1', display_name: 'Bilal Hassan' },
  { user_id: 'user-manager', email: 'manager@nascon.test', role: 'club_manager', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1', display_name: 'Sara Malik' },
  { user_id: 'user-player', email: 'player@nascon.test', role: 'player', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1', player_id: 'player-alpha-1', display_name: 'Ahmed Raza' },
  { user_id: 'user-viewer', email: 'viewer@nascon.test', role: 'viewer', tenant_id: 'tenant-alpha', display_name: 'Hina Tariq' },
];

const PRODUCTS = [
  { product_id: 'prod-jersey-001', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1', name: 'Alpha United Home Jersey', category: 'apparel',
    data: { description: 'Official 2026 home jersey.', image: 'products/prod-jersey-001.jpg' } },
];
const VARIANTS = [
  { variant_id: 'var-jersey-001-M', product_id: 'prod-jersey-001', size: 'M', color: 'Blue', price_minor: 450000 },
  { variant_id: 'var-jersey-001-L', product_id: 'prod-jersey-001', size: 'L', color: 'Blue', price_minor: 450000 },
];
const DEFAULT_STOCK = { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 };
const DISCOUNTS = [{ code: 'WELCOME10', percent: 10 }];

module.exports = {
  FULL_TIE_BREAK, SEED_SPORTS, TENANTS, LEAGUES, CLUBS, PLAYERS, USERS, DEMO_PASSWORD,
  PRODUCTS, VARIANTS, DEFAULT_STOCK, DISCOUNTS,
};
