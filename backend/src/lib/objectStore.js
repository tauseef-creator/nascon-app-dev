'use strict';
// Shared MinIO (S3) client for self-hosted object storage: order receipts (Day 1) and recorded VODs
// (FR-3.2). Connection settings come only from env (MINIO_ENDPOINT, MINIO_PORT, MINIO_ACCESS_KEY,
// MINIO_SECRET_KEY, MINIO_BUCKET). Storage is optional: without MINIO_ENDPOINT it is disabled.

let client = null;
const bucketReady = new Map(); // bucket -> Promise

const enabled = () => Boolean(process.env.MINIO_ENDPOINT);

function getClient() {
  if (!enabled()) return null;
  if (!client) {
    // eslint-disable-next-line global-require
    const Minio = require('minio');
    client = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || '',
      secretKey: process.env.MINIO_SECRET_KEY || '',
    });
  }
  return client;
}

// Default bucket (receipts); VODs may use their own bucket via MINIO_VOD_BUCKET.
const defaultBucket = () => process.env.MINIO_BUCKET || 'receipts';
const vodBucket = () => process.env.MINIO_VOD_BUCKET || defaultBucket();

/** Creates the bucket once per process. A failure is forgotten so the next call retries. */
function ensureBucket(bucket) {
  const c = getClient();
  if (!c) return Promise.reject(new Error('object storage disabled'));
  if (!bucketReady.has(bucket)) {
    const p = c.bucketExists(bucket)
      .then((ok) => (ok ? null : c.makeBucket(bucket)))
      .catch((e) => { bucketReady.delete(bucket); throw e; });
    bucketReady.set(bucket, p);
  }
  return bucketReady.get(bucket);
}

/** Test hook: drop the cached client and bucket state. */
function resetForTests(fakeClient = null) {
  client = fakeClient;
  bucketReady.clear();
}

module.exports = { enabled, getClient, ensureBucket, defaultBucket, vodBucket, resetForTests };
