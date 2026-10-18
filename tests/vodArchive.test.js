'use strict';
// FR-3.2: recorded streams are copied to MinIO after the VOD row is indexed (best effort).
jest.mock('../backend/src/db/pool', () => ({ query: async () => ({ rows: [] }), tx: async (fn) => fn({ query: async () => ({ rows: [] }) }) }));

const domain = require('../backend/src/domain/day2/streaming');
const vod = require('../backend/src/services/day2/vodArchive');
const objectStore = require('../backend/src/lib/objectStore');

const START = Date.parse('2026-10-18T07:00:00Z');
const quietLog = () => ({ warn: jest.fn() });

function fakeFs(files) {
  return {
    readdir: async (dir) => {
      if (!files[dir]) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return Object.keys(files[dir]);
    },
    stat: async (p) => {
      const dir = p.slice(0, p.lastIndexOf('/'));
      const f = files[dir] && files[dir][p.slice(p.lastIndexOf('/') + 1)];
      if (!f) throw new Error('gone');
      return { isFile: () => f.file !== false, mtimeMs: f.mtimeMs };
    },
  };
}

function fakeStore({ enabled = true, failPut = false, failBucket = false } = {}) {
  const puts = [];
  return {
    puts,
    enabled: () => enabled,
    vodBucket: () => 'receipts',
    ensureBucket: async () => { if (failBucket) throw new Error('minio down'); },
    getClient: () => ({
      fPutObject: async (bucket, key, file, meta) => {
        if (failPut) throw new Error('connection refused');
        puts.push({ bucket, key, file, meta });
      },
    }),
  };
}

describe('selectVodSegments / vodObjectKey', () => {
  test('keeps mp4 segments written during the broadcast, sorted', () => {
    const entries = [
      { name: '2026-10-18_07-10-00-000000.mp4', mtimeMs: START + 600000 },
      { name: '2026-10-18_07-00-00-500000.mp4', mtimeMs: START + 100 },
      { name: '2026-10-18_06-00-00-000000.mp4', mtimeMs: START - 60000 }, // previous broadcast
      { name: 'notes.txt', mtimeMs: START + 10 },
      { name: '../evil.mp4', mtimeMs: START + 10 },
      { name: 'x.mp4', mtimeMs: NaN },
      null,
    ];
    expect(domain.selectVodSegments(entries, START)).toEqual(['2026-10-18_07-00-00-500000.mp4', '2026-10-18_07-10-00-000000.mp4']);
    expect(domain.selectVodSegments([{ name: 'a.mp4', mtimeMs: START - 1500 }], START)).toEqual(['a.mp4']);
    expect(domain.selectVodSegments(null, START)).toEqual([]);
  });
  test('object key layout', () => {
    expect(domain.vodObjectKey('vod-sk-1', 'a.mp4')).toBe('vods/vod-sk-1/a.mp4');
  });
});

