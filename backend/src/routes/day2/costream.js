'use strict';
// Co-stream sessions (spec Part II 5.5, FR-3.3).
//   router    -> mounted under /audit/v1
//   apiRouter -> host controls for the mobile app, mounted under /api/v1 through streaming.apiRouter
const express = require('express');
const { requireAuth } = require('../../lib/auth');
const { isObj } = require('../../lib/validate');
const costream = require('../../services/day2/costream');

const router = express.Router();

// POST /audit/v1/costream/session
router.post('/costream/session', async (req, res) => {
  const out = await costream.createSession(req.body);
  res.status(out.statusCode).json(out.body);
});

const apiRouter = express.Router();
const body = (req) => (isObj(req.body) ? req.body : {});

// GET /api/v1/costream/:session_id: current state (viewers and participants).
apiRouter.get('/costream/:session_id', async (req, res) => {
  const s = await costream.getSession(req.params.session_id);
  res.status(200).json({ ...costream.publicView(s), muted: s.muted || [], spotlight: s.spotlight ?? null });
});

// POST /api/v1/costream/:session_id/invites {player_id}: host issues a signed invite token.
apiRouter.post('/costream/:session_id/invites', requireAuth, async (req, res) => {
  res.status(201).json(await costream.invite(req.params.session_id, req.principal, body(req).player_id));
});

// POST /api/v1/costream/:session_id/join {invite_token}: invited player joins the broadcast.
apiRouter.post('/costream/:session_id/join', requireAuth, async (req, res) => {
  res.status(200).json(await costream.join(req.params.session_id, req.principal, body(req).invite_token));
});

// POST /api/v1/costream/:session_id/participants/:player_id/:action (mute | unmute | spotlight | kick)
apiRouter.post('/costream/:session_id/participants/:player_id/:action', requireAuth, async (req, res) => {
  const { session_id: sessionId, player_id: playerId, action } = req.params;
  res.status(200).json(await costream.control(sessionId, req.principal, action, playerId));
});

module.exports = router;
module.exports.apiRouter = apiRouter;
