'use strict';
// FR-5.2: order status transitions are pushed in real time to the owning user over /ws/users/me.
const http = require('http');
const WebSocket = require('../backend/node_modules/ws');

jest.mock('../backend/src/db/pool', () => ({ query: async () => ({ rows: [] }), tx: async (fn) => fn({ query: async () => ({ rows: [] }) }), pool: {} }));

const { attachWebSockets, parseRoute, userRooms } = require('../backend/src/routes/day2/ws');
const { issueToken } = require('../backend/src/lib/auth');
const store = require('../backend/src/services/store');

let server;
let port;
beforeAll(async () => {
  server = http.createServer();
  attachWebSockets(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

// Opens a socket and collects frames; resolves once the first frame arrived.
function open(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const frames = [];
    const waiters = [];
    ws.on('message', (d) => {
      frames.push(JSON.parse(String(d)));
      while (waiters.length) waiters.shift()();
    });
    ws.closeInfo = new Promise((r) => ws.on('close', (code) => r(code)));
    ws.next = (n) => new Promise((r) => {
      const check = () => (frames.length >= n ? r(frames[n - 1]) : waiters.push(check));
      check();
    });
    ws.frames = frames;
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

const PLAYER = { user_id: 'user-player', role: 'player', tenant_id: 'tenant-alpha', player_id: 'player-alpha-1' };
const VIEWER = { user_id: 'user-viewer', role: 'viewer', tenant_id: 'tenant-alpha' };

describe('user notification channel', () => {
  test('route parsing and rooms', () => {
    expect(parseRoute('/ws/users/me?token=x')).toMatchObject({ kind: 'users', id: 'me' });
    expect(userRooms(PLAYER)).toEqual(['user:user-player', 'user:player-alpha-1']);
    expect(userRooms({ user_id: 'u1', player_id: null })).toEqual(['user:u1']);
  });

  test('owner receives order_status frames; other users do not', async () => {
    const mine = await open(`/ws/users/me?token=${issueToken(PLAYER)}`);
    const other = await open(`/ws/users/me?token=${issueToken(VIEWER)}`);
    expect(await mine.next(1)).toEqual({ type: 'subscribed', user_id: 'user-player' });
    expect(await other.next(1)).toEqual({ type: 'subscribed', user_id: 'user-viewer' });

    store.pushOrderStatus({ order_id: 'ord-1', customer_id: 'player-alpha-1', from: 'pending', to: 'paid', at: '2026-10-18T07:00:00.000Z', reason: null });
    const f = await mine.next(2);
    expect(f.type).toBe('order_status');
    expect(f.data).toMatchObject({ type: 'order_status', order_id: 'ord-1', user_id: 'player-alpha-1', status: 'paid', from: 'pending', to: 'paid' });
    expect(f.data.event_id).toMatch(/^evt_/);

    store.pushOrderStatus({ order_id: 'ord-2', customer_id: 'user-viewer', from: 'pending', to: 'cancelled', at: '2026-10-18T07:00:01.000Z', reason: 'CARD_DECLINED' });
    expect(await other.next(2)).toMatchObject({ type: 'order_status', data: { order_id: 'ord-2', status: 'cancelled', reason: 'CARD_DECLINED' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(mine.frames).toHaveLength(2);
    expect(other.frames).toHaveLength(2);
    store.pushOrderStatus({ order_id: 'ord-3', customer_id: null, from: 'pending', to: 'paid' }); // no owner: nothing sent
    mine.close();
    other.close();
  });

  test('missing or bad token is rejected; another user id is forbidden', async () => {
    const anon = await open('/ws/users/me');
    expect(await anon.next(1)).toEqual({ type: 'error', code: 'UNAUTHENTICATED' });
    expect(await anon.closeInfo).toBe(4401);
    const spoof = await open(`/ws/users/user-admin?token=${issueToken(VIEWER)}`);
    expect(await spoof.next(1)).toEqual({ type: 'error', code: 'FORBIDDEN' });
    expect(await spoof.closeInfo).toBe(4403);
  });
});
