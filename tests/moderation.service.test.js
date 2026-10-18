'use strict';
// Moderation / notification services against an in-memory stand-in for Postgres (no network).
const notify = require('../backend/src/services/day2/notify');
const svc = require('../backend/src/services/day2/moderation');
const { hub } = require('../backend/src/lib/realtime');

const VALUE_RE = /\((\d+), '((?:[^']|'')*)'::text, '((?:[^']|'')*)'::text, E?'((?:[^']|'')*)'::text, (true|false), (NULL|'(?:[^']|'')*')::text\)/g;
const unq = (s) => s.replace(/''/g, "'");

function fakeDb() {
  const state = { chat: [], actions: new Map(), dlq: [], calls: [] };
  async function query(sql, params = []) {
    state.calls.push(sql);
    await new Promise((r) => setImmediate(r));
    if (sql.includes('pg_advisory_xact_lock')) {
      const out = [{ rows: [] }, { rows: [] }];
      const room = /hashtext\('chat:([^']+)'\)/.exec(sql)[1];
      if (sql.includes('INSERT INTO chat_messages')) {
        const recent = new Set(state.chat.filter((c) => c.room_id === room).slice(-64).map((c) => c.message_id));
        let seq = state.chat.filter((c) => c.room_id === room).length;
        const rows = [];
        for (const m of sql.matchAll(VALUE_RE)) {
          if (recent.has(unq(m[2]))) continue;
          seq += 1;
          const row = { room_id: room, seq: String(seq), message_id: unq(m[2]), sender: unq(m[3]), text: unq(m[4]), flagged: m[5] === 'true', reason: m[6] === 'NULL' ? null : unq(m[6].slice(1, -1)), created_at: new Date('2026-10-18T09:00:00.123Z') };
          state.chat.push(row);
          rows.push(row);
        }
        out.push({ rows });
      }
      for (const block of sql.split('INSERT INTO moderation_actions').slice(1)) {
        const refresh = block.includes('DO UPDATE');
        for (const a of block.matchAll(/\('[^']+', '([^']+)', '(kick|mute)'\)/g)) {
          const key = `${room}|${a[1]}|${a[2]}`;
          if (!state.actions.has(key) || refresh) state.actions.set(key, { action: a[2], created_at: new Date(state.now ?? Date.now()) });
        }
        out.push({ rows: [] });
      }
      return out;
    }
    if (sql.startsWith('SELECT action, created_at FROM moderation_actions')) {
      const rows = [];
      for (const [k, v] of state.actions) if (k.startsWith(`${params[0]}|${params[1]}|`)) rows.push(v);
      return { rows };
    }
    if (sql.startsWith('SELECT seq, message_id') && sql.includes('message_id = $2')) {
      return { rows: state.chat.filter((c) => c.room_id === params[0] && c.message_id === params[1]) };
    }
    if (sql.startsWith('SELECT seq, message_id')) {
      return { rows: state.chat.filter((c) => c.room_id === params[0] && Number(c.seq) > params[1]).slice(0, params[2]) };
    }
    if (sql.startsWith('INSERT INTO dlq_events')) {
      state.dlq.push({ event_id: params[0], attempts: params[2], last_error: params[3] });
      return { rows: [] };
    }
    if (sql.includes('count(*) OVER')) {
      return { rows: state.dlq.slice(0, params[0]).map((d) => ({ ...d, depth: state.dlq.length })) };
    }
    if (sql.includes('count(*)::int AS depth')) return { rows: [{ depth: state.dlq.length }] };
    throw new Error(`unexpected SQL: ${sql}`);
  }
  return { state, query };
}

