'use strict';
const sync = require('../backend/src/domain/sync');

const action = (over = {}) => ({
  action_id: 'a1', type: 'score_event', queued_at: '2026-10-17T11:00:00Z', base_version: 0, payload: {}, ...over,
});

describe('offline sync helpers (spec 5.14)', () => {
  test('valid envelope has no bad fields', () => {
    expect(sync.validateEnvelope({ device_id: 'dev-1', actions: [action()] })).toEqual([]);
  });

  test('rejects malformed envelopes', () => {
    expect(sync.validateEnvelope(null)).toEqual(['body']);
    expect(sync.validateEnvelope({ device_id: 'dev-1', actions: [] })).toContain('actions');
    expect(sync.validateEnvelope({ device_id: 'bad|id', actions: new Array(101).fill(action()) }))
      .toEqual(['device_id', 'actions']);
    const bad = sync.validateEnvelope({ device_id: 'd', actions: [5, action({ action_id: '', type: 'x', queued_at: 'yesterday', base_version: -1, payload: [] })] });
    expect(bad).toEqual(['actions[0]', 'actions[1].action_id', 'actions[1].type', 'actions[1].queued_at', 'actions[1].base_version', 'actions[1].payload']);
  });

  test('processing order is queued_at ascending with stable ties', () => {
    const actions = [
      action({ queued_at: '2026-10-17T11:05:00Z' }),
      action({ queued_at: '2026-10-17T11:00:00Z' }),
      action({ queued_at: '2026-10-17T11:05:00Z' }),
      action({ queued_at: '2026-10-17T10:59:59Z' }),
    ];
    expect(sync.processingOrder(actions)).toEqual([3, 1, 0, 2]);
  });

  test('resolution depends on base version', () => {
    expect(sync.appliedResolution(3, 3)).toBe('appended');
    expect(sync.appliedResolution(1, 3)).toBe('rebased_append');
  });

  test('result shape and summary', () => {
    const r1 = sync.result(action(), 'applied', 'appended', null, 1, 4, 'abc');
    const r2 = sync.result(action({ action_id: 'a2' }), 'rejected', 'server_wins', 'SQUAD_FULL', 2, 1);
    expect(r1).toEqual({ action_id: 'a1', status: 'applied', resolution: 'appended', error_code: null, processed_order: 1, server_version: 4, signature: 'abc' });
    expect(r2.signature).toBeNull();
    expect(sync.summarize([r1, r2])).toEqual({ applied: 1, rejected: 1, duplicate: 0 });
  });
});
