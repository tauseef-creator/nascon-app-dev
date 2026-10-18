'use strict';
// GET /metrics (spec Part II 5.9, NFR-6): Prometheus text exposition format 0.0.4.
const { query } = require('../../db/pool');
const { renderMetrics, streamBitrate, countLivePaths, CONTENT_TYPE } = require('../../domain/day2/metrics');
const bus = require('./bus');
const streaming = require('./streaming');

let prevBitrate = new Map();
let mediaCache = { at: 0, paths: null, kbps: 0 };
const MEDIA_CACHE_MS = 1000;

async function scalar(sql) {
  try {
    const { rows } = await query(sql);
    return Number(rows[0] && rows[0].n) || 0;
  } catch (e) {
    return 0;
  }
}

// One MediaMTX scrape per second at most, however often /metrics is polled.
async function mediaPaths() {
  const now = Date.now();
  if (now - mediaCache.at < MEDIA_CACHE_MS) return mediaCache;
  const paths = await streaming.listPaths(800);
  let kbps = 0;
  if (Array.isArray(paths)) {
    const b = streamBitrate(paths, prevBitrate, Date.now());
    prevBitrate = b.next;
    kbps = b.kbps;
  }
  mediaCache = { at: Date.now(), paths, kbps };
  return mediaCache;
}

async function collect() {
  const [media, activeKeys, dlq, scans] = await Promise.all([
    mediaPaths(),
    scalar("SELECT count(*)::int AS n FROM stream_keys WHERE status = 'active'"),
    scalar('SELECT count(*)::int AS n FROM dlq_events'),
    scalar('SELECT COALESCE(SUM(scan_count), 0)::bigint AS n FROM qr_codes'),
  ]);
  const { paths, kbps } = media;
  const mediaUp = Array.isArray(paths);
  // Live ingest paths when the media server answers; otherwise the active (publishable) key count.
  const activeStreams = mediaUp ? countLivePaths(paths, 'live/') : activeKeys;
  return [
    { name: 'nascon_active_ws_connections', type: 'gauge', help: 'Open real-time (WebSocket/SSE) client connections.', value: bus.connectionCount() },
    { name: 'nascon_active_streams_total', type: 'gauge', help: 'Live solo ingest streams on the media server (active stream keys when it is unreachable).', value: activeStreams },
    { name: 'nascon_stream_bitrate_kbps', type: 'gauge', help: 'Aggregate ingest bitrate across live streams in kbit/s.', value: kbps },
    { name: 'nascon_dlq_depth', type: 'gauge', help: 'Notifications parked in the dead-letter queue.', value: dlq },
    { name: 'nascon_qr_scans_total', type: 'counter', help: 'Dynamic QR scans recorded since the last reset.', value: scans },
    { name: 'nascon_active_stream_keys', type: 'gauge', help: 'Stream keys currently in the active state.', value: activeKeys },
    { name: 'nascon_media_server_up', type: 'gauge', help: '1 when the media server control API answered the last scrape.', value: mediaUp ? 1 : 0 },
  ];
}

async function metricsHandler(req, res) {
  const text = renderMetrics(await collect());
  res.status(200);
  res.set('Content-Type', CONTENT_TYPE);
  res.set('Cache-Control', 'no-store');
  res.end(text);
}

function resetForTests() {
  prevBitrate = new Map();
  mediaCache = { at: 0, paths: null, kbps: 0 };
}

module.exports = { metricsHandler, collect, resetForTests };
