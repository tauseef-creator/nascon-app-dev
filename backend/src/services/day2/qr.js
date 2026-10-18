'use strict';
// Dynamic QR service (FR-4.1, spec Part II 5.6, NFR-9). Shared by GET /audit/v1/qr/* and the
// public short link GET /q/{short_code}.
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { query } = require('../../db/pool');
const { notFound, validation } = require('../../lib/errors');
const { isId } = require('../../lib/validate');
const { signDay2 } = require('../../lib/signing');
const { effectiveStatus } = require('../../domain/matchStatus');
const events = require('../events');
const Q = require('../../domain/day2/qr');

const qrNotFound = (details) => notFound('QR_NOT_FOUND', 'No dynamic QR mapping exists for this entity.', details);

// One round trip: which tables hold the id, its QR mapping, and status inputs.
async function loadEntityFacts(entityId) {
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM matches WHERE match_id = $1) AS is_match,
            EXISTS (SELECT 1 FROM players WHERE player_id = $1) AS is_player,
            EXISTS (SELECT 1 FROM clubs WHERE club_id = $1) AS is_club,
            EXISTS (SELECT 1 FROM costream_sessions WHERE session_id = $1) AS is_costream,
            (SELECT status FROM match_status WHERE match_id = $1) AS override_status,
            (SELECT response->>'status' FROM costream_sessions WHERE session_id = $1) AS costream_status,
            (SELECT short_code FROM qr_codes WHERE entity_id = $1) AS short_code,
            (SELECT scan_count FROM qr_codes WHERE entity_id = $1) AS scan_count`,
    [entityId]);
  return rows[0];
}

// Entity type: the prefix-implied type when that entity exists (or is already mapped), otherwise
// the first table that holds the id. null = unknown entity.
function pickType(entityId, f) {
  const exists = { match: f.is_match, player: f.is_player, club: f.is_club, costream: f.is_costream };
  const guessed = Q.entityTypeFromId(entityId);
  if (guessed && (exists[guessed] || f.short_code)) return guessed;
  return Q.ENTITY_TYPES.find((t) => exists[t]) || null;
}

async function entityStatus(type, entityId, f) {
  if (type === 'match') {
    const projection = f.is_match ? await events.getProjection(entityId) : null;
    return effectiveStatus(projection ? projection.status : 'upcoming', { status: f.override_status });
  }
  if (type === 'costream') return f.costream_status || 'active';
  return 'active';
}

// Create the mapping on demand with a deterministic short code; fall back to a hashed code when
// another entity already owns it. Returns { short_code, scan_count }.
async function ensureMapping(entityId, type) {
  const seeded = require('../../db/day2Seed').QR_MAPPINGS.find((m) => m.entity_id === entityId);
  const candidates = [seeded && seeded.short_code, Q.shortCodeFor(entityId, type), Q.fallbackShortCode(entityId, type)];
  for (const code of candidates.filter(Boolean)) {
    await query('INSERT INTO qr_codes (entity_id, short_code) VALUES ($1, $2) ON CONFLICT DO NOTHING', [entityId, code]);
    const { rows } = await query('SELECT short_code, scan_count FROM qr_codes WHERE entity_id = $1', [entityId]);
    if (rows.length) return rows[0];
  }
  throw qrNotFound({ entity_id: entityId });
}

// Atomic increment plus one privacy-safe scan row (device family + UTC hour bucket only).
async function recordScan(entityId, userAgent) {
  const scan = Q.scanRecord(entityId, userAgent);
  const { rows } = await query(
    `WITH u AS (
       UPDATE qr_codes SET scan_count = scan_count + 1 WHERE entity_id = $1 RETURNING entity_id, scan_count
     ), s AS (
       INSERT INTO qr_scans (entity_id, device_family, bucket) SELECT entity_id, $2::text, $3::text FROM u
     )
     SELECT scan_count FROM u`,
    [entityId, scan.device_family, scan.bucket]);
  if (!rows.length) throw qrNotFound({ entity_id: entityId });
  return rows[0].scan_count;
}

/**
 * Full spec 5.6 body for an entity. opts.inspect = true reads without counting a scan.
 * Throws ApiError 404 QR_NOT_FOUND for an unknown entity.
 */
// Read cache for ?inspect=true (NFR-2: 500 concurrent viewers). Entries are dropped the moment the
// entity can change: match events and status overrides (hub 'match' / 'status', emitted after commit),
// any counted scan, and /audit/v1/reset. The TTL is only a safety net.
// - Single-flight: concurrent misses for one entity share one DB build.
// - A local epoch is bumped on every invalidation, so a build that started before an invalidation is
//   never cached or shared after it.
// - Clustered (WEB_CONCURRENCY > 1): a Redis generation counter (qr:gen) is bumped on every
//   invalidation and read before serving a hit, so a scan or status change handled by one worker is
//   visible to the next inspect on any worker. If Redis fails, the request is served uncached.
const INSPECT_TTL_MS = 2000;
const GEN_KEY = 'qr:gen';
const inspectCache = new Map();
const inflight = new Map();
let epoch = 0;
const realtime = require('../../lib/realtime');

function bumpShared() {
  const redis = realtime.clusterRedis();
  if (!redis) return Promise.resolve();
  return redis.incr(GEN_KEY).then(() => {}, () => {});
}
function invalidateLocal(id) {
  epoch += 1;
  inspectCache.delete(id);
  inflight.delete(id);
}
const invalidate = (id) => { invalidateLocal(id); return bumpShared(); };
function clearQrCache() {
  epoch += 1;
  inspectCache.clear();
  inflight.clear();
  return bumpShared();
}
// Local listeners run on the worker that committed the change (which bumps the shared generation);
// relayed copies from other workers only need the local drop.
const onChange = (id) => (realtime.hub.isRemoteDelivery() ? invalidateLocal(id) : invalidate(id));
realtime.hub.on('match', onChange);
realtime.hub.on('status', onChange);

async function sharedGen() {
  const redis = realtime.clusterRedis();
  if (!redis) return 0;
  try {
    return Number(await redis.get(GEN_KEY)) || 0;
  } catch {
    return null; // Redis unavailable: no cache hits until it is back
  }
}

async function resolveInspect(entityId, userAgent) {
  const gen = await sharedGen();
  if (gen === null) return resolveEntityUncached(entityId, { inspect: true, userAgent });
  const hit = inspectCache.get(entityId);
  if (hit && hit.gen === gen && hit.epoch === epoch && Date.now() - hit.at < INSPECT_TTL_MS) return hit.body;
  const running = inflight.get(entityId);
  if (running && running.gen === gen && running.epoch === epoch) return running.promise;
  const started = { gen, epoch };
  const promise = resolveEntityUncached(entityId, { inspect: true, userAgent });
  inflight.set(entityId, { ...started, promise });
  try {
    const body = await promise;
    if (started.epoch === epoch) inspectCache.set(entityId, { ...started, at: Date.now(), body });
    return body;
  } finally {
    const cur = inflight.get(entityId);
    if (cur && cur.promise === promise) inflight.delete(entityId);
  }
}

async function resolveEntity(entityId, { inspect = false, userAgent = '' } = {}) {
  if (inspect) return resolveInspect(entityId, userAgent);
  await invalidate(entityId);
  try {
    return await resolveEntityUncached(entityId, { inspect, userAgent });
  } finally {
    await invalidate(entityId); // the scan is committed: drop anything built meanwhile
  }
}

async function resolveEntityUncached(entityId, { inspect = false, userAgent = '' } = {}) {
  if (!isId(entityId)) throw qrNotFound({ entity_id: String(entityId).slice(0, 64) });
  const facts = await loadEntityFacts(entityId);
  const type = pickType(entityId, facts);
  if (!type) throw qrNotFound({ entity_id: entityId });
  const mapping = facts.short_code ? { short_code: facts.short_code, scan_count: facts.scan_count } : await ensureMapping(entityId, type);
  const status = await entityStatus(type, entityId, facts);
  const scanCount = inspect ? mapping.scan_count : await recordScan(entityId, userAgent);
  const { body, sigPayload } = Q.buildQrView({
    entityId, entityType: type, entityStatus: status, shortCode: mapping.short_code, scanCount, base: Q.baseUrl(),
  });
  body.signature = signDay2(entityId, sigPayload);
  return body;
}

/**
 * Public short link (GET /q/{short_code}): counts the scan and returns the live target.
 * Throws ApiError 404 QR_NOT_FOUND for an unknown short code.
 */
async function resolveShortCode(shortCode, userAgent = '') {
  if (typeof shortCode !== 'string' || shortCode.length === 0 || shortCode.length > 128) {
    throw qrNotFound({ short_code: String(shortCode ?? '').slice(0, 128) });
  }
  const { rows } = await query('SELECT entity_id FROM qr_codes WHERE short_code = $1', [shortCode]);
  if (!rows.length) throw qrNotFound({ short_code: shortCode });
  const body = await resolveEntity(rows[0].entity_id, { inspect: false, userAgent });
  return { entity_id: body.entity_id, target_route: body.target_route };
}

// Total scans across all codes (for nascon_qr_scans_total).
async function totalScans() {
  const { rows } = await query('SELECT COALESCE(SUM(scan_count), 0)::bigint AS total FROM qr_codes');
  return Number(rows[0].total);
}

// Print-ready poster: the QR is drawn as vector modules (crisp at any print size, fast to render).
function renderPdf(entityId, url) {
  const code = QRCode.create(url, { errorCorrectionLevel: 'M' });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: `QR ${entityId}`, Author: 'NaSCon Sports Platform', Subject: url, Keywords: entityId },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(22).text('Scan to watch on NaSCon', { align: 'center' });
    doc.moveDown();
    const n = code.modules.size;
    const quiet = 4;
    const side = 320;
    const cell = side / (n + 2 * quiet);
    const x0 = (doc.page.width - side) / 2;
    const y0 = doc.y;
    doc.rect(x0, y0, side, side).fill('#FFFFFF');
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        if (code.modules.get(r, c)) doc.rect(x0 + (c + quiet) * cell, y0 + (r + quiet) * cell, cell, cell);
      }
    }
    doc.fill('#000000');
    doc.font('Helvetica-Bold').fontSize(16).text(entityId, 50, y0 + side + 20, { align: 'center' });
    doc.font('Helvetica').fontSize(12).text(url, { align: 'center' });
    doc.end();
  });
}

// Exports depend only on (format, short_url), which never changes once generated: memoize a bounded set.
const exportCache = new Map();
const EXPORT_CACHE_MAX = 300;

async function renderExport(fmt, entityId, url) {
  const key = `${fmt}|${entityId}|${url}`;
  if (exportCache.has(key)) return exportCache.get(key);
  const opts = { errorCorrectionLevel: 'M', margin: 4 };
  let body;
  if (fmt === 'svg') body = await QRCode.toString(url, { ...opts, type: 'svg' });
  else if (fmt === 'png') body = await QRCode.toBuffer(url, { ...opts, type: 'png', width: 512 });
  else body = await renderPdf(entityId, url);
  if (exportCache.size >= EXPORT_CACHE_MAX) exportCache.delete(exportCache.keys().next().value);
  exportCache.set(key, body);
  return body;
}

/**
 * QR export (spec 5.6): { contentType, body, filename } for fmt svg | png | pdf. Does not count a
 * scan. 400 VALIDATION_ERROR for an unknown format, 404 QR_NOT_FOUND for an unknown entity.
 */
async function exportQr(entityId, fmt) {
  if (!Q.isExportFormat(fmt)) throw validation(['fmt'], 'Export format must be svg, png or pdf.');
  const view = await resolveEntity(entityId, { inspect: true });
  const body = await renderExport(fmt, entityId, view.short_url);
  return { contentType: Q.EXPORT_CONTENT_TYPES[fmt], body, filename: `qr-${entityId}.${fmt}` };
}

module.exports = { resolveEntity, resolveShortCode, exportQr, totalScans, clearQrCache };
