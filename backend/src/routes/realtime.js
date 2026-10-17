'use strict';
// GET /realtime/matches/:match_id: Server-Sent Events stream with the live score and pinned product.
const { hub } = require('../lib/realtime');
const { query } = require('../db/pool');
const events = require('../services/events');

async function pinned(matchId) {
  const { rows } = await query(
    `SELECT p.product_id, p.name, p.category FROM pinned_products pp
     JOIN products p ON p.product_id = pp.product_id WHERE pp.match_id = $1`, [matchId]);
  return rows[0] || null;
}

module.exports = async function realtime(req, res) {
  const matchId = req.params.match_id;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const sendScore = async () => {
    try { send('score', await events.getScore(matchId)); } catch (e) { send('error', { code: e.code || 'ERROR' }); }
  };
  const sendPin = async () => send('pinned_product', { product: await pinned(matchId).catch(() => null) });

  const onMatch = (id) => { if (id === matchId) sendScore(); };
  const onPin = (id) => { if (id === matchId) sendPin(); };
  hub.on('match', onMatch);
  hub.on('pinned', onPin);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    hub.off('match', onMatch);
    hub.off('pinned', onPin);
  });
  await sendScore();
  await sendPin();
};
