// NFR-1 probe: 25 WebSocket clients on /ws/matches/match-m1; POST score events and measure push latency.
const WebSocket = require(require('path').join(__dirname, '../../backend/node_modules/ws'));
const BASE = process.env.BASE || 'http://localhost:8080';
const WSB = BASE.replace(/^http/, 'ws');
const N = 25, ROUNDS = Number(process.env.ROUNDS || 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await fetch(`${BASE}/audit/v1/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const clients = await Promise.all(Array.from({ length: N }, () => new Promise((res, rej) => {
    const ws = new WebSocket(`${WSB}/ws/matches/match-m1`);
    ws.waiters = [];
    ws.on('message', (d) => { const m = JSON.parse(String(d)); if (!ws.ready) { ws.ready = true; return res(ws); } if (m.type === 'score') ws.waiters.forEach((w) => w(m)); });
    ws.on('error', rej);
  })));
  const lat = [];
  for (let r = 0; r < ROUNDS; r += 1) {
    const got = clients.map((ws) => new Promise((res) => { const t = setTimeout(() => res(null), 3000); ws.waiters = [(m) => { clearTimeout(t); res(performance.now()); }]; }));
    const t0 = performance.now();
    const resp = await fetch(`${BASE}/audit/v1/events`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_id: `wsprobe-${Date.now()}-${r}`, match_id: 'match-m1', type: 'score', payload: { team_id: 'club-alpha-1', event_type: 'goal' } }) });
    if (resp.status !== 201) console.log('POST status', resp.status, await resp.text());
    for (const t of await Promise.all(got)) lat.push(t === null ? Infinity : t - t0);
    await sleep(100);
  }
  clients.forEach((c) => c.close());
  lat.sort((a, b) => a - b);
  const q = (p) => lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)];
  const missed = lat.filter((x) => x === Infinity).length;
  console.log(JSON.stringify({ samples: lat.length, missed, p50: q(0.5).toFixed(1), p95: q(0.95).toFixed(1), max: q(1).toFixed(1) }));
  await fetch(`${BASE}/audit/v1/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  process.exit(missed || q(0.95) >= 500 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
