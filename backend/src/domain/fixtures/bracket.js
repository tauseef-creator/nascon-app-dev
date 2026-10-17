'use strict';
// Shared elimination-bracket engine (single and double elimination). Pure functions.

const { validation } = require('../../lib/errors');
const { isObj } = require('../../lib/validate');

// Marker for a slot that will never hold a team (fed by a bye's missing loser).
const DEAD = Symbol('dead');

function bracketSize(n) {
  let b = 1;
  while (b < n) b *= 2;
  return b;
}

// order(2) = [1, 2]; order(2k) = for each s in order(k): [s, 2k + 1 - s]
function seedOrder(size) {
  let order = [1];
  let k = 1;
  while (k < size) {
    k *= 2;
    const next = [];
    for (const s of order) next.push(s, k + 1 - s);
    order = next;
  }
  return order;
}

function newMatch(id, bracket, round, index) {
  return {
    match_id: id,
    bracket,
    round,
    index,
    home: null,
    away: null,
    home_seed: null,
    away_seed: null,
    bye: false,
    winner: null,
    loser: null,
    winner_to: null,
    loser_to: null,
  };
}

// Internal slot state lives in a side map so the public objects keep the exact field set.
class Bracket {
  constructor(teams) {
    this.teams = teams;
    this.seedOf = new Map(teams.map((t, i) => [t, i + 1]));
    this.matches = new Map();
    this.state = new Map(); // id -> { home, away, winner, loser } (team | DEAD | null)
    this.order = [];
    this.mirror = new Map(); // id -> id whose slots copy this match's slots
    this.noPropagate = new Set(); // matches whose winner_to/loser_to are not auto-filled
  }

  add(m) {
    this.matches.set(m.match_id, m);
    this.state.set(m.match_id, { home: null, away: null, winner: null, loser: null });
    this.order.push(m.match_id);
    return m;
  }

  setSlot(id, slot, value) {
    const st = this.state.get(id);
    st[slot] = value;
    const m = this.matches.get(id);
    m[slot] = value === DEAD ? null : value;
    m[`${slot}_seed`] = value === DEAD || value === null ? null : this.seedOf.get(value);
    if (this.mirror.has(id)) this.setSlot(this.mirror.get(id), slot, value);
  }

  // Seed WR1/R1 from the seed order. Missing seeds produce bye matches.
  seedFirstRound(ids) {
    const n = this.teams.length;
    const order = seedOrder(ids.length * 2);
    ids.forEach((id, i) => {
      const a = order[2 * i];
      const b = order[2 * i + 1];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      this.setSlot(id, 'home', this.teams[lo - 1]);
      this.setSlot(id, 'away', hi <= n ? this.teams[hi - 1] : DEAD);
    });
  }

  decide(id, winner, loser) {
    const st = this.state.get(id);
    const m = this.matches.get(id);
    st.winner = winner;
    st.loser = loser;
    m.winner = winner === DEAD ? null : winner;
    m.loser = loser === DEAD ? null : loser;
    if (this.noPropagate.has(id)) return;
    if (m.winner_to) this.setSlot(m.winner_to.match_id, m.winner_to.slot, winner);
    if (m.loser_to) this.setSlot(m.loser_to.match_id, m.loser_to.slot, loser);
  }

  // Apply byes and results until nothing changes. `results` is a Map id -> winner.
  // `canPlay(id)` lets callers block matches (e.g. a GF2 that is not required).
  resolve(results, canPlay = () => true) {
    const consumed = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of this.order) {
        const st = this.state.get(id);
        if (st.winner !== null || st.home === null || st.away === null) continue;
        const m = this.matches.get(id);
        if (st.home === DEAD || st.away === DEAD) {
          m.bye = true;
          if (st.home === DEAD && st.away === DEAD) this.decide(id, DEAD, DEAD);
          else {
            const team = st.home === DEAD ? st.away : st.home;
            if (results.has(id)) {
              if (results.get(id) !== team) continue;
              consumed.add(id);
            }
            this.decide(id, team, DEAD);
          }
          changed = true;
        } else if (results.has(id) && canPlay(id)) {
          const w = results.get(id);
          if (w !== st.home && w !== st.away) continue;
          consumed.add(id);
          this.decide(id, w, w === st.home ? st.away : st.home);
          changed = true;
        }
      }
    }
    const bad = [...results.keys()].filter((id) => !consumed.has(id));
    if (bad.length) throw validation(['params.results'], `Result winner is not a participant of match ${bad[0]}.`);
  }
}

// Validate params.results into a Map. Unknown match ids -> 400.
function parseResults(raw, knownIds) {
  const results = new Map();
  if (raw === undefined || raw === null) return results;
  if (!Array.isArray(raw)) throw validation(['params.results']);
  const bad = [];
  raw.forEach((r, i) => {
    if (!isObj(r) || typeof r.match_id !== 'string' || typeof r.winner !== 'string') {
      bad.push(`params.results[${i}]`);
      return;
    }
    if (!knownIds.has(r.match_id)) {
      bad.push(`params.results[${i}].match_id`);
      return;
    }
    if (results.has(r.match_id) && results.get(r.match_id) !== r.winner) {
      bad.push(`params.results[${i}].winner`);
      return;
    }
    results.set(r.match_id, r.winner);
  });
  if (bad.length) throw validation(bad);
  return results;
}

function parseBool(params, key, dflt) {
  const v = params[key];
  if (v === undefined || v === null) return dflt;
  if (typeof v !== 'boolean') throw validation([`params.${key}`]);
  return v;
}

module.exports = { DEAD, Bracket, bracketSize, seedOrder, newMatch, parseResults, parseBool };
