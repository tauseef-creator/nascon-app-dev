'use strict';
// Chat moderation engine (spec Part II FR-5.3, 5.8). Pure and deterministic: no DB, no clock.
//
// Per message, in this order of precedence:
//   1. Flood (>= 4 identical non-space characters in a row, case-insensitive, or >= 3 consecutive
//      '!'/'?'): the message is dropped from filtered_messages and its sender is muted.
//      Flood wins over profanity: a flooded message is never broadcast, so there is nothing to mask.
//   2. Rate limit (more than 3 messages from one sender inside a 2 s sliding window): dropped,
//      sender muted, reason rate_limit_exceeded.
//   3. Profanity / leetspeak: each offending token is replaced in place with ***, the message is kept
//      with flagged true and reason profanity_leetspeak, and the sender is kicked.
//   4. Otherwise the message passes unchanged with flagged false and reason null.

const REASON_PROFANITY = 'profanity_leetspeak';
const REASON_FLOOD = 'flood_character_repeat';
const REASON_RATE = 'rate_limit_exceeded';
const MASK = '***';

const RATE_LIMIT = 3; // messages allowed per sender ...
const RATE_WINDOW_MS = 2000; // ... inside this sliding window

// Dictionary in normalized form (lowercase letters only, separators removed).
const DICTIONARY = Object.freeze(['badword', 'porn', 'scam', 'fuck', 'shit', 'bitch', 'asshole', 'idiotspam']);
// A dictionary word also matches with a common inflection, e.g. "scams", "fucking", "bitches".
const WORD_RE = new RegExp(`^(?:${DICTIONARY.join('|')})(?:s|es|ed|er|ers|ing)?$`);

const LEET = Object.freeze({ '@': 'a', 0: 'o', 1: 'i', '!': 'i', 3: 'e', $: 's' });
const LEET_RE = /[@01!3$]/g;
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const NON_LETTER_RE = /[^\p{L}]/gu;

