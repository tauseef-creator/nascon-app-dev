'use strict';
// Aggregates Jest line coverage per backend area into ../COVERAGE.json.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const summary = JSON.parse(fs.readFileSync(path.join(root, 'coverage', 'coverage-summary.json'), 'utf8'));
const AREAS = ['fixtures', 'scoring', 'standings', 'store', 'roster', 'rbac'];

const out = {};
for (const area of AREAS) {
  const dir = path.join(root, 'backend', 'src', 'domain', area) + path.sep;
  let total = 0;
  let covered = 0;
  for (const [file, data] of Object.entries(summary)) {
    if (file.startsWith(dir)) {
      total += data.lines.total;
      covered += data.lines.covered;
    }
  }
  out[area] = total ? Math.floor((covered / total) * 1000) / 10 : 0;
}
fs.writeFileSync(path.join(root, 'COVERAGE.json'), JSON.stringify(out, null, 2) + '\n');
console.log('COVERAGE.json', out);
