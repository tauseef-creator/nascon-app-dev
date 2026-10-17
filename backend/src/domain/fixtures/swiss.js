'use strict';
// Swiss-system pairing for one round (spec 5.7-B). Pure function.

const { validation, conflict } = require('../../lib/errors');
const { isObj, isInt } = require('../../lib/validate');
const { minCostPerfect } = require('./matching');

const RESULTS = new Set(['home', 'away', 'draw']);

function parseParams(teams, params) {
  const n = teams.length;
  const bad = [];
  let totalRounds = Math.ceil(Math.log2(n));
  if (params.total_rounds !== undefined && params.total_rounds !== null) {
    if (!isInt(params.total_rounds) || params.total_rounds < 1 || params.total_rounds > n - 1) bad.push('params.total_rounds');
    else totalRounds = params.total_rounds;
  }
  let round = 1;
  if (params.round !== undefined && params.round !== null) {
    if (!isInt(params.round) || params.round < 1) bad.push('params.round');
    else round = params.round;
  }
  if (!bad.length && round > totalRounds) bad.push('params.round');

  let history = [];
  if (params.history !== undefined && params.history !== null) {
    if (!Array.isArray(params.history)) bad.push('params.history');
    else history = params.history;
  }
  if (bad.length) throw validation(bad);

  const known = new Set(teams);
  const seenRounds = new Set();
  history.forEach((h, i) => {
    const f = `params.history[${i}]`;
    if (!isObj(h)) return bad.push(f);
    if (!isInt(h.round) || h.round < 1 || h.round >= round || seenRounds.has(h.round)) bad.push(`${f}.round`);
    else seenRounds.add(h.round);
    if (h.bye !== undefined && h.bye !== null && (typeof h.bye !== 'string' || !known.has(h.bye))) bad.push(`${f}.bye`);
    if (!Array.isArray(h.matches)) return bad.push(`${f}.matches`);
    h.matches.forEach((m, j) => {
      const g = `${f}.matches[${j}]`;
      if (!isObj(m)) return bad.push(g);
      if (typeof m.home !== 'string' || !known.has(m.home)) bad.push(`${g}.home`);
      if (typeof m.away !== 'string' || !known.has(m.away) || m.away === m.home) bad.push(`${g}.away`);
      if (!RESULTS.has(m.result)) bad.push(`${g}.result`);
    });
  });
  if (!bad.length && seenRounds.size !== round - 1) bad.push('params.history');
  if (bad.length) throw validation(bad);
  return { totalRounds, round, history };
}

function computeStandings(teams, history) {
  const idx = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const pts = new Array(n).fill(0); // half points (integers)
  const opps = teams.map(() => []);
  const hadBye = new Array(n).fill(false);
  const played = teams.map(() => new Set());
  for (const h of history) {
    if (h.bye !== undefined && h.bye !== null) {
      const b = idx.get(h.bye);
      pts[b] += 2;
      hadBye[b] = true;
    }
    for (const m of h.matches) {
      const a = idx.get(m.home);
      const b = idx.get(m.away);
      if (m.result === 'home') pts[a] += 2;
      else if (m.result === 'away') pts[b] += 2;
      else {
        pts[a] += 1;
        pts[b] += 1;
      }
      opps[a].push(b);
      opps[b].push(a);
      played[a].add(b);
      played[b].add(a);
    }
  }
  const buch = opps.map((list) => list.reduce((s, o) => s + pts[o], 0));
  const order = [...Array(n).keys()].sort((a, b) => pts[b] - pts[a] || buch[b] - buch[a] || a - b);
  const standings = order.map((i, r) => ({ rank: r + 1, team_id: teams[i], score: pts[i] / 2, buchholz: buch[i] / 2 }));
  const rank = new Array(n);
  order.forEach((i, r) => {
    rank[i] = r;
  });
  return { pts, hadBye, played, standings, rank };
}

function swiss(teams, params = {}) {
  const { totalRounds, round, history } = parseParams(teams, params);
  const n = teams.length;
  const { pts, hadBye, played, standings, rank } = computeStandings(teams, history);
  let pairs = [];
  let bye = null;

  if (round === 1) {
    const m = Math.floor(n / 2);
    for (let i = 0; i < m; i++) pairs.push([i, i + m]);
    if (n % 2 === 1) bye = n - 1;
  } else {
    let candidates = [null];
    if (n % 2 === 1) {
      // Lowest score first; ties -> lowest seed (largest index) first. Teams that had a bye go last.
      const all = [...Array(n).keys()].sort((a, b) => pts[a] - pts[b] || b - a);
      candidates = all.filter((i) => !hadBye[i]);
      if (!candidates.length) candidates = all;
    }
    let found = null;
    for (const c of candidates) {
      const verts = [...Array(n).keys()].filter((i) => i !== c).sort((a, b) => pts[b] - pts[a] || a - b);
      const w = verts.map((i) => pts[i]);
      const allowed = verts.map((a) => verts.map((b) => a !== b && !played[a].has(b)));
      const res = minCostPerfect(w, allowed);
      if (res) {
        found = { bye: c, pairs: res.pairs.map(([x, y]) => [verts[x], verts[y]]) };
        break;
      }
    }
    if (!found) throw conflict('NO_VALID_PAIRING', `No rematch-free pairing exists for round ${round}.`, { round });
    bye = found.bye;
    // Better-ranked team is home; order matches by the better-ranked team.
    pairs = found.pairs
      .map(([a, b]) => (rank[a] <= rank[b] ? [a, b] : [b, a]))
      .sort((p, q) => rank[p[0]] - rank[q[0]]);
  }

  return {
    format: 'swiss',
    round,
    total_rounds: totalRounds,
    pairings: pairs.map(([a, b], i) => ({ match_id: `SW-R${round}-M${i + 1}`, home: teams[a], away: teams[b] })),
    bye: bye === null ? null : teams[bye],
    standings,
  };
}

module.exports = { swiss, computeStandings };
