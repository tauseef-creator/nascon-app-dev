// Normalises the score payloads sent over WebSocket / SSE / polling into one shape.
export type LiveScore = {
  matchId: string | null;
  home: number;
  away: number;
  homeId: string | null;
  awayId: string | null;
  status: string | null;
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);

export function readScore(d: any): LiveScore | null {
  if (!d || typeof d !== 'object') return null;
  const src = d.score && typeof d.score === 'object' && !Array.isArray(d.score) ? { ...d, ...d.score } : d;
  const home = num(src.home?.score) ?? num(src.home_score) ?? num(src.home);
  const away = num(src.away?.score) ?? num(src.away_score) ?? num(src.away);
  if (home == null || away == null) return null;
  return {
    matchId: src.match_id ?? null,
    home,
    away,
    homeId: src.home?.team_id ?? src.home_team_id ?? null,
    awayId: src.away?.team_id ?? src.away_team_id ?? null,
    status: src.status ?? null,
  };
}