describe('archiveVod', () => {
  const info = { vodId: 'vod-sk_live_abc-1', path: 'live/sk_live_abc', startMs: START };
  const files = { '/rec/live/sk_live_abc': {
    'old.mp4': { mtimeMs: START - 90000 },
    'seg1.mp4': { mtimeMs: START + 5000 },
    sub: { mtimeMs: START + 5000, file: false },
  } };

  test('uploads the segments and stores bucket + keys on the vods row', async () => {
    const store = fakeStore();
    const query = jest.fn(async () => ({ rows: [] }));
    const r = await vod.archiveVod(info, { fsp: fakeFs(files), store, query, log: quietLog(), root: '/rec' });
    expect(r).toEqual({ uploaded: true, bucket: 'receipts', keys: ['vods/vod-sk_live_abc-1/seg1.mp4'] });
    expect(store.puts).toEqual([{ bucket: 'receipts', key: 'vods/vod-sk_live_abc-1/seg1.mp4', file: '/rec/live/sk_live_abc/seg1.mp4', meta: { 'Content-Type': 'video/mp4' } }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE vods SET storage_bucket'),
      ['vod-sk_live_abc-1', 'receipts', JSON.stringify(['vods/vod-sk_live_abc-1/seg1.mp4'])]);
  });

  test('missing recording, empty directory, disabled storage: no upload, no throw', async () => {
    const query = jest.fn();
    const log = quietLog();
    expect(await vod.archiveVod(info, { fsp: fakeFs({}), store: fakeStore(), query, log, root: '/rec' }))
      .toEqual({ uploaded: false, reason: 'no_recording' });
    expect(await vod.archiveVod(info, { fsp: fakeFs({ '/rec/live/sk_live_abc': { 'old.mp4': { mtimeMs: 1 } } }), store: fakeStore(), query, log, root: '/rec' }))
      .toEqual({ uploaded: false, reason: 'no_recording' });
    expect(await vod.archiveVod(info, { fsp: fakeFs(files), store: fakeStore({ enabled: false }), query, log, root: '/rec' }))
      .toEqual({ uploaded: false, reason: 'storage_disabled' });
    expect(query).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  test('MinIO down or upload error is logged; the VOD row is left as indexed', async () => {
    const query = jest.fn();
    for (const store of [fakeStore({ failBucket: true }), fakeStore({ failPut: true })]) {
      const log = quietLog();
      expect(await vod.archiveVod(info, { fsp: fakeFs(files), store, query, log, root: '/rec' }))
        .toEqual({ uploaded: false, reason: 'upload_failed' });
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('upload to object storage failed'));
    }
    expect(query).not.toHaveBeenCalled();
  });

  test('scheduleArchive runs off the request path', async () => {
    const store = fakeStore();
    const t = vod.scheduleArchive(info, { fsp: fakeFs(files), store, query: async () => ({}), log: quietLog(), root: '/rec', delayMs: 0 });
    expect(t).toBeDefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.puts).toHaveLength(1);
  });

  test('env defaults', () => {
    const old = { ...process.env };
    delete process.env.RECORDINGS_DIR;
    delete process.env.VOD_UPLOAD_DELAY_MS;
    expect(vod.recordingsRoot()).toBe('/recordings');
    expect(vod.uploadDelayMs()).toBe(3000);
    process.env.VOD_UPLOAD_DELAY_MS = '0';
    expect(vod.uploadDelayMs()).toBe(0);
    process.env.VOD_UPLOAD_DELAY_MS = 'x';
    expect(vod.uploadDelayMs()).toBe(3000);
    process.env = old;
  });
});

describe('objectStore', () => {
  const old = { ...process.env };
  afterEach(() => { process.env = { ...old }; objectStore.resetForTests(); });

  test('disabled without MINIO_ENDPOINT', async () => {
    delete process.env.MINIO_ENDPOINT;
    objectStore.resetForTests();
    expect(objectStore.enabled()).toBe(false);
    expect(objectStore.getClient()).toBeNull();
    await expect(objectStore.ensureBucket('b')).rejects.toThrow('disabled');
  });

  test('bucket names from env', () => {
    delete process.env.MINIO_BUCKET;
    delete process.env.MINIO_VOD_BUCKET;
    expect(objectStore.defaultBucket()).toBe('receipts');
    expect(objectStore.vodBucket()).toBe('receipts');
    process.env.MINIO_VOD_BUCKET = 'vods';
    expect(objectStore.vodBucket()).toBe('vods');
  });

  test('creates a missing bucket once and retries after a failure', async () => {
    process.env.MINIO_ENDPOINT = 'minio';
    let exists = false;
    let fail = true;
    const fake = {
      bucketExists: jest.fn(async () => { if (fail) throw new Error('down'); return exists; }),
      makeBucket: jest.fn(async () => { exists = true; }),
    };
    objectStore.resetForTests(fake);
    await expect(objectStore.ensureBucket('vods')).rejects.toThrow('down');
    fail = false;
    await objectStore.ensureBucket('vods');
    await objectStore.ensureBucket('vods');
    expect(fake.makeBucket).toHaveBeenCalledTimes(1);
    expect(fake.bucketExists).toHaveBeenCalledTimes(2);
  });

  test('real client is built from env', () => {
    process.env.MINIO_ENDPOINT = 'localhost';
    process.env.MINIO_PORT = '9000';
    objectStore.resetForTests();
    const c = objectStore.getClient();
    expect(c).toBeTruthy();
    expect(objectStore.getClient()).toBe(c);
  });
});
