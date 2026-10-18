'use strict';
// Recorded-stream archive to self-hosted object storage (FR-3.2: "automated stream recording to
// self-hosted object storage (MinIO) and immediate VOD indexing upon stream termination").
// The VOD row is indexed first by streaming.onPathNotReady; this module then copies the MediaMTX
// recording segments from the shared recordings volume to MinIO and records the object keys on
// the row. Best effort: a missing file or an unreachable MinIO is logged and never fails the hook.
const fs = require('fs');
const nodePath = require('path');
const db = require('../../db/pool');
const objectStore = require('../../lib/objectStore');
const domain = require('../../domain/day2/streaming');

const recordingsRoot = () => process.env.RECORDINGS_DIR || '/recordings';
// MediaMTX finalizes the last segment as the path closes; wait briefly before reading it.
const uploadDelayMs = () => {
  const n = Number.parseInt(process.env.VOD_UPLOAD_DELAY_MS || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 3000;
};

async function listEntries(fsp, dir) {
  const names = await fsp.readdir(dir);
  const out = [];
  for (const name of names) {
    try {
      const st = await fsp.stat(nodePath.join(dir, name));
      if (st.isFile()) out.push({ name, mtimeMs: st.mtimeMs });
    } catch { /* removed meanwhile */ }
  }
  return out;
}

/**
 * Uploads the segments of one finished broadcast and stores bucket + keys on its vods row.
 * info: { vodId, path ('live/<key>'), startMs }. Returns { uploaded, reason?, bucket?, keys? }.
 * Never throws.
 */
async function archiveVod(info, deps = {}) {
  const {
    fsp = fs.promises, store = objectStore, query = db.query, log = console, root = recordingsRoot(),
  } = deps;
  const tag = `[vod-archive] ${info.vodId}`;
  try {
    if (!store.enabled()) return { uploaded: false, reason: 'storage_disabled' };
    const dir = nodePath.join(root, info.path);
    let entries;
    try {
      entries = await listEntries(fsp, dir);
    } catch (e) {
      log.warn(`${tag}: no recording directory ${dir} (${e.code || e.message})`);
      return { uploaded: false, reason: 'no_recording' };
    }
    const segments = domain.selectVodSegments(entries, info.startMs);
    if (!segments.length) {
      log.warn(`${tag}: no recorded segment found in ${dir}`);
      return { uploaded: false, reason: 'no_recording' };
    }
    const bucket = store.vodBucket();
    await store.ensureBucket(bucket);
    const client = store.getClient();
    const keys = [];
    for (const name of segments) {
      const key = domain.vodObjectKey(info.vodId, name);
      await client.fPutObject(bucket, key, nodePath.join(dir, name), { 'Content-Type': 'video/mp4' });
      keys.push(key);
    }
    await query('UPDATE vods SET storage_bucket = $2, storage_keys = $3 WHERE vod_id = $1',
      [info.vodId, bucket, JSON.stringify(keys)]);
    return { uploaded: true, bucket, keys };
  } catch (e) {
    log.warn(`${tag}: upload to object storage failed (${e && e.message})`);
    return { uploaded: false, reason: 'upload_failed' };
  }
}

/** Schedules archiveVod off the request path (the MediaMTX hook returns immediately). */
function scheduleArchive(info, deps = {}) {
  const delay = deps.delayMs ?? uploadDelayMs();
  const t = setTimeout(() => { archiveVod(info, deps).catch(() => {}); }, delay);
  if (t.unref) t.unref();
  return t;
}

module.exports = { archiveVod, scheduleArchive, recordingsRoot, uploadDelayMs };
