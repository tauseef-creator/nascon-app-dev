'use strict';
const crypto = require('crypto');
const s = require('../backend/src/domain/day2/streaming');
const { signDay2 } = require('../backend/src/lib/signing');

const SALT = 'T01D27ad7ffff12e';
const sign = (id, payload) => signDay2(id, payload, SALT);
const refSign = (id, payload) => crypto.createHmac('sha256', SALT)
  .update(id + '|' + JSON.stringify(payload, Object.keys(payload).sort())).digest('hex');

describe('validateKeyRequest', () => {
  test('accepts a full rotate body and keeps optional fields', () => {
    const v = s.validateKeyRequest({ action: 'rotate', player_id: 'player-alpha-1', label: 'OBS-Main-Desk', stream_key_override: 'sk_live_9f83a1b2c3d4e5f6' });
    expect(v).toEqual({ ok: true, value: { action: 'rotate', player_id: 'player-alpha-1', label: 'OBS-Main-Desk', stream_key_override: 'sk_live_9f83a1b2c3d4e5f6' } });
  });
  test('defaults missing optionals to null', () => {
    expect(s.validateKeyRequest({ action: 'generate', player_id: 'p', label: null }).value).toEqual({ action: 'generate', player_id: 'p', label: null, stream_key_override: null });
  });
  test.each([
    [{ action: 'nope', player_id: 'p' }, ['action']],
    [{ player_id: 'p' }, ['action']],
    [{ action: 'generate' }, ['player_id']],
    [{ action: 'generate', player_id: '' }, ['player_id']],
    [{ action: 'generate', player_id: 7 }, ['player_id']],
    [{ action: 'generate', player_id: 'p', label: '' }, ['label']],
    [{ action: 'generate', player_id: 'p', label: 'x'.repeat(65) }, ['label']],
    [{ action: 'generate', player_id: 'p', label: 5 }, ['label']],
    [{ action: 'rotate', player_id: 'p', stream_key_override: '' }, ['stream_key_override']],
    [{ action: 'rotate', player_id: 'p', stream_key_override: 'a b' }, ['stream_key_override']],
    [{ action: 'rotate', player_id: 'p', stream_key_override: 'a/b' }, ['stream_key_override']],
    [{ action: 'rotate', player_id: 'p', stream_key_override: 12 }, ['stream_key_override']],
    [null, ['action', 'player_id']],
    [[], ['action', 'player_id']],
  ])('rejects %j', (body, fields) => {
    expect(s.validateKeyRequest(body)).toEqual({ ok: false, fields });
  });
  test('label of exactly 64 characters is allowed', () => {
    expect(s.validateKeyRequest({ action: 'generate', player_id: 'p', label: 'x'.repeat(64) }).ok).toBe(true);
  });
  test('the legacy override sk_live_101 is accepted verbatim', () => {
    expect(s.validateKeyRequest({ action: 'rotate', player_id: 'p', stream_key_override: 'sk_live_101' }).value.stream_key_override).toBe('sk_live_101');
  });
});

describe('newStreamKey', () => {
  test('matches the required format', () => {
    const key = s.newStreamKey((n) => crypto.randomBytes(n).toString('hex'));
    expect(key).toMatch(/^sk_live_[a-f0-9]{16}$/);
  });
  test('rejects a bad random source', () => {
    expect(() => s.newStreamKey(() => 'XYZ')).toThrow();
  });
});

describe('keyResponse', () => {
  test('Appendix A vector 1 (full 4-key payload, pipe separator)', () => {
    const r = s.keyResponse({ action: 'rotate', player_id: 'player-alpha-1', label: 'OBS-Main-Desk', stream_key: 'sk_live_9f83a1b2c3d4e5f6', status: 'active' }, sign);
    expect(r).toEqual({
      player_id: 'player-alpha-1',
      label: 'OBS-Main-Desk',
      stream_key: 'sk_live_9f83a1b2c3d4e5f6',
      status: 'active',
      ingest_endpoints: {
        rtmp: 'rtmp://localhost:1935/live/sk_live_9f83a1b2c3d4e5f6',
        webrtc: 'http://localhost:8889/live/sk_live_9f83a1b2c3d4e5f6/whip',
      },
      playback_url: 'http://localhost:8888/live/sk_live_9f83a1b2c3d4e5f6/index.m3u8',
      signature: refSign('sk_live_9f83a1b2c3d4e5f6', { action: 'rotate', player_id: 'player-alpha-1', status: 'active', stream_key: 'sk_live_9f83a1b2c3d4e5f6' }),
    });
    expect(Object.keys(r)).toEqual(['player_id', 'label', 'stream_key', 'status', 'ingest_endpoints', 'playback_url', 'signature']);
    expect(r.signature).toMatch(/^[0-9a-f]{64}$/);
  });
  test('revoked key has null endpoints and a revoked signature', () => {
    const r = s.keyResponse({ action: 'revoke', player_id: 'p', label: 'default', stream_key: 'sk_live_0123456789abcdef', status: 'revoked' }, sign);
    expect(r.ingest_endpoints).toBeNull();
    expect(r.playback_url).toBeNull();
    expect(r.signature).toBe(sign('sk_live_0123456789abcdef', { action: 'revoke', player_id: 'p', status: 'revoked', stream_key: 'sk_live_0123456789abcdef' }));
  });
  test('sig payload has exactly the 4 keys', () => {
    expect(Object.keys(s.keySigPayload({ action: 'a', player_id: 'p', status: 's', stream_key: 'k', extra: 1 })).sort()).toEqual(['action', 'player_id', 'status', 'stream_key']);
  });
});

