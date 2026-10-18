'use strict';
const crypto = require('crypto');
const c = require('../backend/src/domain/day2/costream');
const { signDay2 } = require('../backend/src/lib/signing');

const SALT = 'T01D27ad7ffff12e';
const sign = (id, payload) => signDay2(id, payload, SALT);
const P4 = ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'];
const base = { session_id: 'cs-session-101', host_player_id: 'player-alpha-1', participants: P4, layout: 'grid_4', simulate_host_drop: true };

const ok = (body) => {
  const v = c.validateSessionRequest(body);
  expect(v.ok).toBe(true);
  return v.value;
};

describe('validateSessionRequest (step 1)', () => {
  test('applies defaults', () => {
    expect(ok({ session_id: 's', host_player_id: 'h', participants: ['h'] })).toEqual({
      session_id: 's', host_player_id: 'h', participants: ['h'], layout: 'grid_4', simulate_host_drop: false,
    });
    expect(ok({ session_id: 's', host_player_id: 'h', participants: ['h'], layout: null, simulate_host_drop: null }).layout).toBe('grid_4');
  });
  test.each(c.LAYOUTS)('accepts layout %s', (layout) => {
    expect(ok({ ...base, layout }).layout).toBe(layout);
  });
  test.each([
    [{ ...base, session_id: undefined }, ['session_id']],
    [{ ...base, session_id: 'bad id!' }, ['session_id']],
    [{ ...base, host_player_id: 3 }, ['host_player_id']],
    [{ ...base, host_player_id: '' }, ['host_player_id']],
    [{ ...base, participants: [] }, ['participants']],
    [{ ...base, participants: 'p' }, ['participants']],
    [{ ...base, participants: ['a', 'a'] }, ['participants']],
    [{ ...base, participants: ['a', 2] }, ['participants']],
    [{ ...base, layout: 'pip' }, ['layout']],
    [{ ...base, layout: 4 }, ['layout']],
    [{ ...base, simulate_host_drop: 'true' }, ['simulate_host_drop']],
    [null, ['session_id', 'host_player_id', 'participants']],
  ])('rejects %j', (body, fields) => {
    expect(c.validateSessionRequest(body)).toEqual({ ok: false, fields });
  });
});

describe('checkRules (steps 2-4, exact order)', () => {
  test('missing players -> 404 before membership and capacity', () => {
    const req = ok({ ...base, host_player_id: 'ghost', participants: [...P4, 'x5'] });
    expect(c.referencedPlayers(req)).toEqual([...P4, 'x5', 'ghost']);
    expect(c.checkRules(req, ['x5', 'ghost'])).toEqual({ ok: false, httpStatus: 404, code: 'PLAYER_NOT_FOUND', details: { player_ids: ['x5', 'ghost'] } });
  });
  test('host not a participant -> 400 VALIDATION_ERROR', () => {
    const r = c.checkRules(ok({ ...base, host_player_id: 'player-beta-2', participants: ['player-alpha-1'] }));
    expect(r).toMatchObject({ ok: false, httpStatus: 400, code: 'VALIDATION_ERROR', fields: ['host_player_id'] });
  });
  test('more than 4 participants -> 409 COSTREAM_SESSION_FULL (before layout)', () => {
    const r = c.checkRules(ok({ ...base, participants: [...P4, 'p5'], layout: 'solo' }), []);
    expect(r).toEqual({ ok: false, httpStatus: 409, code: 'COSTREAM_SESSION_FULL', details: { max_participants: 4, requested: 5 } });
  });
  test('layout capacity uses the effective count after the drop', () => {
    expect(c.checkRules(ok({ ...base, layout: 'grid_2', simulate_host_drop: false }))).toMatchObject({ httpStatus: 400, code: 'UNSUPPORTED_LAYOUT' });
    expect(c.checkRules(ok({ ...base, layout: 'grid_2', simulate_host_drop: true }))).toMatchObject({ code: 'UNSUPPORTED_LAYOUT' });
    expect(c.checkRules(ok({ ...base, participants: P4.slice(0, 3), layout: 'grid_2', simulate_host_drop: true }))).toEqual({ ok: true });
    expect(c.checkRules(ok({ ...base, participants: P4.slice(0, 2), layout: 'solo', simulate_host_drop: true }))).toEqual({ ok: true });
    expect(c.checkRules(ok({ ...base, participants: P4.slice(0, 2), layout: 'solo', simulate_host_drop: false }))).toMatchObject({ code: 'UNSUPPORTED_LAYOUT' });
    expect(c.checkRules(ok({ ...base, participants: ['player-alpha-1'], layout: 'solo' }))).toEqual({ ok: true });
    expect(c.checkRules(ok({ ...base, layout: 'spotlight' }))).toEqual({ ok: true });
  });
  test('effectiveCount', () => {
    expect(c.effectiveCount({ participants: P4, simulate_host_drop: false })).toBe(4);
    expect(c.effectiveCount({ participants: P4, simulate_host_drop: true })).toBe(3);
    expect(c.effectiveCount({ participants: ['a'], simulate_host_drop: true })).toBe(0);
  });
});

