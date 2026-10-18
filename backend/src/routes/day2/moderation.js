'use strict';
// POST /audit/v1/moderation/test (spec Part II 5.8, FR-5.2, FR-5.3, edge case 3).
//
// Interpretation notes:
// - kicked_users / muted_users describe THIS request's evaluation (deduplicated, order of first
//   violation), matching the spec example after /reset. Actions are also persisted per room with
//   INSERT ... ON CONFLICT DO NOTHING, so 10 concurrent identical requests store one kick each.
// - Flood wins over profanity: a flooded message is dropped and its sender only muted.
// - The 3-per-2-seconds window applies inside one request (a 4th message from one sender in the
//   same batch is dropped as rate_limit_exceeded, sender muted). It is NOT carried across probe
//   requests, which keeps the probe deterministic under k6 and edge case 3; production chat
//   (POST /api/v1/chat) enforces it across requests.
// - flagged_count counts flagged entries that remain in filtered_messages (dropped ones excluded).
// - check_dlq is accepted (boolean, default true); dlq_status is always returned because the
//   signature covers queue_depth.
const express = require('express');
const { validation } = require('../../lib/errors');
const { isObj, isInt, isStr, isId, isBool } = require('../../lib/validate');
const { signDay2 } = require('../../lib/signing');
const moderation = require('../../services/day2/moderation');
const notify = require('../../services/day2/notify');

const router = express.Router();

const MAX_MESSAGES = 100;
const MAX_SIMULATED_FAILURES = 100;

function validate(body) {
  if (!isObj(body)) throw validation(['body'], 'Request body must be a JSON object.');
  const bad = [];
  if (!isId(body.chat_room_id)) bad.push('chat_room_id');
  const msgs = body.incoming_messages;
  if (!Array.isArray(msgs) || msgs.length < 1 || msgs.length > MAX_MESSAGES) {
    bad.push('incoming_messages');
  } else {
    msgs.forEach((m, i) => {
      if (!isObj(m)) {
        bad.push('incoming_messages', `incoming_messages[${i}]`);
        return;
      }
      if (!isId(m.message_id)) bad.push('incoming_messages', `incoming_messages[${i}].message_id`);
      if (!isId(m.sender)) bad.push('incoming_messages', `incoming_messages[${i}].sender`);
      if (!isStr(m.text) || m.text.length < 1 || m.text.length > moderation.MAX_TEXT || m.text.includes('\u0000')) {
        bad.push('incoming_messages', `incoming_messages[${i}].text`);
      }
    });
  }
  if (body.check_dlq !== undefined && body.check_dlq !== null && !isBool(body.check_dlq)) bad.push('check_dlq');
  const sim = body.simulate_failed_notifications;
  if (sim !== undefined && sim !== null && (!isInt(sim) || sim < 0 || sim > MAX_SIMULATED_FAILURES)) {
    bad.push('simulate_failed_notifications');
  }
  if (bad.length) throw validation(bad);
  return {
    roomId: body.chat_room_id,
    incoming: msgs.map((m) => ({ message_id: m.message_id, sender: m.sender, text: m.text })),
    simulate: sim ?? 0,
  };
}

function simulateFailures(roomId, count) {
  const jobs = [];
  for (let i = 0; i < count; i += 1) {
    const event = { type: 'chat.notification', chat_room_id: roomId, target: 'simulated-subscriber', simulate_dlq: true };
    jobs.push(notify.deliver(event, { simulateFailure: true }));
  }
  return Promise.all(jobs);
}

router.post('/moderation/test', async (req, res) => {
  const { roomId, incoming, simulate } = validate(req.body);

  const [evaluation] = await Promise.all([
    moderation.moderateBatch(roomId, incoming),
    simulateFailures(roomId, simulate),
  ]);
  const dlq = await notify.dlqStatus();

  const sigPayload = {
    chat_room_id: roomId,
    flagged_count: evaluation.flagged_count,
    kicked_users: evaluation.kicked_users,
    queue_depth: dlq.queue_depth,
  };
  res.status(200).json({
    chat_room_id: roomId,
    filtered_messages: evaluation.filtered_messages,
    kicked_users: evaluation.kicked_users,
    muted_users: evaluation.muted_users,
    dlq_status: dlq,
    signature: signDay2(roomId, sigPayload),
  });
});

module.exports = router;
