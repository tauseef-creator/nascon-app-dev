'use strict';
// QR service + routes against an in-memory stand-in for Postgres (SQL dispatched by statement shape).
const express = require('express');
const request = require('supertest');

const mockDb = {};
function resetDb() {
  mockDb.matches = new Set(['match-m1', 'demo-m-7']);
  mockDb.players = new Set(['player-alpha-1', 'player-beta-2']);
  mockDb.clubs = new Set(['club-alpha-1']);
  mockDb.costream = new Map([['cs-session-101', { status: 'active' }]]);
  mockDb.overrides = new Map();
  mockDb.qr = new Map([
    ['match-m1', { short_code: 'm1-live', scan_count: '0' }],
    ['player-alpha-1', { short_code: 'p-alpha-1', scan_count: '0' }],
    ['club-alpha-1', { short_code: 'c-alpha-1', scan_count: '0' }],
  ]);
  mockDb.scans = [];
  mockDb.logStatus = { 'match-m1': 'in_progress', 'demo-m-7': 'completed' };
}

async function mockQuery(sql, params = []) {
  const id = params[0];
  if (sql.includes('AS is_match')) {
    const q = mockDb.qr.get(id);
    const cs = mockDb.costream.get(id);
    return { rows: [{
      is_match: mockDb.matches.has(id), is_player: mockDb.players.has(id), is_club: mockDb.clubs.has(id), is_costream: Boolean(cs),
      override_status: mockDb.overrides.get(id) || null, costream_status: cs ? cs.status : null,
      short_code: q ? q.short_code : null, scan_count: q ? q.scan_count : null,
    }] };
  }
  if (sql.startsWith('INSERT INTO qr_codes')) {
    const taken = [...mockDb.qr.values()].some((v) => v.short_code === params[1]);
    if (!mockDb.qr.has(id) && !taken) mockDb.qr.set(id, { short_code: params[1], scan_count: '0' });
    return { rows: [] };
  }
  if (sql.startsWith('SELECT short_code, scan_count FROM qr_codes')) {
    const q = mockDb.qr.get(id);
    return { rows: q ? [{ ...q }] : [] };
  }
  if (sql.includes('UPDATE qr_codes SET scan_count = scan_count + 1')) {
    const q = mockDb.qr.get(id);
    if (!q) return { rows: [] };
    q.scan_count = String(Number(q.scan_count) + 1);
    mockDb.scans.push({ entity_id: id, device_family: params[1], bucket: params[2] });
    return { rows: [{ scan_count: q.scan_count }] };
  }
  if (sql.startsWith('SELECT entity_id FROM qr_codes WHERE short_code')) {
    const hit = [...mockDb.qr.entries()].find(([, v]) => v.short_code === id);
    return { rows: hit ? [{ entity_id: hit[0] }] : [] };
  }
  if (sql.includes('SUM(scan_count)')) {
    return { rows: [{ total: String([...mockDb.qr.values()].reduce((s, v) => s + Number(v.scan_count), 0)) }] };
  }
  throw new Error(`unexpected SQL: ${sql}`);
}

jest.mock('../backend/src/db/pool', () => ({ query: (...a) => mockQuery(...a), tx: jest.fn(), pool: {} }));
jest.mock('../backend/src/services/events', () => ({
  getProjection: async (id) => (mockDb.matches.has(id) ? { status: mockDb.logStatus[id] || 'upcoming' } : null),
}));

const { signDay2 } = require('../backend/src/lib/signing');
const { errorHandler } = require('../backend/src/lib/errors');
const qr = require('../backend/src/services/day2/qr');

const app = express();
app.use('/audit/v1', require('../backend/src/routes/day2/qr'));
app.use(errorHandler);

const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';

beforeEach(() => { resetDb(); qr.clearQrCache(); });

