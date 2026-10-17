'use strict';
// Standings (spec 5.10). Pure function: no DB, no HTTP.
// Sport behaviour comes only from the sport config (scoring_model, periods).
const { lotsKey } = require('../../lib/signing');

const ALL_CRITERIA = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];
const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 };

// Null-prototype maps so ids like "__proto__" or "constructor" are safe keys.
const dict = (entries = []) => Object.assign(Object.create(null), Object.fromEntries(entries));

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Round to 3 decimals like Python's round(x, 3): ties go to the even neighbour.
function round3(x) {
  const s = x * 1000;
  const f = Math.floor(s);
  const d = s - f;
  let r;
  if (d === 0.5) r = f % 2 === 0 ? f : f + 1;
  else r = Math.round(s);
  const out = r / 1000;
  return out === 0 ? 0 : out;
}

function resolvePoints(points) {
  const p = points && typeof points === 'object' ? points : {};
  const pick = (k) => (Number.isInteger(p[k]) ? p[k] : DEFAULT_POINTS[k]);
  return { win: pick('win'), draw: pick('draw'), loss: pick('loss') };
}

// tie_break_order: league order, else the sport's, else the full list. draw_lots always last.
function resolveCriteria(league, sport) {
  let order = Array.isArray(league.tie_break_order) ? league.tie_break_order
    : Array.isArray(sport && sport.tie_break_order) ? sport.tie_break_order
      : ALL_CRITERIA;
  order = order.filter((c, i) => ALL_CRITERIA.includes(c) && c !== 'draw_lots' && order.indexOf(c) === i);
  return [...order, 'draw_lots'];
}

// Did this projection count as a played match (completed, outcome decided)?
function isPlayed(p) {
  return !!p && p.status === 'completed' && p.outcome !== 'undecided' && p.outcome !== 'pending';
}

// Normalise one played fixture into a per-side record.
function matchRecord(fixture, p) {
  const home = p.home || {};
  const away = p.away || {};
  const homeId = home.team_id != null ? home.team_id : fixture.home;
  const awayId = away.team_id != null ? away.team_id : fixture.away;
  let winner = null;
  if (p.outcome === 'home_win') winner = homeId;
  else if (p.outcome === 'away_win') winner = awayId;
  else if (p.outcome !== 'draw' && p.winner_team_id != null) winner = p.winner_team_id;
  const side = (s) => ({
    score: num(s.score), fair_play: num(s.fair_play), balls: num(s.balls), wickets: num(s.wickets),
  });
  return { match_id: fixture.match_id, homeId, awayId, winner, home: side(home), away: side(away) };
}

// Overs faced by one side in one match (innings model). All out = full allotment.
function oversFaced(s, periods) {
  const bpo = num(periods.balls_per_over) || 6;
  const ipt = num(periods.innings_per_team) || 1;
  const opi = num(periods.overs_per_innings);
  const wpi = num(periods.wickets_per_innings);
  if (wpi > 0 && s.wickets >= wpi * ipt) return opi * ipt;
  return s.balls / bpo;
}

// Aggregate stats for `teamId` over a list of match records.
function aggregate(teamId, records, pts, periods) {
  const a = {
    played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0, points: 0, fair_play: 0,
    oversFaced: 0, oversBowled: 0,
  };
  for (const r of records) {
    let me; let opp;
    if (r.homeId === teamId) { me = r.home; opp = r.away; } else if (r.awayId === teamId) { me = r.away; opp = r.home; } else continue;
    a.played += 1;
    if (r.winner == null) { a.drawn += 1; a.points += pts.draw; } else if (r.winner === teamId) { a.won += 1; a.points += pts.win; } else { a.lost += 1; a.points += pts.loss; }
    a.scored += me.score;
    a.conceded += opp.score;
    a.fair_play += me.fair_play;
    if (periods) {
      a.oversFaced += oversFaced(me, periods);
      a.oversBowled += oversFaced(opp, periods);
    }
  }
  return a;
}

function diffOf(a, innings) {
  if (!innings) return a.scored - a.conceded;
  const forRate = a.oversFaced > 0 ? a.scored / a.oversFaced : 0;
  const againstRate = a.oversBowled > 0 ? a.conceded / a.oversBowled : 0;
  return round3(forRate - againstRate);
}

