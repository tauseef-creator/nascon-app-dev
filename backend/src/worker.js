'use strict';
// Consumes domain events from the Redis stream and records them (order status changes, roster changes, ...).
const Redis = require('ioredis');
const { pool } = require('./db/pool');
const { STREAM } = require('./lib/queue');

async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  let lastId = '$';
  console.log('[worker] consuming', STREAM);
  for (;;) {
    try {
      const res = await redis.xread('BLOCK', 5000, 'COUNT', 100, 'STREAMS', STREAM, lastId);
      if (!res) continue;
      for (const [, entries] of res) {
        for (const [id, fields] of entries) {
          lastId = id;
          const map = {};
          for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
          await pool.query('INSERT INTO domain_events (stream_id, type, data) VALUES ($1,$2,$3)',
            [id, map.type, map.data || '{}']).catch((e) => console.error('[worker] insert failed', e.message));
        }
      }
    } catch (err) {
      console.error('[worker] error', err.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

main();
