'use strict';
// Double elimination bracket (spec 5.7-D). Pure function.

const { Bracket, bracketSize, newMatch, parseResults, parseBool } = require('./bracket');

const slotOf = (i) => (i % 2 === 1 ? 'home' : 'away');

function doubleElim(teams, params = {}) {
  const reset = parseBool(params, 'bracket_reset', false);
  const n = teams.length;
  const B = bracketSize(n);
  const k = Math.log2(B);
  const br = new Bracket(teams);
  const make = (id, bracket, round, index) => {
    const m = br.add(newMatch(id, bracket, round, index));
    m.conditional = false;
    m.required = true;
    return m;
  };
  const lrCount = (r) => B / 2 ** (Math.ceil(r / 2) + 1);
  const L = 2 * (k - 1);

  // Winners bracket.
  const winners = [];
  for (let r = 1; r <= k; r++) {
    const matches = [];
    for (let i = 1; i <= B / 2 ** r; i++) {
      const m = make(`WR${r}M${i}`, 'winners', r, i);
      m.winner_to = r < k ? { match_id: `WR${r + 1}M${Math.ceil(i / 2)}`, slot: slotOf(i) } : { match_id: 'GF1', slot: 'home' };
      // WR1 losers meet each other in LR1; WRr (r >= 2) losers drop into LR(2r-2) as the away team.
      m.loser_to = r === 1
        ? { match_id: `LR1M${Math.ceil(i / 2)}`, slot: slotOf(i) }
        : { match_id: `LR${2 * r - 2}M${i}`, slot: 'away' };
      matches.push(m);
    }
    winners.push({ round: r, matches });
  }

  // Losers bracket.
  const losers = [];
  for (let r = 1; r <= L; r++) {
    const matches = [];
    for (let i = 1; i <= lrCount(r); i++) {
      const m = make(`LR${r}M${i}`, 'losers', r, i);
      if (r === L) m.winner_to = { match_id: 'GF1', slot: 'away' };
      else if (r % 2 === 1) m.winner_to = { match_id: `LR${r + 1}M${i}`, slot: 'home' }; // meets a WR dropper
      else m.winner_to = { match_id: `LR${r + 1}M${Math.ceil(i / 2)}`, slot: slotOf(i) };
      matches.push(m);
    }
    losers.push({ round: r, matches });
  }

  // Grand final.
  const gf1 = make('GF1', 'grand_final', 1, 1);
  const grandFinal = [gf1];
  br.noPropagate.add('GF1');
  let gf2 = null;
  if (reset) {
    gf2 = make('GF2', 'grand_final', 2, 1);
    gf2.conditional = true;
    gf2.required = null;
    // GF2 is played by the same two teams; if it happens, the GF1 winner is the GF1 away team.
    gf1.winner_to = { match_id: 'GF2', slot: 'away' };
    gf1.loser_to = { match_id: 'GF2', slot: 'home' };
    br.mirror.set('GF1', 'GF2');
    grandFinal.push(gf2);
  }

  br.seedFirstRound(winners[0].matches.map((m) => m.match_id));
  const results = parseResults(params.results, new Set(br.order));
  const gf2Required = () => {
    if (gf1.winner === null) return null;
    return reset && gf1.winner === gf1.away;
  };
  br.resolve(results, (id) => id !== 'GF2' || gf2Required() === true);
  if (gf2) gf2.required = gf2Required();

  return { format: 'double_elim', bracket_size: B, bracket_reset: reset, winners, losers, grand_final: grandFinal };
}

module.exports = { doubleElim };
