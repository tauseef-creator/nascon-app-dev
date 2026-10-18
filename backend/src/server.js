'use strict';
const { buildApp } = require('./app');
const { migrate, resetAndSeed } = require('./db/reset');
const http = require('http');
const { seedDemoSafe } = require('./db/demoSeed');
const { seedDay2 } = require('./db/day2Seed');
const { attachWebSockets } = require('./routes/day2/ws');

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

async function main() {
  if (!process.env.DAY1_SALT) console.warn('[startup] DAY1_SALT is not set; signatures will use an empty key.');
  if (!process.env.DAY2_SALT) console.warn('[startup] DAY2_SALT is not set; Phase II signatures will use an empty key.');
  await waitForDb();
  await resetAndSeed();
  await seedDay2();
  await seedDemoSafe();
  const port = Number(process.env.PORT || 8080);
  const server = http.createServer(buildApp());
  attachWebSockets(server);
  server.listen(port, '0.0.0.0', () => console.log(`[startup] API listening on ${port}`));
}

main().catch((err) => {
  console.error('[startup] fatal', err);
  process.exit(1);
});