describe('GET /audit/v1/qr/:entity_id', () => {
  test('spec 5.6 body, signature, scan increment and telemetry', async () => {
    const r = await request(app).get('/audit/v1/qr/match-m1').set('User-Agent', IPHONE);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      entity_id: 'match-m1', entity_type: 'match', entity_status: 'in_progress',
      short_url: 'http://localhost:8080/q/m1-live', target_route: '/web/matches/match-m1/live',
      deep_link_uri: 'nascon://entity/match-m1', scan_count: 1,
    });
    expect(r.body.signature).toBe(signDay2('match-m1', {
      entity_id: 'match-m1', short_url: 'http://localhost:8080/q/m1-live', target_route: '/web/matches/match-m1/live',
    }));
    expect(mockDb.scans).toEqual([{ entity_id: 'match-m1', device_family: 'mobile', bucket: expect.stringMatching(/T\d{2}:00Z$/) }]);
  });

  test('inspect=true does not count', async () => {
    const r = await request(app).get('/audit/v1/qr/match-m1?inspect=true');
    expect(r.body.scan_count).toBe(0);
    expect(mockDb.scans).toHaveLength(0);
  });

  test('edge case 2: status change keeps short_url, mutates route and signature', async () => {
    const a = (await request(app).get('/audit/v1/qr/match-m1?inspect=true')).body;
    const { hub } = require('../backend/src/lib/realtime');
    mockDb.logStatus['match-m1'] = 'completed';
    hub.emit('match', 'match-m1'); // production: emitted after the match_end event commits
    const b = (await request(app).get('/audit/v1/qr/match-m1?inspect=true')).body;
    mockDb.overrides.set('match-m1', 'postponed');
    hub.emit('status', 'match-m1'); // production: emitted after the status override commits
    const c = (await request(app).get('/audit/v1/qr/match-m1?inspect=true')).body;
    expect(b.short_url).toBe(a.short_url);
    expect(b.target_route).toBe('/web/matches/match-m1/vod');
    expect(c.target_route).toBe('/web/matches/match-m1/notice?state=postponed');
    expect(c.entity_status).toBe('postponed');
    expect(new Set([a.signature, b.signature, c.signature]).size).toBe(3);
  });

  test('player, club, co-stream and on-demand mappings', async () => {
    expect((await request(app).get('/audit/v1/qr/player-alpha-1')).body.target_route).toBe('/web/players/player-alpha-1');
    expect((await request(app).get('/audit/v1/qr/club-alpha-1')).body.short_url).toBe('http://localhost:8080/q/c-alpha-1');
    const cs = (await request(app).get('/audit/v1/qr/cs-session-101')).body;
    expect(cs).toMatchObject({ entity_type: 'costream', entity_status: 'active', target_route: '/web/costream/cs-session-101', short_url: 'http://localhost:8080/q/cs-101' });
    const p = (await request(app).get('/audit/v1/qr/player-beta-2?inspect=true')).body;
    expect(p).toMatchObject({ entity_type: 'player', short_url: 'http://localhost:8080/q/p-beta-2', scan_count: 0 });
    const m = (await request(app).get('/audit/v1/qr/demo-m-7')).body;
    expect(m).toMatchObject({ entity_type: 'match', entity_status: 'completed', target_route: '/web/matches/demo-m-7/vod', short_url: 'http://localhost:8080/q/m-demo-m-7' });
  });

  test('short code collision falls back to a hashed code', async () => {
    mockDb.qr.set('other', { short_code: 'p-beta-2', scan_count: '0' });
    const p = (await request(app).get('/audit/v1/qr/player-beta-2?inspect=true')).body;
    expect(p.short_url).toMatch(/\/q\/p-[a-f0-9]{10}$/);
  });

  test('unknown entity -> 404 QR_NOT_FOUND', async () => {
    for (const id of ['nope-404', 'match-ghost', "x'; DROP TABLE qr_codes;--"]) {
      const r = await request(app).get(`/audit/v1/qr/${encodeURIComponent(id)}`);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('QR_NOT_FOUND');
    }
  });
});

describe('exports', () => {
  test('svg, png, pdf with correct types and magic bytes, no scan counted', async () => {
    const svg = await request(app).get('/audit/v1/qr/match-m1/export.svg');
    expect(svg.status).toBe(200);
    expect(svg.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(String(svg.text || svg.body).trimStart().startsWith('<svg')).toBe(true);
    const png = await request(app).get('/audit/v1/qr/match-m1/export.png').buffer(true).parse(binary);
    expect(png.headers['content-type']).toMatch(/^image\/png/);
    expect(png.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const pdf = await request(app).get('/audit/v1/qr/match-m1/export.pdf').buffer(true).parse(binary);
    expect(pdf.headers['content-type']).toMatch(/^application\/pdf/);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(mockDb.scans).toHaveLength(0);
  }, 120000);

  test('bad format -> 400, unknown entity -> 404', async () => {
    const bad = await request(app).get('/audit/v1/qr/match-m1/export.jpg');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: ['fmt'] } });
    const nf = await request(app).get('/audit/v1/qr/nope/export.svg');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('QR_NOT_FOUND');
  });
});

