'use strict';
// Match event log service (spec 5.9). Shared by the /audit/v1/events route and offline sync (5.14).
const { pool, tx } = require('../db/pool');
const { ApiError, validation, notFound } = require('../lib/errors');
const { isId } = require('../lib/validate');
const { canonical, sign, bodyHash } = require('../lib/signing');
const {
  validateEventBody, projectMatch, toScoreResponse, validateEventAgainstState,
} = require('../domain/scoring');

const toApiError = (e) => new ApiError(e.status, e.code, e.message, e.details);

async function loadMatch(client, matchId) {
  const r = await client.query(
    'SELECT match_id, sport_id, league_id, home_team_id, away_team_id FROM matches WHERE match_id = $1', [matchId]);
  return r.rows[0] || null;
}

async function loadSport(client, sportId) {
  const r = await client.query('SELECT config FROM sports WHERE sport_id = $1', [sportId]);
  return r.rows[0] ? r.rows[0].config : null;
}

async function loadEvents(client, matchId) {
  const r = await client.query(
    'SELECT sequence, event_id, type, payload, signature FROM match_events WHERE match_id = $1 ORDER BY sequence', [matchId]);
  return r.rows;
}

// Identity of a request for idempotency: the known fields only (unknown fields are ignored, spec 5.2).
function requestHash(event) {
  return bodyHash({ event_id: event.event_id, match_id: event.match_id, type: event.type, payload: event.payload });
}

async function appendInClient(client, event, hash, opts) {
  // Serialize appends per match stream (also covers match_init, where no matches row exists yet).
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`match:${event.match_id}`]);

  // Idempotency: checked after schema validation, before every other rule. A stored response always wins.
  const dup = await client.query('SELECT body_hash, response FROM match_events WHERE event_id = $1', [event.event_id]);
  if (dup.rows.length) {
    if (dup.rows[0].body_hash === hash) return { statusCode: 200, body: dup.rows[0].response, replay: true };
    throw new ApiError(409, 'DUPLICATE_EVENT_ID', `Event ${event.event_id} already exists with a different body.`,
      { event_id: event.event_id });
  }

  let match = await loadMatch(client, event.match_id);
  let sport;
  let events = [];
  if (event.type === 'match_init') {
    sport = await loadSport(client, event.payload.sport_id);
    if (!sport) throw notFound('SPORT_NOT_FOUND', `Sport ${event.payload.sport_id} not found.`, { sport_id: event.payload.sport_id });
    if (match) throw new ApiError(409, 'MATCH_EXISTS', `Match ${event.match_id} already exists.`, { match_id: event.match_id });
    match = {
      match_id: event.match_id,
      sport_id: event.payload.sport_id,
      league_id: event.payload.league_id ?? null,
      home_team_id: event.payload.home_team_id,
      away_team_id: event.payload.away_team_id,
    };
  } else {
    if (!match) throw notFound('MATCH_NOT_FOUND', `Match ${event.match_id} not found.`, { match_id: event.match_id });
    sport = await loadSport(client, match.sport_id);
    if (!sport) throw notFound('SPORT_NOT_FOUND', `Sport ${match.sport_id} not found.`, { sport_id: match.sport_id });
    events = await loadEvents(client, event.match_id);
    let target = null;
    if (event.type === 'compensation') {
      const t = await client.query('SELECT event_id, match_id, type FROM match_events WHERE event_id = $1',
        [event.payload.compensates]);
      target = t.rows[0] || null;
    }
    const projection = projectMatch(sport, events, match);
    const ruleError = validateEventAgainstState(sport, projection, event, { target });
    if (ruleError) throw toApiError(ruleError);
  }

  if (typeof opts.beforeAppend === 'function') {
    await opts.beforeAppend({ version: events.length, match, sport, client });
  }

  if (event.type === 'match_init') {
    await client.query(
      'INSERT INTO matches (match_id, sport_id, league_id, home_team_id, away_team_id) VALUES ($1,$2,$3,$4,$5)',
      [match.match_id, match.sport_id, match.league_id, match.home_team_id, match.away_team_id]);
  }
  const sequence = events.length + 1;
  const signature = sign(event.event_id, event.payload);
  const response = {
    event_id: event.event_id,
    match_id: event.match_id,
    type: event.type,
    sequence,
    match_version: sequence,
    signature,
  };
  await client.query(
    `INSERT INTO match_events (match_id, sequence, event_id, type, payload, payload_canonical, body_hash, signature, response)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [event.match_id, sequence, event.event_id, event.type, JSON.stringify(event.payload), canonical(event.payload),
      hash, signature, response]);
  return { statusCode: 201, body: response, replay: false };
}

/**
 * appendEvent(body, opts) -> { statusCode: 201|200, body, replay }; throws ApiError.
 * opts.client: run inside the caller's transaction (no retry on races).
 * opts.beforeAppend({version, match, sport, client}): called after every rule passed, right before
 *   insertion, under the per-match lock; may throw to abort (e.g. offline-sync base_version checks).
 */
async function appendEvent(body, opts = {}) {
  const v = validateEventBody(body);
  if (!v.ok) throw validation(v.fields);
  const event = v.event;
  const hash = requestHash(event);
  if (opts.client) return appendInClient(opts.client, event, hash, opts);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await tx((c) => appendInClient(c, event, hash, opts));
    } catch (e) {
      // Unique violation from a concurrent writer (same event_id on another match, or a racing match row):
      // retry once so the request sees the committed state and answers 200/409 properly.
      if (e && e.code === '23505' && attempt < 2) continue;
      throw e;
    }
  }
}

async function getScore(matchId) {
  const match = isId(matchId) ? await loadMatch(pool, matchId) : null;
  if (!match) throw notFound('MATCH_NOT_FOUND', `Match ${matchId} not found.`, { match_id: matchId });
  const sport = await loadSport(pool, match.sport_id);
  if (!sport) throw notFound('SPORT_NOT_FOUND', `Sport ${match.sport_id} not found.`, { sport_id: match.sport_id });
  const events = await loadEvents(pool, matchId);
  return toScoreResponse(projectMatch(sport, events, match));
}

// Number of events in the match log, or null when the match stream does not exist.
async function getMatchVersion(matchId, client = pool) {
  if (!isId(matchId)) return null;
  const r = await client.query(
    'SELECT (SELECT count(*)::int FROM match_events e WHERE e.match_id = m.match_id) AS version FROM matches m WHERE m.match_id = $1',
    [matchId]);
  return r.rows.length ? r.rows[0].version : null;
}

// Full projection (with internal helper fields) for other services such as standings.
async function getProjection(matchId, client = pool) {
  const match = await loadMatch(client, matchId);
  if (!match) return null;
  const sport = await loadSport(client, match.sport_id);
  if (!sport) return null;
  return projectMatch(sport, await loadEvents(client, matchId), match);
}

module.exports = { appendEvent, getScore, getMatchVersion, getProjection, requestHash };