describe('resolveSession and sessionResponse (step 5)', () => {
  test('spec example: host drop hands off to participants[1]', () => {
    const req = ok(base);
    const r = c.sessionResponse(req.session_id, req.layout, c.resolveSession(req), sign);
    const expectedSig = crypto.createHmac('sha256', SALT).update(
      'cs-session-101|{"active_host":"player-alpha-2","handoff_occurred":true,"layout":"grid_4","participant_count":3,"session_id":"cs-session-101","status":"active"}',
    ).digest('hex');
    expect(r).toEqual({
      session_id: 'cs-session-101',
      status: 'active',
      active_host: 'player-alpha-2',
      handoff_occurred: true,
      participant_count: 3,
      active_participants: ['player-alpha-2', 'player-beta-1', 'player-beta-2'],
      layout: 'grid_4',
      composite_playback_url: 'http://localhost:8888/costream/cs-session-101/index.m3u8',
      chat_room_id: 'chat-cs-session-101',
      signature: expectedSig,
    });
    expect(Object.keys(r)).toEqual(['session_id', 'status', 'active_host', 'handoff_occurred', 'participant_count',
      'active_participants', 'layout', 'composite_playback_url', 'chat_room_id', 'signature']);
  });
  test('host not first: remaining keeps array order', () => {
    const s = c.resolveSession(ok({ ...base, host_player_id: 'player-beta-1' }));
    expect(s.active_host).toBe('player-alpha-1');
    expect(s.active_participants).toEqual(['player-alpha-1', 'player-alpha-2', 'player-beta-2']);
  });
  test('no drop keeps the original host', () => {
    expect(c.resolveSession(ok({ ...base, simulate_host_drop: false }))).toEqual({
      status: 'active', active_host: 'player-alpha-1', handoff_occurred: false, participant_count: 4, active_participants: P4,
    });
  });
  test('sole host drop terminates cleanly', () => {
    const req = ok({ ...base, participants: ['player-alpha-1'], layout: 'solo' });
    const r = c.sessionResponse(req.session_id, req.layout, c.resolveSession(req), sign);
    expect(r).toMatchObject({ status: 'terminated', active_host: null, handoff_occurred: false, participant_count: 0, active_participants: [] });
    expect(r.signature).toBe(sign('cs-session-101', { active_host: null, handoff_occurred: false, layout: 'solo', participant_count: 0, session_id: 'cs-session-101', status: 'terminated' }));
  });
  test('urls and chat room derive from session_id only', () => {
    expect(c.compositeUrl('x')).toBe('http://localhost:8888/costream/x/index.m3u8');
    expect(c.chatRoomId('x')).toBe('chat-x');
  });
});

describe('applyDisconnect (live presence handoff)', () => {
  const live = { status: 'active', active_host: 'a', handoff_occurred: false, participant_count: 3, active_participants: ['a', 'b', 'c'] };
  test('host leaves -> next in order', () => {
    expect(c.applyDisconnect(live, 'a')).toEqual({ changed: true, state: { ...live, active_host: 'b', handoff_occurred: true, participant_count: 2, active_participants: ['b', 'c'] } });
  });
  test('non-host leaves -> no handoff', () => {
    expect(c.applyDisconnect(live, 'c').state).toMatchObject({ active_host: 'a', handoff_occurred: false, participant_count: 2 });
  });
  test('last participant leaves -> terminated', () => {
    expect(c.applyDisconnect({ ...live, active_participants: ['a'], participant_count: 1 }, 'a').state)
      .toMatchObject({ status: 'terminated', active_host: null, participant_count: 0, active_participants: [] });
  });
  test('unknown player or ended session -> unchanged', () => {
    expect(c.applyDisconnect(live, 'zz').changed).toBe(false);
    expect(c.applyDisconnect({ ...live, status: 'terminated' }, 'a').changed).toBe(false);
    expect(c.applyDisconnect({ status: 'active' }, 'a').changed).toBe(false);
  });
});