describe('short code resolution (for GET /q/{code})', () => {
  test('resolves live target and counts the scan', async () => {
    expect(await qr.resolveShortCode('m1-live', 'Mozilla/5.0 (X11; Linux x86_64)'))
      .toEqual({ entity_id: 'match-m1', target_route: '/web/matches/match-m1/live' });
    expect(mockDb.qr.get('match-m1').scan_count).toBe('1');
    expect(mockDb.scans[0].device_family).toBe('desktop');
    expect(await qr.totalScans()).toBe(1);
  });
  test('unknown code -> 404', async () => {
    await expect(qr.resolveShortCode('zzz')).rejects.toMatchObject({ status: 404, code: 'QR_NOT_FOUND' });
    await expect(qr.resolveShortCode('')).rejects.toMatchObject({ status: 404, code: 'QR_NOT_FOUND' });
    await expect(qr.resolveShortCode(undefined)).rejects.toMatchObject({ status: 404, code: 'QR_NOT_FOUND' });
  });
});

describe('inspect read cache (NFR-2)', () => {
  test('repeat inspect reads are cached and a match event invalidates the entry', async () => {
    const { hub } = require('../backend/src/lib/realtime');
    const first = await qr.resolveEntity('match-m1', { inspect: true });
    const again = await qr.resolveEntity('match-m1', { inspect: true });
    expect(again).toBe(first); // served from cache
    hub.emit('match', 'match-m1');
    const fresh = await qr.resolveEntity('match-m1', { inspect: true });
    expect(fresh).not.toBe(first); // rebuilt after invalidation
    expect(fresh.short_url).toBe(first.short_url);
  });

  test('a counted scan invalidates the cached entry', async () => {
    const before = await qr.resolveEntity('match-m1', { inspect: true });
    await qr.resolveEntity('match-m1', { inspect: false });
    const after = await qr.resolveEntity('match-m1', { inspect: true });
    expect(after.scan_count).toBe(before.scan_count + 1);
  });
});


describe('inspect cache: single-flight and cross-worker generation', () => {
  const realtime = require('../backend/src/lib/realtime');
  afterEach(() => realtime.disableClusterBus());

  test('concurrent misses share one build', async () => {
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => qr.resolveEntity('match-m1', { inspect: true })));
    expect(a).toBe(b); // one build object shared by all three concurrent callers
    expect(b).toBe(c);
  });

  test('a shared generation bump by another worker forces a rebuild', async () => {
    const kv = new Map();
    const fake = () => {
      const c = new (require('events').EventEmitter)();
      c.status = 'ready';
      c.subscribe = async () => 1;
      c.publish = async () => 1;
      c.get = async (k) => (kv.has(k) ? String(kv.get(k)) : null);
      c.incr = async (k) => { kv.set(k, (kv.get(k) || 0) + 1); return kv.get(k); };
      c.disconnect = () => {};
      return c;
    };
    realtime.enableClusterBus({ createClient: fake, origin: 'w-test' });
    const first = await qr.resolveEntity('match-m1', { inspect: true });
    expect(await qr.resolveEntity('match-m1', { inspect: true })).toBe(first);
    kv.set('qr:gen', 41); // another worker counted a scan or saw a status change
    const rebuilt = await qr.resolveEntity('match-m1', { inspect: true });
    expect(rebuilt).not.toBe(first);
    await qr.resolveEntity('match-m1', { inspect: false }); // this worker counts a scan
    expect(kv.get('qr:gen')).toBeGreaterThanOrEqual(43); // bumped before and after the scan
    expect((await qr.resolveEntity('match-m1', { inspect: true })).scan_count).toBe(first.scan_count + 1);
    // A relayed (remote) event only drops the local entry; the origin worker already bumped Redis.
    const g = kv.get('qr:gen');
    realtime.deliverRemote(JSON.stringify({ o: 'other', e: 'match', a: ['match-m1'] }));
    expect(kv.get('qr:gen')).toBe(g);
    realtime.hub.emit('status', 'match-m1');
    await new Promise((res) => setImmediate(res));
    expect(kv.get('qr:gen')).toBe(g + 1);
  });

  test('Redis errors serve uncached instead of stale', async () => {
    const fake = () => {
      const c = new (require('events').EventEmitter)();
      c.subscribe = async () => 1;
      c.publish = async () => 1;
      c.get = async () => { throw new Error('down'); };
      c.incr = async () => { throw new Error('down'); };
      c.disconnect = () => {};
      return c;
    };
    realtime.enableClusterBus({ createClient: fake, origin: 'w-test' });
    const a = await qr.resolveEntity('match-m1', { inspect: true });
    const b = await qr.resolveEntity('match-m1', { inspect: true });
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });
});
