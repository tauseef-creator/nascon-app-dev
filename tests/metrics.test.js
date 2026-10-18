'use strict';
const m = require('../backend/src/domain/day2/metrics');

describe('renderMetrics', () => {
  test('emits HELP, TYPE and sample lines for the 5 required metrics', () => {
    const text = m.renderMetrics([
      { name: 'nascon_active_ws_connections', type: 'gauge', help: 'ws', value: 25 },
      { name: 'nascon_active_streams_total', type: 'gauge', help: 'streams', value: 1 },
      { name: 'nascon_stream_bitrate_kbps', type: 'gauge', help: 'kbps', value: 988.4219 },
      { name: 'nascon_dlq_depth', type: 'gauge', help: 'dlq', value: 3 },
      { name: 'nascon_qr_scans_total', type: 'counter', help: 'scans', value: '7' },
    ]);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('# HELP nascon_active_ws_connections ws\n# TYPE nascon_active_ws_connections gauge\nnascon_active_ws_connections 25\n');
    expect(text).toContain('nascon_stream_bitrate_kbps 988.422\n');
    expect(text).toContain('# TYPE nascon_qr_scans_total counter\nnascon_qr_scans_total 7\n');
    for (const line of text.trim().split('\n')) {
      expect(line).toMatch(/^(# (HELP|TYPE) [a-z_]+ .+|[a-z_]+(\{.*\})? -?[0-9.]+)$/);
    }
  });
  test('labelled samples are sorted, escaped and filtered', () => {
    const text = m.renderMetrics([{ name: 'x_total', type: 'other', samples: [
      { labels: { path: 'live/"a"\n', bad$: 'no', a: '\\' }, value: 1 },
      { labels: {}, value: 2 },
      { value: 3 },
    ] }]);
    expect(text).toBe('# HELP x_total x_total\n# TYPE x_total gauge\nx_total{a="\\\\",path="live/\\"a\\"\\n"} 1\nx_total 2\nx_total 3\n');
  });
  test('help text is escaped', () => {
    expect(m.renderMetrics([{ name: 'h', help: 'a\\b\nc', value: 0 }])).toContain('# HELP h a\\\\b\\nc\n');
  });
  test('invalid names throw', () => {
    expect(() => m.renderMetrics([{ name: '1bad', value: 1 }])).toThrow();
  });
  test('formatValue never prints NaN or Infinity', () => {
    expect(m.formatValue(NaN)).toBe('0');
    expect(m.formatValue(Infinity)).toBe('0');
    expect(m.formatValue(undefined)).toBe('0');
    expect(m.formatValue('12')).toBe('12');
    expect(m.formatValue(1.23456)).toBe('1.235');
    expect(m.formatLabels(null)).toBe('');
    expect(m.formatLabels({ 'b-ad': 1 })).toBe('');
  });
  test('content type is the 0.0.4 exposition format', () => {
    expect(m.CONTENT_TYPE.startsWith('text/plain; version=0.0.4')).toBe(true);
  });
});

describe('streamBitrate', () => {
  const now = Date.parse('2026-10-18T10:00:10Z');
  test('average since readyTime on first scrape', () => {
    const r = m.streamBitrate([{ name: 'live/k', ready: true, readyTime: '2026-10-18T10:00:00Z', bytesReceived: 1250000 }], new Map(), now);
    expect(r.kbps).toBe(1000);
    expect(r.live).toBe(1);
    expect(r.next.get('live/k')).toEqual({ bytes: 1250000, at: now });
  });
  test('delta against the previous scrape', () => {
    const prev = new Map([['live/k', { bytes: 1000000, at: now - 2000 }]]);
    const r = m.streamBitrate([{ name: 'live/k', ready: true, readyTime: '2026-10-18T10:00:00Z', bytesReceived: 1250000 }], prev, now);
    expect(r.kbps).toBe(1000);
  });
  test('counter reset falls back to the average; non-ready and broken paths are skipped', () => {
    const prev = new Map([['live/k', { bytes: 9e9, at: now - 1000 }]]);
    const r = m.streamBitrate([
      { name: 'live/k', ready: true, readyTime: 'garbage', bytesReceived: 10 },
      { name: 'live/off', ready: false, bytesReceived: 999 },
      null,
      { ready: true },
    ], prev, now);
    expect(r).toMatchObject({ kbps: 0, live: 1 });
  });
  test('no paths', () => {
    expect(m.streamBitrate(null, null, now)).toMatchObject({ kbps: 0, live: 0 });
    expect(m.streamBitrate([{ name: 'live/k', ready: true, bytesReceived: 'x' }], undefined, now).kbps).toBe(0);
  });
});

describe('countLivePaths', () => {
  test('counts ready paths under a prefix', () => {
    const paths = [
      { name: 'live/a', ready: true }, { name: 'live/b', ready: false }, { name: 'costream/c', ready: true }, null, { ready: true },
    ];
    expect(m.countLivePaths(paths)).toBe(1);
    expect(m.countLivePaths(paths, 'costream/')).toBe(1);
    expect(m.countLivePaths(undefined)).toBe(0);
  });
});
