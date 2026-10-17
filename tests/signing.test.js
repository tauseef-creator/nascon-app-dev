'use strict';
const { canonical, sign, lotsKey } = require('../backend/src/lib/signing');

describe('signing (spec 5.3, Appendix A)', () => {
  test('test vector 1: event signature', () => {
    const payload = { team_id: 't1', event_type: 'goal' };
    expect(canonical(payload)).toBe('{"event_type":"goal","team_id":"t1"}');
    expect(sign('evt-1', payload, 'demo-salt')).toBe('972a8b558690b19121cc5bea84978f85e8eb15a3735018db36616bab1d7ec501');
  });

  test('test vector 2: drawing of lots keys', () => {
    expect(lotsKey(42, 'lg-1', 't1')).toBe('0613316991ce0ac31e88d6003e3ff4d5e21bb072ac5f81b42c0cdc6598453293');
    expect(lotsKey(42, 'lg-1', 't2')).toBe('e3e3a14e22727f936e1f288cf5d02a8a9362b1da13c5432725fc10b2c7955dd9');
    expect(lotsKey(42, 'lg-1', 't3')).toBe('c8f28e3c2f1eb6c4f636b4f57050e3362a2b39c07fda9b61742a26dd20397028');
  });

  test('canonical JSON sorts nested keys, keeps arrays, does not escape non-ASCII', () => {
    expect(canonical({ b: [3, { z: 1, a: null }], a: true, c: 'ü' })).toBe('{"a":true,"b":[3,{"a":null,"z":1}],"c":"ü"}');
  });
});
