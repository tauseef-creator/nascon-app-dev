'use strict';
// Round robin via the circle method (spec 5.7-A). Pure function.

const { validation } = require('../../lib/errors');
const { isObj, isInt } = require('../../lib/validate');

// Returns one leg as an array of rounds; each round is { pairs: [[home, away]], bye }.
function circleLeg(teams) {
  const arr = teams.slice();
  if (arr.length % 2 === 1) arr.push(null);
  const N = arr.length;
  const fixed = arr[N - 1];
  const ring = arr.slice(0, N - 1);
  const R = N - 1;
  const rounds = [];
  for (let r = 0; r < R; r++) {
    const at = (p) => ring[(((p - r) % R) + R) % R];
    const pairs = [];
    let bye = null;
    // Pair involving the fixed slot: alternate home/away by round parity.
    const a = at(0);
    if (fixed === null) bye = a;
    else if (r % 2 === 0) pairs.push([a, fixed]);
    else pairs.push([fixed, a]);
    for (let p = 1; p < N / 2; p++) pairs.push([at(p), at(N - 1 - p)]);
    rounds.push({ pairs, bye });
  }
  return rounds;
}

function parseParams(teams, params) {
  const bad = [];
  let legs = 1;
  if (params.legs !== undefined && params.legs !== null) {
    if (!isInt(params.legs) || (params.legs !== 1 && params.legs !== 2)) bad.push('params.legs');
    else legs = params.legs;
  }
  let policy = 'forfeit_remaining';
  if (params.withdrawal_policy !== undefined && params.withdrawal_policy !== null) {
    if (params.withdrawal_policy !== 'forfeit_remaining' && params.withdrawal_policy !== 'void_all') {
      bad.push('params.withdrawal_policy');
    } else policy = params.withdrawal_policy;
  }
  const n = teams.length;
  const roundCount = legs * (n % 2 === 0 ? n - 1 : n);
  const withdrawals = new Map();
  const w = params.withdrawals;
  if (w !== undefined && w !== null) {
    if (!Array.isArray(w)) bad.push('params.withdrawals');
    else {
      const known = new Set(teams);
      w.forEach((item, i) => {
        if (!isObj(item)) return bad.push(`params.withdrawals[${i}]`);
        if (typeof item.team_id !== 'string' || !known.has(item.team_id)) bad.push(`params.withdrawals[${i}].team_id`);
        if (!isInt(item.after_round) || item.after_round < 0 || item.after_round > roundCount) {
          bad.push(`params.withdrawals[${i}].after_round`);
        }
        if (bad.length === 0) {
          const prev = withdrawals.get(item.team_id);
          withdrawals.set(item.team_id, prev === undefined ? item.after_round : Math.min(prev, item.after_round));
        }
      });
    }
  }
  if (bad.length) throw validation(bad);
  return { legs, policy, withdrawals, roundCount };
}

function roundRobin(teams, params = {}) {
  const { legs, policy, withdrawals, roundCount } = parseParams(teams, params);
  const leg = circleLeg(teams);
  const perLeg = leg.length;
  const rounds = [];
  const summary = { total: 0, scheduled: 0, forfeit: 0, voided: 0 };

  // Has `team` withdrawn by `round` (i.e. it no longer plays in that round)?
  const gone = (team, round) => withdrawals.has(team) && (policy === 'void_all' || round > withdrawals.get(team));

  for (let l = 1; l <= legs; l++) {
    leg.forEach((lr, r) => {
      const round = (l - 1) * perLeg + r + 1;
      const matches = lr.pairs.map(([h, a], i) => {
        const home = l === 1 ? h : a;
        const away = l === 1 ? a : h;
        const hg = gone(home, round);
        const ag = gone(away, round);
        let status = 'scheduled';
        let awardedTo = null;
        if (hg && ag) status = 'voided';
        else if (hg || ag) {
          if (policy === 'void_all') status = 'voided';
          else {
            status = 'forfeit';
            awardedTo = hg ? away : home;
          }
        }
        summary.total += 1;
        summary[status] += 1;
        return { match_id: `RR-L${l}-R${round}-M${i + 1}`, leg: l, home, away, status, awarded_to: awardedTo };
      });
      rounds.push({ round, matches, byes: lr.bye === null ? [] : [lr.bye] });
    });
  }

  return { format: 'round_robin', legs, team_count: teams.length, round_count: roundCount, rounds, summary };
}

module.exports = { roundRobin, circleLeg };
