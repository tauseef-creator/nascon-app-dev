'use strict';
// Prometheus text exposition format 0.0.4 (spec Part II 5.9, NFR-6): pure rendering and bitrate math.

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Numbers are always finite in our output; anything else is reported as 0.
function formatValue(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function escapeHelp(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function escapeLabel(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels) {
  if (!labels) return '';
  const keys = Object.keys(labels).filter((k) => LABEL_RE.test(k)).sort();
  if (!keys.length) return '';
  return '{' + keys.map((k) => `${k}="${escapeLabel(labels[k])}"`).join(',') + '}';
}

/**
 * metrics: [{ name, help, type: 'gauge'|'counter', value } | { name, help, type, samples: [{labels, value}] }]
 * Returns the exposition text ending with a newline.
 */
function renderMetrics(metrics) {
  const lines = [];
  for (const m of metrics) {
    if (!NAME_RE.test(m.name)) throw new Error(`invalid metric name ${m.name}`);
    const type = m.type === 'counter' ? 'counter' : 'gauge';
    lines.push(`# HELP ${m.name} ${escapeHelp(m.help || m.name)}`);
    lines.push(`# TYPE ${m.name} ${type}`);
    const samples = Array.isArray(m.samples) ? m.samples : [{ value: m.value }];
    for (const s of samples) lines.push(`${m.name}${formatLabels(s.labels)} ${formatValue(s.value)}`);
  }
  return lines.join('\n') + '\n';
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ingest bitrate across live paths, in kbit/s.
 * paths: MediaMTX /v3/paths/list items ({ name, ready, readyTime, bytesReceived }).
 * prev: Map name -> { bytes, at } from the previous scrape (mutated copy is returned as `next`).
 * When a path has a previous sample, the rate is the delta since then; otherwise the average since readyTime.
 */
function streamBitrate(paths, prev, nowMs) {
  const next = new Map();
  let kbps = 0;
  let live = 0;
  for (const p of Array.isArray(paths) ? paths : []) {
    if (!p || !p.ready || typeof p.name !== 'string') continue;
    live += 1;
    const bytes = toNumber(p.bytesReceived);
    const before = prev && prev.get(p.name);
    let rate = 0;
    if (before && nowMs > before.at && bytes >= before.bytes) {
      rate = ((bytes - before.bytes) * 8) / 1000 / ((nowMs - before.at) / 1000);
    } else {
      const since = Date.parse(p.readyTime);
      if (Number.isFinite(since) && nowMs > since) rate = (bytes * 8) / 1000 / ((nowMs - since) / 1000);
    }
    kbps += rate;
    next.set(p.name, { bytes, at: nowMs });
  }
  return { kbps: Math.round(kbps * 1000) / 1000, live, next };
}

// Live ingest paths under live/ (solo streams) and costream/ (composites).
function countLivePaths(paths, prefix = 'live/') {
  return (Array.isArray(paths) ? paths : []).filter((p) => p && p.ready && typeof p.name === 'string' && p.name.startsWith(prefix)).length;
}

module.exports = { CONTENT_TYPE, formatValue, formatLabels, renderMetrics, streamBitrate, countLivePaths };
