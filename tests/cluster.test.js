'use strict';
// Multi-worker support (WEB_CONCURRENCY > 1): Redis pub/sub hub relay, shared sliding windows,
// cross-worker QR cache generation and the summed WebSocket gauge. Redis is replaced by an in-memory
// fake so the tests need no server.
const { EventEmitter } = require('events');

function fakeRedis() {
  const bus = new EventEmitter();
  const kv = new Map();
  const hashes = new Map();
  const make = () => {
    const c = new EventEmitter();
    c.status = 'ready';
    c.published = [];
    c.subscribe = async (ch) => { bus.on('msg', (channel, raw) => c.emit('message', channel, raw)); return ch; };
    c.publish = async (ch, raw) => { c.published.push(raw); bus.emit('msg', ch, raw); return 1; };
    c.get = async (k) => (kv.has(k) ? String(kv.get(k)) : null);
    c.incr = async (k) => { kv.set(k, (Number(kv.get(k)) || 0) + 1); return kv.get(k); };
    c.hset = async (k, f, v) => { if (!hashes.has(k)) hashes.set(k, {}); hashes.get(k)[f] = String(v); return 1; };
    c.hgetall = async (k) => ({ ...(hashes.get(k) || {}) });
    c.disconnect = () => {};
    return c;
  };
  return { make, kv, hashes, bus };
}

describe('realtime hub relay', () => {
  let realtime;
  beforeEach(() => {
    jest.resetModules();
    realtime = require('../backend/src/lib/realtime');
  });
  afterEach(() => realtime.disableClusterBus());

  test('single process: plain local emit, no Redis client', () => {
    const seen = [];
    realtime.hub.on('match', (id) => seen.push(id));
    realtime.hub.emit('match', 'm1');
    expect(seen).toEqual(['m1']);
    expect(realtime.clusterRedis()).toBeNull();
  });

  test('clustered: local listeners run synchronously and the event is published once', async () => {
    const r = fakeRedis();
    const pub = realtime.enableClusterBus({ createClient: r.make, origin: 'w1' });
    await realtime.whenSubscribed();
    const seen = [];
    realtime.hub.on('chat', (room, msg) => seen.push([room, msg.seq, realtime.hub.isRemoteDelivery()]));
    realtime.hub.emit('chat', 'room-1', { seq: 7 });
    expect(seen).toEqual([['room-1', 7, false]]); // own message is not delivered twice
    await new Promise((res) => setImmediate(res));
    expect(seen).toHaveLength(1);
    expect(pub.published.map((p) => JSON.parse(p))).toEqual([{ o: 'w1', e: 'chat', a: ['room-1', { seq: 7 }] }]);
    expect(realtime.enableClusterBus({ createClient: r.make })).toBe(pub); // idempotent
  });

  test('messages from another worker are re-emitted locally, flagged as remote', () => {
    const r = fakeRedis();
    realtime.enableClusterBus({ createClient: r.make, origin: 'w1' });
    const seen = [];
    realtime.hub.on('status', (id) => seen.push([id, realtime.hub.isRemoteDelivery()]));
    expect(realtime.deliverRemote(JSON.stringify({ o: 'w2', e: 'status', a: ['m9'] }))).toBe(true);
    expect(realtime.deliverRemote(JSON.stringify({ o: 'w1', e: 'status', a: ['own'] }))).toBe(false);
    expect(realtime.deliverRemote('not json')).toBe(false);
    expect(realtime.deliverRemote(JSON.stringify({ o: 'w2', e: 'error', a: [] }))).toBe(false);
    expect(seen).toEqual([['m9', true]]);
    expect(realtime.hub.isRemoteDelivery()).toBe(false);
  });

  test('a throwing remote listener never breaks delivery state', () => {
    realtime.enableClusterBus({ createClient: fakeRedis().make, origin: 'w1' });
    realtime.hub.on('pinned', () => { throw new Error('boom'); });
    expect(realtime.deliverRemote(JSON.stringify({ o: 'w2', e: 'pinned', a: ['m1'] }))).toBe(true);
    expect(realtime.hub.isRemoteDelivery()).toBe(false);
  });

  test('two workers sharing one Redis see each other\'s events', async () => {
    const r = fakeRedis();
    // Worker A in this module instance; worker B simulated through deliverRemote of A's payloads.
    const pub = realtime.enableClusterBus({ createClient: r.make, origin: 'A' });
    const b = [];
    jest.isolateModules(() => {
      const other = require('../backend/src/lib/realtime');
      other.enableClusterBus({ createClient: r.make, origin: 'B' });
      other.hub.on('match', (id) => b.push(id));
    });
    await new Promise((res) => setImmediate(res));
    realtime.hub.emit('match', 'match-m1');
    await new Promise((res) => setImmediate(res));
    expect(pub.published).toHaveLength(1);
    expect(b).toEqual(['match-m1']);
  });
});

