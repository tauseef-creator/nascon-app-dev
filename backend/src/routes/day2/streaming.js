'use strict';
// Stream keys (spec Part II 5.4), media server hooks (FR-3.2) and athlete profiles (FR-3.1).
//   router    -> mounted under /audit/v1 (routes/audit/index.js)
//   apiRouter -> production routes, mount under /api/v1 (after the rate limiter)
const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth, bearer, verifyToken } = require('../../lib/auth');
const { ApiError, errorBody, notFound } = require('../../lib/errors');
const streaming = require('../../services/day2/streaming');
const costream = require('../../services/day2/costream');
const events = require('../../services/events');
const domain = require('../../domain/day2/streaming');

const router = express.Router();

// POST /audit/v1/stream/key {action, player_id, label?, stream_key_override?}
router.post('/stream/key', async (req, res) => {
  const out = await streaming.manageKey(req.body);
  res.status(out.statusCode).json(out.body);
});

// POST /audit/v1/stream/publish-check {stream_key}: the publish rule the media server enforces.
router.post('/stream/publish-check', async (req, res) => {
  const { decision, row, key } = await streaming.publishCheck(req.body);
  if (!decision.allow) {
    const message = decision.code === 'KEY_REVOKED' ? 'This stream key has been revoked.' : 'Unknown stream key.';
    throw new ApiError(decision.httpStatus, decision.code, message, { stream_key: key });
  }
  res.status(200).json({ stream_key: key, player_id: row.player_id, status: 'active', publish_allowed: true });
});

// POST /audit/v1/internal/media/auth: MediaMTX authMethod=http hook. Any non-2xx denies the request.
router.post('/internal/media/auth', async (req, res) => {
  const d = await streaming.mediaAuth(req.body);
  if (d.allow) return res.status(200).json({ allow: true });
  const message = d.code === 'KEY_REVOKED' ? 'This stream key has been revoked.' : 'Media access denied.';
  return res.status(d.httpStatus).json(errorBody(new ApiError(d.httpStatus, d.code, message, { path: req.body && req.body.path })));
});

// MediaMTX runOnReady / runOnNotReady hooks (?path=live/<key>): VOD indexing on stream end.
router.post('/internal/media/ready', async (req, res) => {
  res.status(200).json(await streaming.onPathReady(String(req.query.path || '')));
});
router.post('/internal/media/not-ready', async (req, res) => {
  res.status(200).json(await streaming.onPathNotReady(String(req.query.path || '')));
});

// GET /audit/v1/internal/media/composite?path=costream/<id>: compositor FFmpeg arguments (text/plain,
// space separated, no argument contains whitespace). 409 when no participant is live.
router.get('/internal/media/composite', async (req, res) => {
  const target = domain.parseMediaPath(String(req.query.path || ''));
  const args = target && target.kind === 'costream' ? await costream.compositePlan(target.id) : null;
  if (!args) {
    return res.status(409).json(errorBody(new ApiError(409, 'COSTREAM_NOT_LIVE', 'No live participant to compose.', { path: req.query.path || null })));
  }
  res.status(200).type('text/plain').send(args.join(' '));
});

// ---------------------------------------------------------------- /api/v1 athlete profile (FR-3.1)

const apiRouter = express.Router();

// Optional auth: a valid member token adds `following`; guests and anonymous viewers can still read.
function optionalPrincipal(req) {
  const token = bearer(req.headers && req.headers.authorization);
  if (!token || token.startsWith('guest_')) return null;
  try { return verifyToken(token); } catch (e) { return null; }
}

async function loadPlayer(playerId) {
  const { rows } = await query(
    `SELECT p.player_id, p.name, p.position, p.tenant_id, p.club_id, c.name AS club_name
     FROM players p LEFT JOIN clubs c ON c.club_id = p.club_id WHERE p.player_id = $1`, [playerId]);
  if (!rows.length) throw notFound('PLAYER_NOT_FOUND', `Player ${playerId} does not exist.`, { player_id: playerId });
  return rows[0];
}

async function followerCount(playerId) {
  const { rows } = await query('SELECT count(*)::int AS n FROM follows WHERE athlete_id = $1', [playerId]);
  return rows[0].n;
}

// Active club affiliations: home club plus every squad the player is registered in.
async function affiliations(player) {
  const { rows } = await query(
    `SELECT DISTINCT s.club_id, c.name AS club_name, r.league_id, r.role, r.registration_type
     FROM registrations r JOIN squads s ON s.squad_id = r.squad_id LEFT JOIN clubs c ON c.club_id = s.club_id
     WHERE r.player_id = $1 AND s.club_id IS NOT NULL
       AND (r.loan_end_date IS NULL OR r.loan_end_date >= to_char(now(), 'YYYY-MM-DD'))`, [player.player_id]);
  const clubs = new Map();
  if (player.club_id) clubs.set(player.club_id, { club_id: player.club_id, name: player.club_name, league_id: null, role: null, registration_type: 'primary' });
  for (const r of rows) {
    if (!clubs.has(r.club_id)) clubs.set(r.club_id, { club_id: r.club_id, name: r.club_name, league_id: r.league_id, role: r.role, registration_type: r.registration_type });
  }
  return [...clubs.values()];
}