describe('applyControl (host moderation)', () => {
  const live = { status: 'active', active_host: 'a', handoff_occurred: false, participant_count: 3, active_participants: ['a', 'b', 'c'], muted: [], spotlight: null };
  test('mute / unmute', () => {
    const m = c.applyControl(live, 'mute', 'b');
    expect(m.state.muted).toEqual(['b']);
    expect(c.applyControl(m.state, 'unmute', 'b').state.muted).toEqual([]);
    expect(c.applyControl({ ...live, muted: undefined }, 'mute', 'c').state.muted).toEqual(['c']);
  });
  test('spotlight', () => {
    expect(c.applyControl(live, 'spotlight', 'c').state.spotlight).toBe('c');
  });
  test('kick removes the player, mute and spotlight', () => {
    const st = { ...live, muted: ['b'], spotlight: 'b' };
    const k = c.applyControl(st, 'kick', 'b');
    expect(k.state).toMatchObject({ active_participants: ['a', 'c'], participant_count: 2, muted: [], spotlight: null });
    expect(c.applyControl({ ...live, spotlight: 'c' }, 'kick', 'b').state.spotlight).toBe('c');
    expect(c.applyControl({ ...live, spotlight: undefined }, 'kick', 'b').state.spotlight).toBeNull();
    expect(c.applyControl(live, 'kick', 'a').state.active_host).toBe('b');
  });
  test('errors', () => {
    expect(c.applyControl(live, 'ban', 'b')).toEqual({ ok: false, code: 'INVALID_ACTION' });
    expect(c.applyControl({ ...live, status: 'terminated' }, 'mute', 'b')).toEqual({ ok: false, code: 'SESSION_TERMINATED' });
    expect(c.applyControl(live, 'mute', 'zz')).toEqual({ ok: false, code: 'NOT_PARTICIPANT' });
    expect(c.applyControl({ status: 'active' }, 'mute', 'zz')).toEqual({ ok: false, code: 'NOT_PARTICIPANT' });
  });
});

describe('compositeArgs (FR-3.3 compositor)', () => {
  const u = (k) => `rtmp://localhost:1935/live/${k}`;
  const out = 'rtmp://localhost:1935/costream/cs-1';
  const filterOf = (args) => args[args.indexOf('-filter_complex') + 1];
  const inputsOf = (args) => args.filter((_, i) => args[i - 1] === '-i');
  test('no inputs or unsafe urls -> null', () => {
    expect(c.compositeArgs({ inputs: [], layout: 'grid_4', output: out })).toBeNull();
    expect(c.compositeArgs({ inputs: undefined, layout: 'grid_4', output: out })).toBeNull();
    expect(c.compositeArgs({ inputs: ['rtmp://h/live/a b'], layout: 'grid_4', output: out })).toBeNull();
    expect(c.compositeArgs({ inputs: [u('a')], layout: 'grid_4', output: 'file:/etc/x' })).toBeNull();
    expect(c.compositeArgs({ inputs: [u('a')], layout: 'grid_4' })).toBeNull();
  });
  test('rtsp inputs are read over tcp', () => {
    const a = c.compositeArgs({ inputs: ['rtsp://localhost:8554/live/a'], layout: 'grid_4', output: out });
    expect(a.slice(3, 9)).toEqual(['-rtsp_transport', 'tcp', '-fflags', 'nobuffer', '-i', 'rtsp://localhost:8554/live/a']);
  });
  test('one input fills the frame; output is the composite path', () => {
    const a = c.compositeArgs({ inputs: [u('a')], layout: 'grid_4', output: out });
    expect(filterOf(a)).toBe('[0:v]scale=1280:720,setsar=1[v]');
    expect(a[a.length - 1]).toBe(out);
    expect(a.every((x) => !/\s/.test(x))).toBe(true);
  });
  test('two inputs side by side, four in a 2x2 grid, three with black fill', () => {
    expect(filterOf(c.compositeArgs({ inputs: [u('a'), u('b')], layout: 'grid_2', output: out }))).toMatch(/hstack=inputs=2\[v\]$/);
    expect(filterOf(c.compositeArgs({ inputs: [u('a'), u('b'), u('c'), u('d')], layout: 'grid_4', output: out }))).toMatch(/xstack=inputs=4:layout=0_0\|w0_0\|0_h0\|w0_h0:fill=black\[v\]$/);
    expect(filterOf(c.compositeArgs({ inputs: [u('a'), u('b'), u('c')], layout: 'grid_4', output: out }))).toMatch(/xstack=inputs=3:layout=0_0\|w0_0\|0_h0:fill=black/);
  });
  test('layout capacity trims inputs; spotlight goes first', () => {
    expect(inputsOf(c.compositeArgs({ inputs: [u('a'), u('b'), u('c')], layout: 'solo', output: out }))).toEqual([u('a')]);
    expect(inputsOf(c.compositeArgs({ inputs: [u('a'), u('b'), u('c')], layout: 'grid_2', output: out }))).toEqual([u('a'), u('b')]);
    expect(inputsOf(c.compositeArgs({ inputs: [u('a'), u('b'), u('c')], layout: 'spotlight', spotlight: u('c'), output: out }))).toEqual([u('c'), u('a'), u('b')]);
    expect(inputsOf(c.compositeArgs({ inputs: [u('a'), u('b')], layout: 'spotlight', spotlight: u('zz'), output: out }))).toEqual([u('a'), u('b')]);
  });
});
