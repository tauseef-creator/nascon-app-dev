'use strict';
// Order state machine (FR-2.3). Statuses are stored and returned in lowercase.

const ORDER_STATUSES = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'];

const TRANSITIONS = {
  pending: ['paid', 'cancelled'],
  paid: ['packed', 'cancelled', 'refunded'],
  packed: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

const norm = (s) => (typeof s === 'string' ? s.toLowerCase() : s);

function isOrderStatus(s) {
  return ORDER_STATUSES.includes(norm(s));
}

function nextStatuses(from) {
  return [...(TRANSITIONS[norm(from)] || [])];
}

function canTransition(from, to) {
  return nextStatuses(from).includes(norm(to));
}

// Structured domain event for the internal queue (type 'order.status_changed').
function statusChangedEvent({ order_id, customer_id = null, from, to, at, reason = null }) {
  return { order_id, customer_id, from: norm(from), to: norm(to), at, reason };
}

module.exports = { ORDER_STATUSES, TRANSITIONS, isOrderStatus, nextStatuses, canTransition, statusChangedEvent };