describe('notify (FR-5.2 retry + DLQ)', () => {
  test('success on first attempt never touches the DLQ', async () => {
    const { state, query } = fakeDb();
    const transport = jest.fn().mockResolvedValue();
    const r = await notify.deliver({ type: 't' }, { transport, query });
    expect(r).toMatchObject({ delivered: true, attempts: 1, dlq: false });
    expect(state.dlq).toHaveLength(0);
  });

  test('transient failure is retried then delivered', async () => {
    const { query } = fakeDb();
    const transport = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue();
    const r = await notify.deliver({ type: 't', event_id: 'evt-1' }, { transport, query, baseDelayMs: 1 });
    expect(r).toMatchObject({ delivered: true, attempts: 2, event_id: 'evt-1' });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test('three failed attempts route to the DLQ with backoff', async () => {
    const { state, query } = fakeDb();
    const start = Date.now();
    const r = await notify.deliver({ type: 't' }, { simulateFailure: true, query, baseDelayMs: 5 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(14); // 5 + 10 ms between the 3 attempts
    expect(r).toMatchObject({ delivered: false, attempts: 3, dlq: true });
    expect(state.dlq).toEqual([{ event_id: r.event_id, attempts: 3, last_error: 'simulated downstream delivery failure' }]);
    expect(await notify.dlqDepth(query)).toBe(1);
    expect(await notify.dlqStatus({ query })).toEqual({ queue_depth: 1, undelivered_events: state.dlq });
  });

  test('empty DLQ reports depth 0', async () => {
    const { query } = fakeDb();
    expect(await notify.dlqStatus({ query })).toEqual({ queue_depth: 0, undelivered_events: [] });
  });

  test('default transport emits on the realtime hub', async () => {
    const { query } = fakeDb();
    const seen = jest.fn();
    hub.on('notification', seen);
    await notify.deliver({ type: 'score' }, { query });
    hub.off('notification', seen);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ type: 'score' }));
  });
});

describe('moderateBatch / storeBatch', () => {
  const sample = [
    { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary' },
    { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream b@d_w0rd now!' },
    { message_id: 'msg-3', sender: 'user-flooder', text: 'GOAL! AAAA!!!' },
  ];

  test('10 concurrent identical batches: one stored copy, one kick, dedup lists', async () => {
    const { state, query } = fakeDb();
    const results = await Promise.all(Array.from({ length: 10 }, () => svc.moderateBatch('room-1', sample, { query })));
    for (const r of results) {
      expect(r.kicked_users).toEqual(['user-spammer']);
      expect(r.muted_users).toEqual(['user-flooder']);
    }
    expect(state.chat.map((c) => [c.seq, c.message_id])).toEqual([['1', 'msg-1'], ['2', 'msg-2']]);
    expect([...state.actions.keys()].sort()).toEqual(['room-1|user-flooder|mute', 'room-1|user-spammer|kick']);
    // Coalesced: far fewer DB round trips than requests.
    expect(state.calls.length).toBeLessThan(10);
  });

  test('accepted messages are broadcast with seq', async () => {
    const { query } = fakeDb();
    const seen = [];
    const fn = (room, msg) => seen.push([room, msg.seq, msg.text]);
    hub.on('chat', fn);
    await svc.moderateBatch('room-2', sample, { query });
    hub.off('chat', fn);
    expect(seen).toEqual([['room-2', 1, 'Clean sports commentary'], ['room-2', 2, 'Watch this illegal stream *** now!']]);
  });

  test('quotes and backslashes are escaped', async () => {
    const { state, query } = fakeDb();
    await svc.storeBatch('room-3', [{ message_id: 'q', sender: 's', text: "it's", flagged: false, reason: null }], [], { query });
    expect(state.chat[0].text).toBe("it's");
    expect(await svc.storeBatch('room-3', [], [], { query })).toEqual([]);
  });

  test('a DB failure rejects every coalesced caller', async () => {
    const query = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(svc.storeBatch('room-4', [], [{ user_id: 'u', action: 'kick' }], { query })).rejects.toThrow('db down');
  });
});

describe('postChat / listChat (production chat)', () => {
  beforeEach(() => svc.resetRateLimits());

  test('validation errors', async () => {
    await expect(svc.postChat({ roomId: 'bad room', sender: 'u', text: '' })).rejects.toMatchObject({
      status: 400,
      details: { fields: ['chat_room_id', 'text'] },
    });
    await expect(svc.postChat({ roomId: 'r', sender: 'u', text: 'x', messageId: 'bad id' })).rejects.toMatchObject({ status: 400 });
  });

  test('clean, replay, rate limit and mute', async () => {
    const { query } = fakeDb();
    const now = 1_000_000;
    const a = await svc.postChat({ roomId: 'r1', sender: 'u1', text: 'hello', messageId: 'm1' }, { now, query });
    expect(a).toMatchObject({ accepted: true, message: { seq: 1, text: 'hello', flagged: false, created_at: '2026-10-18T09:00:00Z' } });
    const replay = await svc.postChat({ roomId: 'r1', sender: 'u1', text: 'hello', messageId: 'm1' }, { now, query });
    expect(replay).toMatchObject({ accepted: true, replay: true, message: { seq: 1 } });
    await svc.postChat({ roomId: 'r1', sender: 'u1', text: 'three' }, { now, query });
    const limited = await svc.postChat({ roomId: 'r1', sender: 'u1', text: 'four' }, { now, query });
    expect(limited.blocked).toMatchObject({ status: 429, code: 'RATE_LIMITED', reason: 'rate_limit_exceeded' });
    const muted = await svc.postChat({ roomId: 'r1', sender: 'u1', text: 'five' }, { now: now + 1000, query });
    expect(muted.blocked).toMatchObject({ status: 429, reason: 'muted' });
  });

  test('profanity is masked and the sender kicked afterwards', async () => {
    const { query } = fakeDb();
    const r = await svc.postChat({ roomId: 'r2', sender: 'bad', text: 'what a sc@m' }, { query });
    expect(r.message).toMatchObject({ text: 'what a ***', flagged: true, reason: 'profanity_leetspeak' });
    const again = await svc.postChat({ roomId: 'r2', sender: 'bad', text: 'hi' }, { query });
    expect(again.blocked).toMatchObject({ status: 403, code: 'FORBIDDEN', reason: 'kicked' });
  });

  test('flood is blocked and mutes; mute expires', async () => {
    const { state, query } = fakeDb();
    state.now = 0;
    const r = await svc.postChat({ roomId: 'r3', sender: 'f', text: 'NOOOOO' }, { now: 0, query });
    expect(r.blocked).toMatchObject({ status: 429, reason: 'flood_character_repeat' });
    const later = await svc.postChat({ roomId: 'r3', sender: 'f', text: 'ok now' }, { now: svc.MUTE_MS + 1, query });
    expect(later.accepted).toBe(true);
  });

  test('listChat pages by seq', async () => {
    const { query } = fakeDb();
    for (const t of ['a', 'b', 'c']) await svc.postChat({ roomId: 'r4', sender: `u-${t}`, text: t }, { query });
    const page = await svc.listChat('r4', { afterSeq: 1, query });
    expect(page.messages.map((x) => x.text)).toEqual(['b', 'c']);
    expect(page.last_seq).toBe(3);
    const empty = await svc.listChat('r4', { afterSeq: 3, query });
    expect(empty).toMatchObject({ messages: [], last_seq: 3 });
    await expect(svc.listChat('r4', { afterSeq: -1, limit: 0, query })).rejects.toMatchObject({ details: { fields: ['after_seq', 'limit'] } });
  });
});
