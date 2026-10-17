'use strict';
// Graph matching helpers used by the Swiss pairer. Pure functions.

// Edmonds' blossom algorithm: maximum cardinality matching on a general graph.
// `adj` is an array of neighbour arrays over vertices 0..n-1. Returns the matching size.
function maxMatching(n, adj) {
  const match = new Array(n).fill(-1);
  let size = 0;
  // Greedy start.
  for (let v = 0; v < n; v++) {
    if (match[v] !== -1) continue;
    for (const u of adj[v]) {
      if (match[u] === -1) {
        match[u] = v;
        match[v] = u;
        size += 1;
        break;
      }
    }
  }
  const p = new Array(n);
  const base = new Array(n);
  const used = new Array(n);
  const blossom = new Array(n);

  function lca(a, b) {
    const seen = new Array(n).fill(false);
    for (;;) {
      a = base[a];
      seen[a] = true;
      if (match[a] === -1) break;
      a = p[match[a]];
    }
    for (;;) {
      b = base[b];
      if (seen[b]) return b;
      b = p[match[b]];
    }
  }

  function markPath(v, b, child) {
    while (base[v] !== b) {
      blossom[base[v]] = true;
      blossom[base[match[v]]] = true;
      p[v] = child;
      child = match[v];
      v = p[match[v]];
    }
  }

  function findPath(root) {
    used.fill(false);
    p.fill(-1);
    for (let i = 0; i < n; i++) base[i] = i;
    used[root] = true;
    const q = [root];
    let qh = 0;
    while (qh < q.length) {
      const v = q[qh++];
      for (const to of adj[v]) {
        if (base[v] === base[to] || match[v] === to) continue;
        if (to === root || (match[to] !== -1 && p[match[to]] !== -1)) {
          const cur = lca(v, to);
          blossom.fill(false);
          markPath(v, cur, to);
          markPath(to, cur, v);
          for (let i = 0; i < n; i++) {
            if (blossom[base[i]]) {
              base[i] = cur;
              if (!used[i]) {
                used[i] = true;
                q.push(i);
              }
            }
          }
        } else if (p[to] === -1) {
          p[to] = v;
          if (match[to] === -1) return to;
          used[match[to]] = true;
          q.push(match[to]);
        }
      }
    }
    return -1;
  }

  for (let v = 0; v < n; v++) {
    if (match[v] !== -1) continue;
    let u = findPath(v);
    if (u === -1) continue;
    size += 1;
    while (u !== -1) {
      const pv = p[u];
      const ppv = match[pv];
      match[u] = pv;
      match[pv] = u;
      u = ppv;
    }
  }
  return size;
}

// Does the subgraph induced by `verts` (indices) of `allowed` (boolean matrix) have a perfect matching?
function hasPerfect(verts, allowed) {
  const m = verts.length;
  if (m % 2 === 1) return false;
  if (m === 0) return true;
  const adj = verts.map((a, i) => {
    const row = [];
    for (let j = 0; j < m; j++) if (j !== i && allowed[a][verts[j]]) row.push(j);
    return row;
  });
  return maxMatching(m, adj) * 2 === m;
}

// Exact minimum-cost perfect matching where cost(i,j) = |w[i] - w[j]| (integers),
// restricted to allowed[i][j]. Vertices must be sorted by w descending.
// Branch and bound: lower bound = unconstrained optimum (adjacent pairs in sorted order),
// pruning of infeasible branches with a blossom perfect-matching test.
// Returns { cost, pairs: [[i, j]] } or null when no perfect matching exists.
function minCostPerfect(w, allowed) {
  const n = w.length;
  const all = [...Array(n).keys()];
  if (!hasPerfect(all, allowed)) return null;
  const free = new Array(n).fill(true);
  let best = Infinity;
  let bestPairs = null;
  const pairs = [];
  let done = false;

  const remaining = () => all.filter((i) => free[i]);
  const lowerBound = (rem) => {
    let lb = 0;
    for (let k = 0; k + 1 < rem.length; k += 2) lb += w[rem[k]] - w[rem[k + 1]];
    return lb;
  };

  function dfs(cost) {
    let i = -1;
    for (let k = 0; k < n; k++) if (free[k]) { i = k; break; }
    if (i === -1) {
      if (cost < best) {
        best = cost;
        bestPairs = pairs.slice();
        if (best === rootLb) done = true; // global optimum reached
      }
      return;
    }
    free[i] = false;
    const cands = [];
    for (let j = i + 1; j < n; j++) if (free[j] && allowed[i][j]) cands.push(j);
    cands.sort((a, b) => Math.abs(w[i] - w[a]) - Math.abs(w[i] - w[b]) || a - b);
    for (const j of cands) {
      const c = cost + Math.abs(w[i] - w[j]);
      if (c >= best) continue;
      free[j] = false;
      const rem = remaining();
      if (c + lowerBound(rem) < best && hasPerfect(rem, allowed)) {
        pairs.push([i, j]);
        dfs(c);
        pairs.pop();
      }
      free[j] = true;
      if (done) break;
    }
    free[i] = true;
  }

  const rootLb = lowerBound(all);
  dfs(0);
  return { cost: best, pairs: bestPairs };
}

module.exports = { maxMatching, hasPerfect, minCostPerfect };
