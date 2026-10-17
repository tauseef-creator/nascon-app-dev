'use strict';
// Single elimination bracket (spec 5.7-C). Pure function.

const { Bracket, bracketSize, newMatch, parseResults, parseBool } = require('./bracket');

function singleElim(teams, params = {}) {
  const thirdPlace = parseBool(params, 'third_place_match', false);
  const n = teams.length;
  const B = bracketSize(n);
  const k = Math.log2(B);
  const br = new Bracket(teams);
  const rounds = [];
  for (let r = 1; r <= k; r++) {
    const matches = [];
    const count = B / 2 ** r;
    for (let i = 1; i <= count; i++) {
      const m = br.add(newMatch(`R${r}M${i}`, 'main', r, i));
      if (r < k) m.winner_to = { match_id: `R${r + 1}M${Math.ceil(i / 2)}`, slot: i % 2 === 1 ? 'home' : 'away' };
      matches.push(m);
    }
    rounds.push({ round: r, matches });
  }
  if (thirdPlace && k >= 2) {
    const tp = br.add(newMatch('TP', 'third_place', k, 1));
    rounds[k - 1].matches.push(tp);
    rounds[k - 2].matches.forEach((m, i) => {
      m.loser_to = { match_id: 'TP', slot: i === 0 ? 'home' : 'away' };
    });
  }
  br.seedFirstRound(rounds[0].matches.map((m) => m.match_id));
  const results = parseResults(params.results, new Set(br.order));
  br.resolve(results);
  return { format: 'single_elim', bracket_size: B, rounds };
}

module.exports = { singleElim };