describe('planKeyAction', () => {
  const k = (stream_key, status, label = 'default') => ({ stream_key, status, label });
  const req = (action, extra = {}) => ({ action, player_id: 'p', label: null, stream_key_override: null, ...extra });

  test('generate without keys -> 201 new key', () => {
    expect(s.planKeyAction(req('generate'), [], { newKey: 'sk_new' })).toEqual({ kind: 'issue', httpStatus: 201, revoke: [], key: 'sk_new', label: 'default' });
  });
  test('generate replaces the previous active key', () => {
    const p = s.planKeyAction(req('generate', { label: 'L' }), [k('sk_old', 'active'), k('sk_older', 'revoked')], { newKey: 'sk_new' });
    expect(p).toEqual({ kind: 'issue', httpStatus: 201, revoke: ['sk_old'], key: 'sk_new', label: 'L' });
  });
  test('rotate -> 200, inherits the active label, honours override', () => {
    const p = s.planKeyAction(req('rotate', { stream_key_override: 'sk_live_9f83a1b2c3d4e5f6' }), [k('sk_old', 'active', 'OBS')], { newKey: 'sk_new' });
    expect(p).toEqual({ kind: 'issue', httpStatus: 200, revoke: ['sk_old'], key: 'sk_live_9f83a1b2c3d4e5f6', label: 'OBS' });
  });
  test('rotate to the same override does not revoke itself', () => {
    const p = s.planKeyAction(req('rotate', { stream_key_override: 'sk_same' }), [k('sk_same', 'active')], { newKey: 'sk_new' });
    expect(p.revoke).toEqual([]);
    expect(p.key).toBe('sk_same');
  });
  test('rotate with no prior key still issues one', () => {
    expect(s.planKeyAction(req('rotate'), [], { newKey: 'sk_new' })).toMatchObject({ kind: 'issue', httpStatus: 200, key: 'sk_new', label: 'default' });
  });
  test('revoke with no key -> STREAM_NOT_FOUND', () => {
    expect(s.planKeyAction(req('revoke'), [], { newKey: 'x' })).toEqual({ kind: 'error', code: 'STREAM_NOT_FOUND' });
    expect(s.planKeyAction(req('revoke'), undefined, { newKey: 'x' })).toEqual({ kind: 'error', code: 'STREAM_NOT_FOUND' });
  });
  test('revoke the current active key', () => {
    expect(s.planKeyAction(req('revoke'), [k('sk_a', 'active', 'OBS'), k('sk_b', 'revoked')], { newKey: 'x' }))
      .toEqual({ kind: 'revoke', httpStatus: 200, revoke: ['sk_a'], key: 'sk_a', label: 'OBS' });
  });
  test('revoke again is idempotent on the latest key', () => {
    expect(s.planKeyAction(req('revoke'), [k('sk_b', 'revoked')], { newKey: 'x' }))
      .toEqual({ kind: 'revoke', httpStatus: 200, revoke: [], key: 'sk_b', label: 'default' });
  });
  test('revoke a named key through the override', () => {
    const p = s.planKeyAction(req('revoke', { stream_key_override: 'sk_b' }), [k('sk_a', 'active'), k('sk_b', 'active')], { newKey: 'x' });
    expect(p.key).toBe('sk_b');
    expect(p.revoke).toEqual(['sk_b']);
  });
  test('revoke with an unknown override falls back to the active key', () => {
    expect(s.planKeyAction(req('revoke', { stream_key_override: 'zz' }), [k('sk_a', 'active')], { newKey: 'x' }).key).toBe('sk_a');
  });
  test('revoke label falls back to default when the row has none', () => {
    expect(s.planKeyAction(req('revoke'), [{ stream_key: 'sk', status: 'active' }], { newKey: 'x' }).label).toBe('default');
  });
});

