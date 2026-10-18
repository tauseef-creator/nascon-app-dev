'use strict';
// Dynamic QR deep-linking rules (FR-4.1, spec Part II 5.6, edge case 2) and privacy-safe scan
// telemetry (NFR-9). Pure functions only: no DB, no HTTP.
const crypto = require('crypto');

const DEFAULT_BASE_URL = 'http://localhost:8080';
const EXPORT_FORMATS = ['svg', 'png', 'pdf'];
const EXPORT_CONTENT_TYPES = { svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf' };

// Entity id prefixes (FR-4.1). cs-session-* is checked before any shorter prefix.
const PREFIXES = [
  { prefix: 'cs-session-', type: 'costream', code: 'cs' },
  { prefix: 'match-', type: 'match', code: 'm' },
  { prefix: 'player-', type: 'player', code: 'p' },
  { prefix: 'club-', type: 'club', code: 'c' },
];
const TYPE_CODES = { match: 'm', player: 'p', club: 'c', costream: 'cs' };
const ENTITY_TYPES = Object.keys(TYPE_CODES);

// Statuses that send a scan to the notice page instead of a player view.
const NOTICE_STATUSES = ['postponed', 'cancelled', 'abandoned'];
const MATCH_ROUTES = { upcoming: 'preview', in_progress: 'live', completed: 'vod' };

function baseUrl(env = process.env) {
  const v = env.PUBLIC_BASE_URL;
  return typeof v === 'string' && /^https?:\/\/\S+$/.test(v) ? v.replace(/\/+$/, '') : DEFAULT_BASE_URL;
}

// Entity type implied by the id prefix, or null when the id carries no known prefix.
function entityTypeFromId(entityId) {
  if (typeof entityId !== 'string') return null;
  const hit = PREFIXES.find((p) => entityId.startsWith(p.prefix) && entityId.length > p.prefix.length);
  return hit ? hit.type : null;
}

/**
 * Current target route of an entity (spec 5.6 Dynamic Target Mutation Rule). For matches the
 * status is the effective one (event log plus FR-1.3 administrative overrides). Returns null for
 * an unknown type.
 */
function targetRoute(entityType, entityId, status) {
  switch (entityType) {
    case 'match': {
      if (NOTICE_STATUSES.includes(status)) return `/web/matches/${entityId}/notice?state=${status}`;
      return `/web/matches/${entityId}/${MATCH_ROUTES[status] || MATCH_ROUTES.upcoming}`;
    }
    case 'player':
      return `/web/players/${entityId}`;
    case 'club':
      return `/web/clubs/${entityId}`;
    case 'costream':
      return `/web/costream/${entityId}`;
    default:
      return null;
  }
}

// Deterministic short code for an entity that has no mapping yet: match-x -> m-x, player-x -> p-x,
// club-x -> c-x, cs-session-x -> cs-x; ids without a known prefix keep the whole id.
function shortCodeFor(entityId, entityType) {
  const hit = PREFIXES.find((p) => entityId.startsWith(p.prefix) && entityId.length > p.prefix.length);
  if (hit && hit.type === entityType) return `${hit.code}-${entityId.slice(hit.prefix.length)}`;
  return `${TYPE_CODES[entityType] || 'e'}-${entityId}`;
}

// Collision-free alternative when the deterministic code is already taken by another entity.
function fallbackShortCode(entityId, entityType) {
  const h = crypto.createHash('sha256').update(entityId, 'utf8').digest('hex').slice(0, 10);
  return `${TYPE_CODES[entityType] || 'e'}-${h}`;
}

const MOBILE_RE = /Mobi|Android|iPhone|iPad|iPod|Windows Phone|IEMobile|BlackBerry|BB10|webOS|Opera Mini|Kindle|Silk/i;

// Device family derived from the User-Agent (NFR-9). Only the family is kept, never the string.
function deviceFamily(userAgent) {
  return typeof userAgent === 'string' && MOBILE_RE.test(userAgent) ? 'mobile' : 'desktop';
}

// UTC hour bucket, e.g. 2026-10-18T11:00Z. Coarse on purpose: no exact scan time is stored.
function hourBucket(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.toISOString().slice(0, 13)}:00Z`;
}

function scanRecord(entityId, userAgent, date = new Date()) {
  return { entity_id: entityId, device_family: deviceFamily(userAgent), bucket: hourBucket(date) };
}

function shortUrl(code, base = DEFAULT_BASE_URL) {
  return `${base}/q/${code}`;
}

function deepLinkUri(entityId) {
  return `nascon://entity/${entityId}`;
}

function exportUrls(entityId, base = DEFAULT_BASE_URL) {
  const out = {};
  for (const f of EXPORT_FORMATS) out[f] = `${base}/audit/v1/qr/${entityId}/export.${f}`;
  return out;
}

function isExportFormat(fmt) {
  return EXPORT_FORMATS.includes(fmt);
}

/**
 * Response body of GET /audit/v1/qr/{entity_id} without the signature, plus the exact
 * sig_payload of spec 5.3: {entity_id, short_url, target_route}.
 */
function buildQrView({ entityId, entityType, entityStatus, shortCode, scanCount, base = DEFAULT_BASE_URL }) {
  const url = shortUrl(shortCode, base);
  const route = targetRoute(entityType, entityId, entityStatus);
  const body = {
    entity_id: entityId,
    entity_type: entityType,
    entity_status: entityStatus,
    short_url: url,
    target_route: route,
    deep_link_uri: deepLinkUri(entityId),
    scan_count: Number(scanCount),
    export_formats: exportUrls(entityId, base),
  };
  return { body, sigPayload: { entity_id: entityId, short_url: url, target_route: route } };
}

module.exports = {
  DEFAULT_BASE_URL,
  EXPORT_FORMATS,
  EXPORT_CONTENT_TYPES,
  ENTITY_TYPES,
  NOTICE_STATUSES,
  baseUrl,
  entityTypeFromId,
  targetRoute,
  shortCodeFor,
  fallbackShortCode,
  deviceFamily,
  hourBucket,
  scanRecord,
  shortUrl,
  deepLinkUri,
  exportUrls,
  isExportFormat,
  buildQrView,
};
