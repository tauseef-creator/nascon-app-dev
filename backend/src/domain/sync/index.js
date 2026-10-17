'use strict';
// Pure helpers for offline sync (spec 5.14).
const { isObj, isInt, isStr, isId } = require('../../lib/validate');

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ACTION_TYPES = ['score_event', 'roster_transfer'];

// Returns the list of invalid envelope fields (empty when valid).
function validateEnvelope(body) {
  const bad = [];
  if (!isObj(body)) return ['body'];
  if (!isId(body.device_id)) bad.push('device_id');
  if (!Array.isArray(body.actions) || body.actions.length < 1 || body.actions.length > 100) {
    bad.push('actions');
    return bad;
  }
  body.actions.forEach((a, i) => {
    if (!isObj(a)) { bad.push(`actions[${i}]`); return; }
    if (!isId(a.action_id)) bad.push(`actions[${i}].action_id`);
    if (!ACTION_TYPES.includes(a.type)) bad.push(`actions[${i}].type`);
    if (!isStr(a.queued_at) || !TS_RE.test(a.queued_at) || Number.isNaN(Date.parse(a.queued_at))) bad.push(`actions[${i}].queued_at`);
    if (!isInt(a.base_version) || a.base_version < 0) bad.push(`actions[${i}].base_version`);
    if (!isObj(a.payload)) bad.push(`actions[${i}].payload`);
  });
  return bad;
}

// Indices of actions in processing order: queued_at ascending, ties keep array order.
function processingOrder(actions) {
  return actions
    .map((a, i) => ({ i, t: Date.parse(a.queued_at) }))
    .sort((x, y) => (x.t - y.t) || (x.i - y.i))
    .map((x) => x.i);
}

function appliedResolution(baseVersion, currentVersion) {
  return baseVersion === currentVersion ? 'appended' : 'rebased_append';
}

function result(action, status, resolution, errorCode, processedOrder, serverVersion, signature = null) {
  return {
    action_id: action.action_id,
    status,
    resolution,
    error_code: errorCode,
    processed_order: processedOrder,
    server_version: serverVersion,
    signature,
  };
}

function summarize(results) {
  const summary = { applied: 0, rejected: 0, duplicate: 0 };
  for (const r of results) summary[r.status] += 1;
  return summary;
}

module.exports = { validateEnvelope, processingOrder, appliedResolution, result, summarize, ACTION_TYPES };