async function clubMatches(clubIds) {
  if (!clubIds.length) return [];
  const { rows } = await query(
    `SELECT m.match_id, m.league_id, m.home_team_id, m.away_team_id, m.scheduled_at, m.venue, ms.status AS override_status
     FROM matches m LEFT JOIN match_status ms ON ms.match_id = m.match_id
     WHERE m.home_team_id = ANY($1) OR m.away_team_id = ANY($1)
     ORDER BY m.scheduled_at NULLS LAST, m.match_id LIMIT 200`, [clubIds]);
  const out = [];
  for (const m of rows) {
    const proj = await events.getProjection(m.match_id).catch(() => null);
    out.push({
      ...m,
      scheduled_at: m.scheduled_at ? new Date(m.scheduled_at).toISOString().replace(/\.\d{3}Z$/, 'Z') : null,
      status: proj ? proj.status : 'upcoming',
      projection: proj,
    });
  }
  return out;
}

// GET /api/v1/athletes/:player_id: career record, clubs, upcoming fixtures, VOD archive, followers.
apiRouter.get('/athletes/:player_id', async (req, res) => {
  const player = await loadPlayer(req.params.player_id);
  const clubs = await affiliations(player);
  const matches = await clubMatches(clubs.map((c) => c.club_id));
  const projections = matches.filter((m) => m.projection).map((m) => ({
    match_id: m.match_id, status: m.status, home: m.projection.home, away: m.projection.away, winner_team_id: m.projection.winner_team_id,
  }));
  const ev = await query(
    `SELECT type, count(*)::int AS n FROM match_events WHERE payload->>'player_id' = $1 GROUP BY type ORDER BY type`,
    [player.player_id]);
  const vods = await query(
    'SELECT vod_id, stream_key, object_key, duration_s, created_at, storage_bucket, storage_keys FROM vods WHERE player_id = $1 ORDER BY created_at DESC LIMIT 50',
    [player.player_id]);
  const principal = optionalPrincipal(req);
  let following = null;
  if (principal) {
    const f = await query('SELECT 1 FROM follows WHERE follower_id = $1 AND athlete_id = $2', [principal.user_id, player.player_id]);
    following = f.rowCount > 0;
  }
  res.status(200).json({
    player_id: player.player_id,
    name: player.name,
    position: player.position,
    tenant_id: player.tenant_id,
    clubs,
    career: { ...domain.careerRecord(projections, clubs.map((c) => c.club_id)), events: Object.fromEntries(ev.rows.map((r) => [r.type, r.n])) },
    upcoming_fixtures: domain.upcomingFixtures(matches, Date.now()).map((m) => ({
      match_id: m.match_id, league_id: m.league_id, home_team_id: m.home_team_id, away_team_id: m.away_team_id,
      scheduled_at: m.scheduled_at, venue: m.venue,
    })),
    vods: vods.rows.map((v) => ({
      vod_id: v.vod_id, duration_s: v.duration_s,
      recorded_at: new Date(v.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      playback_url: streaming.vodPlaybackUrl(v.object_key, v.duration_s),
      storage: v.storage_bucket ? { bucket: v.storage_bucket, object_keys: v.storage_keys || [] } : null,
    })),
    follower_count: await followerCount(player.player_id),
    following,
  });
});

// POST /api/v1/athletes/:player_id/follow (idempotent; 201 on first follow, 200 when already following).
apiRouter.post('/athletes/:player_id/follow', requireAuth, async (req, res) => {
  const player = await loadPlayer(req.params.player_id);
  const r = await query(
    'INSERT INTO follows (follower_id, athlete_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.principal.user_id, player.player_id]);
  res.status(r.rowCount ? 201 : 200).json({
    athlete_id: player.player_id, follower_id: req.principal.user_id, following: true, follower_count: await followerCount(player.player_id),
  });
});

// DELETE /api/v1/athletes/:player_id/follow (idempotent; 200 whether or not a follow existed).
apiRouter.delete('/athletes/:player_id/follow', requireAuth, async (req, res) => {
  const player = await loadPlayer(req.params.player_id);
  await query('DELETE FROM follows WHERE follower_id = $1 AND athlete_id = $2', [req.principal.user_id, player.player_id]);
  res.status(200).json({
    athlete_id: player.player_id, follower_id: req.principal.user_id, following: false, follower_count: await followerCount(player.player_id),
  });
});

apiRouter.use(require('./costream').apiRouter);

module.exports = router;
module.exports.apiRouter = apiRouter;