describe('shared sliding window (lib/rateLimit)', () => {
  let rl;
  beforeEach(() => {
    jest.resetModules();
    rl = require('../backend/src/lib/rateLimit');
  });

  test('memory window: limit, rejected hits not recorded, rolls after the window', () => {
    const store = new Map();
    for (let i = 0; i < 3; i += 1) expect(rl.memoryHit('k', 1000 + i, 3, 2000, store).allowed).toBe(true);
    const r = rl.memoryHit('k', 1500, 3, 2000, store);
    expect(r).toEqual({ allowed: false, oldest: 1000 });
    expect(store.get('k')).toHaveLength(3);
    expect(rl.memoryHit('k', 3000, 3, 2000, store).allowed).toBe(true); // 1000 expired
  });

  test('Redis path: Lua result decides; errors fall back to memory', async () => {
    const calls = [];
    const redis = { eval: async (...a) => { calls.push(a); return [0, 4200]; } };
    expect(await rl.hit('rl:x', { limit: 5, windowMs: 1000, now: 5000, redis })).toEqual({ allowed: false, oldest: 4200 });
    expect(calls[0][0]).toBe(rl.SLIDING_WINDOW_LUA);
    expect(calls[0].slice(1, 6)).toEqual([1, 'rl:x', 5000, 1000, 5]);
    const ok = { eval: async () => [1, 0] };
    expect((await rl.hit('rl:x', { limit: 5, windowMs: 1000, now: 5000, redis: ok })).allowed).toBe(true);
    const store = new Map();
    const broken = { eval: async () => { throw new Error('down'); } };
    expect(await rl.hit('rl:y', { limit: 1, windowMs: 1000, now: 1, redis: broken, store })).toEqual({ allowed: true, oldest: 1 });
    expect((await rl.hit('rl:y', { limit: 1, windowMs: 1000, now: 2, redis: broken, store })).allowed).toBe(false);
  });

  test('Redis path times out to memory instead of hanging the request', async () => {
    const slow = { eval: () => new Promise(() => {}) };
    const t0 = Date.now();
    const r = await rl.hit('rl:z', { limit: 1, windowMs: 1000, now: 1, redis: slow, store: new Map() });
    expect(r.allowed).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test('middleware: clustered 429 with Retry-After and the standard error body', async () => {
    const realtime = require('../backend/src/lib/realtime');
    const r = fakeRedis();
    const pub = realtime.enableClusterBus({ createClient: r.make, origin: 'w1' });
    const now = Date.now();
    pub.eval = async () => [0, now - 4000];
    const res = {
      headers: {}, code: 0, body: null,
      set(k, v) { this.headers[k] = v; return this; },
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; return this; },
    };
    const next = jest.fn();
    await rl.rateLimit({ ip: '1.2.3.4', socket: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(429);
    expect(res.headers['Retry-After']).toBe('6');
    expect(res.body.error.code).toBe('RATE_LIMITED');
    pub.eval = async () => [1, 0];
    await rl.rateLimit({ ip: '1.2.3.4', socket: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    realtime.disableClusterBus();
  });

  test('middleware: single process stays synchronous (100 then 429)', () => {
    const res = { set() { return this; }, status(c) { this.code = c; return this; }, json() { return this; } };
    const next = jest.fn();
    for (let i = 0; i < rl.LIMIT; i += 1) rl.rateLimit({ ip: '9.9.9.9', socket: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(rl.LIMIT);
    rl.rateLimit({ ip: '9.9.9.9', socket: {} }, res, next);
    expect(res.code).toBe(429);
    rl._resetRateLimit();
  });
});

describe('WebSocket gauge across workers (services/day2/bus)', () => {
  test('sums this worker with the other workers\' reported counts', async () => {
    jest.resetModules();
    const realtime = require('../backend/src/lib/realtime');
    const bus = require('../backend/src/services/day2/bus');
    expect(await bus.totalConnections()).toBe(0);
    const r = fakeRedis();
    realtime.enableClusterBus({ createClient: r.make, origin: 'w1' });
    r.hashes.set(bus.WS_COUNTS_KEY, { 99991: '3', 99992: 'x' });
    const release = bus.trackConnection();
    await new Promise((res) => setImmediate(res));
    expect(r.hashes.get(bus.WS_COUNTS_KEY)[String(process.pid)]).toBe('1');
    expect(await bus.totalConnections()).toBe(4);
    release();
    release();
    expect(bus.connectionCount()).toBe(0);
    realtime.disableClusterBus();
  });
});

describe('production chat rate window across workers (services/day2/moderation)', () => {
  test('clustered: the shared window decides and reset clears the shared keys', async () => {
    jest.resetModules();
    const realtime = require('../backend/src/lib/realtime');
    const moderation = require('../backend/src/services/day2/moderation');
    const r = fakeRedis();
    const pub = realtime.enableClusterBus({ createClient: r.make, origin: 'w1' });
    const keys = [];
    pub.eval = async (script, n, key) => { keys.push(key); return [0, Date.now()]; };
    const stored = [];
    const query = async (sql) => {
      if (/FROM moderation_actions/.test(sql)) return { rows: [] };
      stored.push(sql);
      return [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
    };
    const out = await moderation.postChat({ roomId: 'room-1', sender: 'user-1', text: 'hello' }, { query });
    expect(out.accepted).toBe(false);
    expect(out.blocked.status).toBe(429);
    expect(keys).toEqual(['rl:chat:room-1|user-1']);
    const deleted = [];
    pub.scan = async () => ['0', ['rl:chat:room-1|user-1']];
    pub.del = async (...k) => { deleted.push(...k); return k.length; };
    await moderation.resetRateLimits();
    expect(deleted).toEqual(['rl:chat:room-1|user-1']);
    realtime.disableClusterBus();
  });
});
