'use strict';
// Entry point. WEB_CONCURRENCY (default 1) selects the process model:
//   1   single process: wait for DB -> migrate -> resetAndSeed -> seed Phase II -> listen :8080
//   N>1 cluster: the primary migrates and seeds ONCE, clears shared realtime state in Redis, then
//       forks N workers that share the listening socket. Workers relay realtime events over Redis
//       pub/sub (lib/realtime) and share the rate-limit windows, QR cache generation and the WS
//       connection gauge in Redis. A worker that dies is replaced.
const cluster = require('cluster');
const http = require('http');
const { migrate, resetAndSeed, markSeeded } = require('./db/reset');

// Accept queue for the listening socket (capped by net.core.somaxconn). Node's default 511 is below
// the 550 connections k6 opens at once (spec 6.4); overflowing SYNs are retried after 1, 3, 7 s...
const LISTEN_BACKLOG = Number.parseInt(process.env.LISTEN_BACKLOG || '', 10) || 4096;
const WS_COUNTS_KEY = 'nascon:ws_conns';
const PRESENCE_PREFIX = 'nascon:presence:';

function concurrency() {
  const n = Number.parseInt(process.env.WEB_CONCURRENCY || '1', 10);
  return Number.isInteger(n) && n > 1 ? Math.min(n, 64) : 1;
}

async function waitForDb(retries = 60) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await migrate();
      return;
    } catch (err) {
      console.log(`[startup] database not ready (${err.code || err.message}), retrying...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Database never became ready');
}

async function seedAll() {
  if (!process.env.DAY1_SALT) console.warn('[startup] DAY1_SALT is not set; signatures will use an empty key.');
  if (!process.env.DAY2_SALT) console.warn('[startup] DAY2_SALT is not set; Phase II signatures will use an empty key.');
  await waitForDb();
  await resetAndSeed();
  await require('./db/day2Seed').seedDay2();
  await require('./db/demoSeed').seedDemoSafe();
}

function listen() {
  const { buildApp } = require('./app');
  const { attachWebSockets } = require('./routes/day2/ws');
  const port = Number(process.env.PORT || 8080);
  const server = http.createServer(buildApp());
  attachWebSockets(server);
  // Keep client connections alive across load-test iterations (fewer TCP handshakes under 550 VUs).
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  return new Promise((resolve) => {
    server.listen({ port, host: '0.0.0.0', backlog: LISTEN_BACKLOG }, () => {
      const who = cluster.isWorker ? ` (worker ${cluster.worker.id}, pid ${process.pid})` : '';
      console.log(`[startup] API listening on ${port}${who}`);
      resolve(server);
    });
  });
}

// Resolves once the client is connected, or after timeoutMs (the app then degrades per feature).
function whenReady(client, timeoutMs = 5000) {
  if (client.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    client.once('ready', () => { clearTimeout(t); resolve(true); });
  });
}

async function deleteMatching(redis, pattern) {
  let cursor = '0';
  do {
    // eslint-disable-next-line no-await-in-loop
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    // eslint-disable-next-line no-await-in-loop
    if (keys.length) await redis.del(...keys);
  } while (cursor !== '0');
}

async function primary(n) {
  await seedAll();
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
  redis.on('error', () => {});
  if (await whenReady(redis)) {
    // Shared state from a previous run of the stack is meaningless after a fresh seed.
    await Promise.all([
      redis.del(WS_COUNTS_KEY, 'qr:gen'),
      deleteMatching(redis, `${PRESENCE_PREFIX}*`),
      deleteMatching(redis, 'rl:chat:*'),
    ]).catch(() => {});
  } else {
    console.warn('[startup] Redis not reachable; workers start with per-process fallbacks.');
  }
  console.log(`[startup] primary ${process.pid} seeded; forking ${n} workers`);
  const fork = () => cluster.fork({ NASCON_SEEDED: '1' });
  for (let i = 0; i < n; i += 1) fork();
  let stopping = false;
  cluster.on('exit', (worker, code, signal) => {
    const pid = String(worker.process.pid);
    redis.hdel(WS_COUNTS_KEY, pid).catch(() => {});
    if (stopping) return;
    console.error(`[cluster] worker ${pid} exited (${signal || code}); starting a replacement`);
    setTimeout(fork, 500);
  });
  const shutdown = () => {
    stopping = true;
    for (const w of Object.values(cluster.workers)) w.kill('SIGTERM');
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function worker() {
  markSeeded();
  const realtime = require('./lib/realtime');
  const pub = realtime.enableClusterBus();
  await whenReady(pub);
  await realtime.whenSubscribed();
  await listen();
}

async function main() {
  const n = concurrency();
  if (cluster.isWorker) return worker();
  if (n > 1) return primary(n);
  await seedAll();
  return listen();
}

main().catch((err) => {
  console.error('[startup] fatal', err);
  process.exit(1);
});
