export type Role = 'super_admin' | 'league_organizer' | 'club_manager' | 'player' | 'viewer';

export type User = {
  user_id: string;
  email: string;
  role: Role;
  tenant_id: string | null;
  league_id: string | null;
  club_id: string | null;
  player_id: string | null;
  display_name: string;
};

export type Tenant = {
  tenant_id: string;
  name: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_url: string | null;
};

export type League = { league_id: string; name: string; sport_id: string; tenant_id: string };

export type MatchStatus = 'upcoming' | 'in_progress' | 'completed' | 'postponed' | 'abandoned' | 'cancelled' | (string & {});

/** GET/POST /api/v1/matches/:id/status (FR-1.3 state machine). */
export type MatchStatusInfo = {
  match_id: string;
  status: MatchStatus;
  log_status: MatchStatus;
  reason: string | null;
  scheduled_at: string | null;
  allowed_transitions: MatchStatus[];
  history: { from: MatchStatus; to: MatchStatus; reason: string | null; by: string; at: string }[];
};

export type Match = {
  match_id: string;
  league_id: string;
  sport_id: string;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
  scheduled_at: string;
  venue: string | null;
  status: MatchStatus;
  home_score: number;
  away_score: number;
  version?: number;
};

export type ScoreSide = {
  team_id: string;
  score: number;
  wickets?: number | null;
  overs?: string | number | null;
  balls?: number | null;
};

export type TimelineEvent = {
  sequence: number;
  event_id: string;
  type: string;
  payload: any;
  compensated: boolean;
  compensated_by: string | null;
};

export type ScoreProjection = {
  match_id: string;
  sport_id: string;
  league_id: string;
  status: MatchStatus;
  outcome: string;
  winner_team_id: string | null;
  home: ScoreSide;
  away: ScoreSide;
  version: number;
  events: TimelineEvent[];
};

export type StandingRow = {
  rank: number;
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scored: number;
  conceded: number;
  diff: number;
  points: number;
  status: 'clinched' | 'eliminated' | 'still_possible' | string;
};

export type Standings = { league_id: string; qualification_spots?: number; table: StandingRow[] };

export type Club = {
  club_id: string;
  name: string;
  tenant_id: string;
  home_venue?: { name?: string; lat?: number; lng?: number } | null;
};

export type ClubProfile = Club & {
  social?: Record<string, string> | null;
  staff?: Record<string, string> | null;
  players?: { player_id: string; name: string; position: string; role?: string }[];
  roster?: { player_id: string; name: string; position: string; role?: string }[];
};

export type Variant = {
  variant_id: string;
  size: string | null;
  color: string | null;
  price_minor: number;
  currency: string;
  stock: number;
  reserved?: number;
};

export type Product = {
  product_id: string;
  name: string;
  category: string;
  description: string | null;
  /** Server-relative media path, e.g. "/media/products/x.jpg"; null when the product has no image. */
  image_url?: string | null;
  club_id?: string | null;
  variants: Variant[];
};

export type RosterPlayer = {
  player_id: string;
  name: string;
  position: string;
  role: string;
  squad_id: string | null;
  parent_squad_id: string | null;
  registration_type?: string;
};

export type RosterState = {
  league_id: string | null;
  squad_id: string | null;
  transfer_window: { open: string; close: string } | null;
  /** Present only when the backend exposes the league's squad limit. */
  max_squad_size?: number | null;
  squads: { squad_id: string; club_id: string; name: string }[];
  players: RosterPlayer[];
};

export type Order = {
  order_id: string;
  status: string;
  currency: string;
  items: { variant_id: string; quantity: number; unit_price_minor: number }[];
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
  payment?: { authorization_id?: string; capture_id?: string; state?: string };
  receipt?: { payload?: any; signature?: string; pdf_base64?: string };
};