describe('media paths and auth decisions', () => {
  test('parseMediaPath', () => {
    expect(s.parseMediaPath('live/sk_live_abc')).toEqual({ kind: 'live', key: 'sk_live_abc' });
    expect(s.parseMediaPath('/live/sk_1/')).toEqual({ kind: 'live', key: 'sk_1' });
    expect(s.parseMediaPath('costream/cs-1')).toEqual({ kind: 'costream', id: 'cs-1' });
    expect(s.parseMediaPath('other/x')).toBeNull();
    expect(s.parseMediaPath('live/a/b')).toBeNull();
    expect(s.parseMediaPath(undefined)).toBeNull();
  });
  const d = s.mediaAuthDecision;
  test('publish on live needs an active key', () => {
    expect(d({ action: 'publish', path: 'live/k' }, 'active', null)).toEqual({ allow: true });
    expect(d({ action: 'publish', path: 'live/k' }, 'revoked', null)).toEqual({ allow: false, httpStatus: 409, code: 'KEY_REVOKED' });
    expect(d({ action: 'publish', path: 'live/k' }, null, null)).toEqual({ allow: false, httpStatus: 404, code: 'STREAM_NOT_FOUND' });
  });
  test('live read is open except for revoked keys; VOD playback always allowed', () => {
    expect(d({ action: 'read', path: 'live/k' }, null, null)).toEqual({ allow: true });
    expect(d({ action: 'read', path: 'live/k' }, 'active', null)).toEqual({ allow: true });
    expect(d({ action: 'read', path: 'live/k' }, 'revoked', null).code).toBe('KEY_REVOKED');
    expect(d({ action: 'playback', path: 'live/k' }, 'revoked', null)).toEqual({ allow: true });
  });
  test('costream composite publish follows the session state', () => {
    expect(d({ action: 'publish', path: 'costream/c' }, null, { status: 'active' })).toEqual({ allow: true });
    expect(d({ action: 'publish', path: 'costream/c' }, null, { status: 'terminated' }).code).toBe('COSTREAM_TERMINATED');
    expect(d({ action: 'publish', path: 'costream/c' }, null, null).code).toBe('STREAM_NOT_FOUND');
    expect(d({ action: 'read', path: 'costream/c' }, null, null)).toEqual({ allow: true });
  });
  test('control-plane actions and unknown paths are denied', () => {
    for (const action of ['api', 'metrics', 'pprof']) expect(d({ action, path: '' }, null, null).httpStatus).toBe(403);
    expect(d({ action: 'publish', path: 'x/y/z' }, null, null).httpStatus).toBe(404);
    expect(d(null, null, null).httpStatus).toBe(404);
  });
  test('publishCheck', () => {
    expect(s.publishCheck('active')).toEqual({ allow: true });
    expect(s.publishCheck('revoked')).toEqual({ allow: false, httpStatus: 409, code: 'KEY_REVOKED' });
    expect(s.publishCheck(null)).toEqual({ allow: false, httpStatus: 404, code: 'STREAM_NOT_FOUND' });
  });
});

describe('athlete profile helpers', () => {
  const proj = (match_id, status, home, hs, away, as, winner = null) => ({
    match_id, status, home: { team_id: home, score: hs }, away: { team_id: away, score: as }, winner_team_id: winner,
  });
  test('careerRecord counts completed matches from both sides', () => {
    const rec = s.careerRecord([
      proj('m1', 'completed', 'c1', 2, 'x', 1, 'c1'),
      proj('m2', 'completed', 'y', 3, 'c1', 0, 'y'),
      proj('m3', 'completed', 'c1', 1, 'z', 1, null),
      proj('m4', 'in_progress', 'c1', 1, 'z', 0),
      proj('m5', 'completed', 'a', 1, 'b', 0, 'a'),
      proj('m6', 'upcoming', 'c1', 0, 'b', 0),
      { match_id: 'broken' },
      null,
    ], ['c1']);
    expect(rec).toEqual({ matches_played: 3, wins: 1, draws: 1, losses: 1, scored: 3, conceded: 5, live: 1 });
  });
  test('careerRecord with nothing', () => {
    expect(s.careerRecord(undefined, undefined).matches_played).toBe(0);
    expect(s.careerRecord([proj('m', 'completed', 'c', 'x', 'd', null, 'c')], ['c'])).toMatchObject({ wins: 1, scored: 0, conceded: 0 });
  });
  test('upcomingFixtures filters and orders', () => {
    const now = Date.parse('2026-10-18T00:00:00Z');
    const out = s.upcomingFixtures([
      { match_id: 'late', status: 'upcoming', scheduled_at: '2026-11-01T10:00:00Z' },
      { match_id: 'soon', status: 'upcoming', scheduled_at: '2026-10-19T10:00:00Z' },
      { match_id: 'tbd', status: 'upcoming', scheduled_at: null },
      { match_id: 'tbd0', status: 'upcoming', scheduled_at: null },
      { match_id: 'past', status: 'upcoming', scheduled_at: '2026-10-01T10:00:00Z' },
      { match_id: 'live', status: 'in_progress', scheduled_at: '2026-10-19T10:00:00Z' },
      { match_id: 'cx', status: 'upcoming', override_status: 'cancelled', scheduled_at: '2026-10-20T10:00:00Z' },
      null,
    ], now);
    expect(out.map((m) => m.match_id)).toEqual(['soon', 'late', 'tbd', 'tbd0']);
    expect(s.upcomingFixtures(undefined, now)).toEqual([]);
    expect(s.upcomingFixtures([{ match_id: 'a', status: 'upcoming' }, { match_id: 'b', status: 'upcoming' }], now, 1)).toHaveLength(1);
  });
});
