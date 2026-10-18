'use strict';
const MS = require('../backend/src/domain/matchStatus');

describe('match status state machine (FR-1.3)', () => {
  test('override wins over the event-log status', () => {
    expect(MS.effectiveStatus('upcoming', null)).toBe('upcoming');
    expect(MS.effectiveStatus('upcoming', { status: null })).toBe('upcoming');
    expect(MS.effectiveStatus('upcoming', { status: 'postponed' })).toBe('postponed');
  });

  test.each([
    ['upcoming', 'postponed'], ['upcoming', 'cancelled'],
    ['postponed', 'cancelled'], ['in_progress', 'abandoned'],
  ])('%s -> %s is allowed', (from, to) => {
    expect(MS.checkTransition(from, to)).toBeNull();
  });

  test.each([
    ['upcoming', 'abandoned'], ['in_progress', 'cancelled'], ['in_progress', 'postponed'],
    ['completed', 'cancelled'], ['cancelled', 'upcoming'], ['abandoned', 'upcoming'],
  ])('%s -> %s is rejected with ILLEGAL_TRANSITION', (from, to) => {
    const err = MS.checkTransition(from, to);
    expect(err).toMatchObject({ status: 409, code: 'ILLEGAL_TRANSITION', details: { from, to } });
  });

  test('reschedule needs a new date', () => {
    expect(MS.checkTransition('postponed', 'upcoming')).toMatchObject({ status: 400, details: { fields: ['scheduled_at'] } });
    expect(MS.checkTransition('postponed', 'upcoming', { scheduledAt: '2026-11-01T16:00:00Z' })).toBeNull();
  });

  test('unknown target is a validation error', () => {
    expect(MS.checkTransition('upcoming', 'completed')).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  test('frozen statuses block new events', () => {
    expect(MS.isFrozen({ status: 'cancelled' })).toBe(true);
    expect(MS.isFrozen({ status: null })).toBe(false);
    expect(MS.isFrozen(null)).toBe(false);
    expect(MS.allowedTargets('completed')).toEqual([]);
  });
});
