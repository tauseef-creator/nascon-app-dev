'use strict';
// POST /audit/v1/offline-sync (spec 5.14): replays actions queued on a mobile device.
const express = require('express');
const { query } = require('../../db/pool');
const { validation, ApiError } = require('../../lib/errors');
const sync = require('../../domain/sync');
const events = require('../../services/events');
const roster = require('../../services/roster');

const router = express.Router();

async function scoreEventVersion(payload) {
  const matchId = payload && typeof payload.match_id === 'string' ? payload.match_id : null;
  if (!matchId) return 0;
  return (await events.getMatchVersion(matchId)) ?? 0;
}

async function rosterVersion(payload) {
  const playerId = payload && typeof payload.player_id === 'string' ? payload.player_id : null;
  if (!playerId) return 0;
  return (await roster.getPlayerAuditCount(playerId)) ?? 0;
}

async function isDuplicateEvent(payload) {
  if (!payload || typeof payload.event_id !== 'string') return false;
  const r = await query('SELECT body_hash FROM match_events WHERE event_id = $1', [payload.event_id]);
  return r.rowCount > 0 && r.rows[0].body_hash === events.requestHash(payload);
}

async function processAction(deviceId, action, order) {
  const seen = await query('SELECT 1 FROM offline_actions WHERE device_id = $1 AND action_id = $2', [deviceId, action.action_id]);
  const isScore = action.type === 'score_event';
  const versionOf = () => (isScore ? scoreEventVersion(action.payload) : rosterVersion(action.payload));
  const current = await versionOf();

  if (seen.rowCount > 0 || (isScore && await isDuplicateEvent(action.payload))) {
    return sync.result(action, 'duplicate', 'skipped_duplicate', null, order, current);
  }

  let outcome;
  try {
    if (action.base_version > current) {
      throw new ApiError(409, 'INVALID_BASE_VERSION', 'Device version is ahead of the server.');
    }
    outcome = isScore ? await events.appendEvent(action.payload) : await roster.applyTransfer(action.payload);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return sync.result(action, 'rejected', 'server_wins', err.code, order, await versionOf());
  }

  if (outcome.statusCode === 200) {
    return sync.result(action, 'duplicate', 'skipped_duplicate', null, order, await versionOf());
  }
  const signature = isScore ? outcome.body.signature ?? null : null;
  return sync.result(action, 'applied', sync.appliedResolution(action.base_version, current), null, order, await versionOf(), signature);
}

router.post('/offline-sync', async (req, res) => {
  const bad = sync.validateEnvelope(req.body);
  if (bad.length) throw validation(bad);
  const { device_id: deviceId, actions } = req.body;

  const results = new Array(actions.length);
  const order = sync.processingOrder(actions);
  for (let k = 0; k < order.length; k += 1) {
    const idx = order[k];
    const r = await processAction(deviceId, actions[idx], k + 1);
    await query(
      'INSERT INTO offline_actions (device_id, action_id, result) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [deviceId, actions[idx].action_id, r],
    );
    results[idx] = r;
  }
  res.status(200).json({ device_id: deviceId, results, summary: sync.summarize(results) });
});

module.exports = router;
