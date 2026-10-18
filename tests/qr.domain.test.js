'use strict';
const Q = require('../backend/src/domain/day2/qr');

describe('entityTypeFromId', () => {
  test.each([
    ['match-m1', 'match'],
    ['player-alpha-1', 'player'],
    ['club-alpha-1', 'club'],
    ['cs-session-101', 'costream'],
    ['match-', null],
    ['m1', null],
    [42, null],
  ])('%p -> %p', (id, type) => expect(Q.entityTypeFromId(id)).toBe(type));
});

describe('targetRoute (spec 5.6 dynamic target mutation, edge case 2)', () => {
  test.each([
    ['upcoming', '/web/matches/match-m1/preview'],
    ['in_progress', '/web/matches/match-m1/live'],
    ['completed', '/web/matches/match-m1/vod'],
    ['postponed', '/web/matches/match-m1/notice?state=postponed'],
    ['cancelled', '/web/matches/match-m1/notice?state=cancelled'],
    ['abandoned', '/web/matches/match-m1/notice?state=abandoned'],
    ['weird', '/web/matches/match-m1/preview'],
  ])('match %s', (status, route) => expect(Q.targetRoute('match', 'match-m1', status)).toBe(route));

  test('non-match entities', () => {
    expect(Q.targetRoute('player', 'player-alpha-1', 'active')).toBe('/web/players/player-alpha-1');
    expect(Q.targetRoute('club', 'club-alpha-1', 'active')).toBe('/web/clubs/club-alpha-1');
    expect(Q.targetRoute('costream', 'cs-session-101', 'active')).toBe('/web/costream/cs-session-101');
    expect(Q.targetRoute('other', 'x', 'active')).toBeNull();
  });
});

describe('short codes', () => {
  test('deterministic per prefix', () => {
    expect(Q.shortCodeFor('match-abc', 'match')).toBe('m-abc');
    expect(Q.shortCodeFor('player-beta-2', 'player')).toBe('p-beta-2');
    expect(Q.shortCodeFor('club-beta-1', 'club')).toBe('c-beta-1');
    expect(Q.shortCodeFor('cs-session-101', 'costream')).toBe('cs-101');
    expect(Q.shortCodeFor('demo-m-7', 'match')).toBe('m-demo-m-7');
    expect(Q.shortCodeFor('x', 'unknown')).toBe('e-x');
    expect(Q.shortCodeFor('match-abc', 'match')).toBe(Q.shortCodeFor('match-abc', 'match'));
  });

  test('fallback code is stable, short and type tagged', () => {
    const a = Q.fallbackShortCode('match-abc', 'match');
    expect(a).toMatch(/^m-[a-f0-9]{10}$/);
    expect(Q.fallbackShortCode('match-abc', 'match')).toBe(a);
    expect(Q.fallbackShortCode('match-abd', 'match')).not.toBe(a);
    expect(Q.fallbackShortCode('zzz', 'nope')).toMatch(/^e-/);
  });
});

describe('privacy-safe telemetry (NFR-9)', () => {
  test.each([
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36', 'mobile'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'mobile'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'mobile'],
    ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0', 'desktop'],
    ['python-requests/2.32', 'desktop'],
    ['', 'desktop'],
    [undefined, 'desktop'],
  ])('%p -> %s', (ua, fam) => expect(Q.deviceFamily(ua)).toBe(fam));

  test('hour bucket is UTC and truncated', () => {
    expect(Q.hourBucket(new Date('2026-10-18T11:47:59.123Z'))).toBe('2026-10-18T11:00Z');
    expect(Q.hourBucket('2026-10-18T23:00:00+05:00')).toBe('2026-10-18T18:00Z');
    expect(Q.hourBucket()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00Z$/);
  });

  test('scan record keeps no UA string or IP', () => {
    const r = Q.scanRecord('match-m1', 'Mozilla/5.0 (iPhone)', new Date('2026-10-18T09:15:00Z'));
    expect(r).toEqual({ entity_id: 'match-m1', device_family: 'mobile', bucket: '2026-10-18T09:00Z' });
    expect(Object.keys(Q.scanRecord('x', 'ua'))).toEqual(['entity_id', 'device_family', 'bucket']);
  });
});

describe('urls and view', () => {
  test('base url from env with fallback', () => {
    expect(Q.baseUrl({})).toBe('http://localhost:8080');
    expect(Q.baseUrl({ PUBLIC_BASE_URL: 'https://nascon.example/' })).toBe('https://nascon.example');
    expect(Q.baseUrl({ PUBLIC_BASE_URL: 'not a url' })).toBe('http://localhost:8080');
    expect(typeof Q.baseUrl()).toBe('string');
  });

  test('export formats', () => {
    expect(Q.isExportFormat('svg')).toBe(true);
    expect(Q.isExportFormat('pdf')).toBe(true);
    expect(Q.isExportFormat('jpg')).toBe(false);
    expect(Q.EXPORT_CONTENT_TYPES).toEqual({ svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf' });
  });

  test('buildQrView matches the spec 5.6 example and sig payload', () => {
    const { body, sigPayload } = Q.buildQrView({
      entityId: 'match-m1', entityType: 'match', entityStatus: 'in_progress', shortCode: 'm1-live', scanCount: '1',
    });
    expect(body).toEqual({
      entity_id: 'match-m1',
      entity_type: 'match',
      entity_status: 'in_progress',
      short_url: 'http://localhost:8080/q/m1-live',
      target_route: '/web/matches/match-m1/live',
      deep_link_uri: 'nascon://entity/match-m1',
      scan_count: 1,
      export_formats: {
        svg: 'http://localhost:8080/audit/v1/qr/match-m1/export.svg',
        png: 'http://localhost:8080/audit/v1/qr/match-m1/export.png',
        pdf: 'http://localhost:8080/audit/v1/qr/match-m1/export.pdf',
      },
    });
    expect(sigPayload).toEqual({
      entity_id: 'match-m1', short_url: 'http://localhost:8080/q/m1-live', target_route: '/web/matches/match-m1/live',
    });
  });

  test('short_url stays constant while target_route mutates', () => {
    const live = Q.buildQrView({ entityId: 'match-m1', entityType: 'match', entityStatus: 'in_progress', shortCode: 'm1-live', scanCount: 0 });
    const done = Q.buildQrView({ entityId: 'match-m1', entityType: 'match', entityStatus: 'completed', shortCode: 'm1-live', scanCount: 0 });
    expect(done.body.short_url).toBe(live.body.short_url);
    expect(done.body.target_route).toBe('/web/matches/match-m1/vod');
  });
});