function computeStandings({ league, sport, projections, lotsSeed }) {
  const teams = [...league.teams];
  const fixtures = league.fixtures || [];
  const pts = resolvePoints(league.points);
  const criteria = resolveCriteria(league, sport);
  const innings = !!sport && sport.scoring_model === 'innings';
  const periods = innings ? (sport.periods || {}) : null;
  const projMap = projections || {};
  const projOf = (id) => (Object.prototype.hasOwnProperty.call(projMap, id) ? projMap[id] : null);
  const seed = lotsSeed != null ? lotsSeed : league.lots_seed != null ? league.lots_seed : 42;
  const spots = league.qualification && Number.isInteger(league.qualification.spots) ? league.qualification.spots : null;

  const played = [];
  const remaining = dict(teams.map((t) => [t, 0]));
  for (const f of fixtures) {
    const p = projOf(f.match_id);
    if (isPlayed(p)) played.push(matchRecord(f, p));
    else {
      if (f.home in remaining) remaining[f.home] += 1;
      if (f.away in remaining) remaining[f.away] += 1;
    }
  }

  const overall = dict();
  for (const t of teams) {
    const a = aggregate(t, played, pts, periods);
    overall[t] = { ...a, diff: diffOf(a, innings) };
  }

  // h2h for every ordered pair of distinct teams.
  const h2h = dict();
  for (const a of teams) {
    h2h[a] = dict();
    for (const b of teams) {
      if (a === b) continue;
      const recs = played.filter((r) => (r.homeId === a && r.awayId === b) || (r.homeId === b && r.awayId === a));
      const s = aggregate(a, recs, pts, null);
      h2h[a][b] = { played: s.played, points: s.points, scored: s.scored, conceded: s.conceded };
    }
  }

  const lots = dict(teams.map((t) => [t, lotsKey(seed, league.league_id, t)]));
  // separator[t] = criterion that placed t above the next team of its points group.
  const separator = dict();

  function criterionValues(criterion, group) {
    if (criterion === 'h2h_points' || criterion === 'h2h_diff') {
      const set = new Set(group);
      const recs = played.filter((r) => set.has(r.homeId) && set.has(r.awayId));
      return group.map((t) => {
        const a = aggregate(t, recs, pts, periods);
        return criterion === 'h2h_points' ? a.points : diffOf(a, innings);
      });
    }
    if (criterion === 'overall_diff') return group.map((t) => overall[t].diff);
    if (criterion === 'scored') return group.map((t) => overall[t].scored);
    return group.map((t) => overall[t].fair_play);
  }

  function resolve(group) {
    if (group.length < 2) return group;
    for (const c of criteria) {
      let subgroups;
      if (c === 'draw_lots') {
        subgroups = [...group].sort((x, y) => (lots[x] < lots[y] ? -1 : lots[x] > lots[y] ? 1 : 0)).map((t) => [t]);
      } else {
        const vals = criterionValues(c, group);
        const distinct = [...new Set(vals)].sort((x, y) => y - x); // higher is better
        if (distinct.length === 1) continue;
        subgroups = distinct.map((v) => group.filter((_, i) => vals[i] === v));
      }
      const out = [];
      subgroups.forEach((sg, i) => {
        const ordered = resolve(sg);
        if (i < subgroups.length - 1) separator[ordered[ordered.length - 1]] = c;
        out.push(...ordered);
      });
      return out;
    }
    /* istanbul ignore next: draw_lots always splits */
    return group;
  }

  const byPoints = new Map();
  for (const t of teams) {
    const p = overall[t].points;
    if (!byPoints.has(p)) byPoints.set(p, []);
    byPoints.get(p).push(t);
  }
  const ordered = [...byPoints.keys()].sort((x, y) => y - x).flatMap((p) => resolve(byPoints.get(p)));

  const W = pts.win;
  const maxPts = (t) => overall[t].points + W * remaining[t];
  const k = spots != null ? spots : teams.length;
  const statusOf = (t) => {
    const others = teams.filter((x) => x !== t);
    const canReach = others.filter((x) => maxPts(x) >= overall[t].points).length;
    if (canReach < k) return 'clinched';
    const above = others.filter((x) => overall[x].points > maxPts(t)).length;
    if (above >= k) return 'eliminated';
    return 'still_possible';
  };

  const table = ordered.map((t, i) => {
    const o = overall[t];
    return {
      rank: i + 1,
      team_id: t,
      played: o.played,
      won: o.won,
      drawn: o.drawn,
      lost: o.lost,
      scored: o.scored,
      conceded: o.conceded,
      diff: o.diff,
      points: o.points,
      fair_play: o.fair_play,
      status: statusOf(t),
      resolved_by: separator[t] || null,
    };
  });

  return { league_id: league.league_id, sport_id: league.sport_id, qualification_spots: spots, table, h2h };
}

module.exports = { computeStandings, round3, resolveCriteria, resolvePoints, isPlayed, ALL_CRITERIA };
