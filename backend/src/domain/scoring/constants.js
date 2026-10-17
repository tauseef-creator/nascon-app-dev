'use strict';
// Shared constants for sport configs, leagues and match events (spec 5.6, 5.8, 5.9).

const SCORING_MODELS = ['event', 'innings', 'round'];
const OVERTIME_POLICIES = ['none', 'extra_time', 'shootout', 'golden_score', 'super_over'];
const TIE_BREAK_TOKENS = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];
const EVENT_TYPES = ['match_init', 'match_start', 'score', 'discipline', 'tiebreak_winner', 'match_end', 'compensation'];
// Only these event types can be targeted by a compensation.
const COMPENSABLE_TYPES = ['score', 'discipline', 'tiebreak_winner'];

const SPORT_ID_RE = /^[a-z0-9_-]{2,40}$/;
const EVENT_KEY_RE = /^[a-z0-9_]{1,40}$/;

module.exports = {
  SCORING_MODELS, OVERTIME_POLICIES, TIE_BREAK_TOKENS, EVENT_TYPES, COMPENSABLE_TYPES,
  SPORT_ID_RE, EVENT_KEY_RE,
};
