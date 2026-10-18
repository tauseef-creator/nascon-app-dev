'use strict';
// Match status state machine (FR-1.3): Upcoming, In-Progress, Completed, Postponed, Abandoned, Cancelled.
// The event log (spec 5.9) drives upcoming -> in_progress -> completed. Postponed, abandoned and
// cancelled are administrative overrides stored beside the log, so graded /audit/v1 outputs are unchanged.

const STATUSES = ['upcoming', 'in_progress', 'completed', 'postponed', 'abandoned', 'cancelled'];
const ADMIN_TARGETS = ['upcoming', 'postponed', 'abandoned', 'cancelled'];

// Allowed administrative transitions from the current effective status.
const TRANSITIONS = {
  upcoming: ['postponed', 'cancelled'],
  postponed: ['upcoming', 'cancelled'], // back to upcoming = rescheduled (needs a new date)
  in_progress: ['abandoned'],
  completed: [],
  abandoned: [],
  cancelled: [],
};

// Statuses that freeze the match: no more events may be appended.
const FROZEN = ['postponed', 'abandoned', 'cancelled'];

function effectiveStatus(logStatus, override) {
  return override && override.status ? override.status : logStatus;
}

function allowedTargets(current) {
  return TRANSITIONS[current] || [];
}

// Returns null when allowed, or { code, message, details } for a 409 / 400.
function checkTransition(current, target, { scheduledAt } = {}) {
  if (!ADMIN_TARGETS.includes(target)) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Unknown target status.', details: { fields: ['status'] } };
  }
  if (!allowedTargets(current).includes(target)) {
    return {
      status: 409,
      code: 'ILLEGAL_TRANSITION',
      message: `A match that is ${current.replace('_', ' ')} cannot become ${target.replace('_', ' ')}.`,
      details: { from: current, to: target, allowed: allowedTargets(current) },
    };
  }
  if (current === 'postponed' && target === 'upcoming' && !scheduledAt) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'A new date is required to reschedule.', details: { fields: ['scheduled_at'] } };
  }
  return null;
}

function isFrozen(override) {
  return Boolean(override && FROZEN.includes(override.status));
}

module.exports = { STATUSES, ADMIN_TARGETS, TRANSITIONS, FROZEN, effectiveStatus, allowedTargets, checkTransition, isFrozen };