// Token separators: every Unicode space except U+FEFF, which is treated as a zero-width joiner.
const SPLIT_RE = /([\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+)/;
// Leading / trailing characters that are neither letters nor digits (candidate edge punctuation).
const EDGE_RE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;

const REPEAT_RE = /(\S)\1{3,}/iu; // backreference is case-insensitive under the i flag: AaAa matches
const PUNCT_FLOOD_RE = /[!?]{3,}/;

/** Normalize one token for dictionary matching: NFKC, lowercase, leetspeak map, strip separators. */
function normalizeToken(token) {
  return String(token)
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .toLowerCase()
    .replace(LEET_RE, (c) => LEET[c])
    .replace(NON_LETTER_RE, '');
}

// '!' is ambiguous: it stands for 'i' in "sh!t" but is a separator in "s!c@m". Every reading is
// tried (exhaustively up to MAX_BANG_COMBOS marks, otherwise the two uniform readings).
const MAX_BANG_COMBOS = 6;
const MAX_EDGE = 4;

function normalizeVariants(token) {
  const base = String(token).normalize('NFKC').replace(ZERO_WIDTH_RE, '').toLowerCase();
  const parts = base.split('!');
  const bangs = parts.length - 1;
  if (bangs === 0) return [normalizeToken(base)];
  const out = new Set();
  const finish = (s) => out.add(s.replace(LEET_RE, (c) => LEET[c]).replace(NON_LETTER_RE, ''));
  if (bangs > MAX_BANG_COMBOS) {
    finish(parts.join('i'));
    finish(parts.join(''));
    return [...out];
  }
  for (let mask = 0; mask < 1 << bangs; mask += 1) {
    let s = parts[0];
    for (let i = 1; i < parts.length; i += 1) s += (mask & (1 << (i - 1)) ? 'i' : '') + parts[i];
    finish(s);
  }
  return [...out];
}

function isProfaneCore(core) {
  return normalizeVariants(core).some((n) => n.length > 0 && WORD_RE.test(n));
}

/**
 * Mask one whitespace-free token. Edge punctuation is kept outside the mask unless it is needed for
 * the match (so "now!" stays "now!", "scam!" becomes "***!", but "$h!t" and "@sshole" are matched
 * with their leading leet character). Returns the masked token or null when the token is clean.
 */
function maskToken(token) {
  const clean = token.replace(ZERO_WIDTH_RE, '');
  if (!clean) return null;
  const [, lead, mid, trail] = EDGE_RE.exec(clean);
  // Try the most stripped core first, then pull edge characters back in one at a time (at most
  // MAX_EDGE from each side, which bounds the work for pathological tokens).
  const maxA = Math.min(lead.length, MAX_EDGE);
  const maxB = Math.min(trail.length, MAX_EDGE);
  for (let total = 0; total <= maxA + maxB; total += 1) {
    for (let a = Math.min(total, maxA); a >= 0; a -= 1) {
      const b = total - a;
      if (b > maxB) continue;
      const core = lead.slice(lead.length - a) + mid + trail.slice(0, b);
      if (isProfaneCore(core)) return lead.slice(0, lead.length - a) + MASK + trail.slice(b);
    }
  }
  return null;
}

/** Mask every profane token in text, preserving whitespace. Returns { text, flagged }. */
function maskText(text) {
  const parts = String(text).split(SPLIT_RE);
  let flagged = false;
  for (let i = 0; i < parts.length; i += 2) {
    if (!parts[i]) continue;
    const masked = maskToken(parts[i]);
    if (masked !== null) {
      parts[i] = masked;
      flagged = true;
    }
  }
  return { text: parts.join(''), flagged };
}

/** True when text contains a character flood (spec 5.8 rule 3). */
function isFlood(text) {
  const t = String(text).replace(ZERO_WIDTH_RE, '');
  return REPEAT_RE.test(t) || PUNCT_FLOOD_RE.test(t);
}

/**
 * Sliding-window rate check. `history` is the sender's prior message times (ms, ascending).
 * Returns { limited, history } where history is the pruned list including `now` when accepted.
 * A blocked attempt is not recorded, so a sender regains the right to post as the window slides.
 */
function rateCheck(history, now, { limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS } = {}) {
  const recent = (history || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return { limited: true, history: recent };
  recent.push(now);
  return { limited: false, history: recent };
}

/** Classify a single message without rate limiting. */
function classify(text) {
  if (isFlood(text)) return { action: 'drop', reason: REASON_FLOOD, text: String(text), flagged: true };
  const m = maskText(text);
  if (m.flagged) return { action: 'mask', reason: REASON_PROFANITY, text: m.text, flagged: true };
  return { action: 'pass', reason: null, text: String(text), flagged: false };
}

/**
 * Notification retry schedule (FR-5.2): bounded exponential backoff. Returns the wait before
 * attempt `attempt + 1` (1-based attempt that just failed): base, 2*base, 4*base, ...
 */
function backoffDelayMs(attempt, baseMs = 10) {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

function pushUnique(list, seen, value) {
  if (!seen.has(value)) {
    seen.add(value);
    list.push(value);
  }
}

/**
 * Evaluate a batch of messages in arrival order.
 * options.rateLimit: when true, more than RATE_LIMIT messages from one sender in the batch are
 * treated as arriving inside one window (a single request has a single arrival instant).
 * Returns { filtered_messages, kicked_users, muted_users, flagged_count, dropped, decisions }.
 */
function evaluate(messages, { rateLimit = true, limit = RATE_LIMIT } = {}) {
  const filtered = [];
  const dropped = [];
  const decisions = [];
  const kicked = [];
  const muted = [];
  const kickedSeen = new Set();
  const mutedSeen = new Set();
  const perSender = new Map();

  for (const msg of messages) {
    const { message_id, sender } = msg;
    const count = (perSender.get(sender) || 0) + 1;
    perSender.set(sender, count);

    let d = classify(msg.text);
    if (d.action !== 'drop' && rateLimit && count > limit) {
      d = { action: 'drop', reason: REASON_RATE, text: String(msg.text), flagged: true };
    }
    decisions.push({ message_id, sender, ...d });

    if (d.action === 'drop') {
      dropped.push({ message_id, sender, reason: d.reason });
      pushUnique(muted, mutedSeen, sender);
      continue;
    }
    if (d.action === 'mask') pushUnique(kicked, kickedSeen, sender);
    filtered.push({ message_id, sender, text: d.text, flagged: d.flagged, reason: d.reason });
  }

  return {
    filtered_messages: filtered,
    kicked_users: kicked,
    muted_users: muted,
    flagged_count: filtered.filter((m) => m.flagged).length,
    dropped,
    decisions,
  };
}

module.exports = {
  DICTIONARY,
  MASK,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  REASON_FLOOD,
  REASON_PROFANITY,
  REASON_RATE,
  backoffDelayMs,
  classify,
  evaluate,
  isFlood,
  maskText,
  maskToken,
  normalizeToken,
  normalizeVariants,
  rateCheck,
};
