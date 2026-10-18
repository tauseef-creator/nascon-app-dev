'use strict';
// Aggregates Jest line coverage for the five Phase II modules into ../COVERAGE_DAY2.json
// (spec 7.2). A module whose source files are missing, or absent from the summary, reports 0.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const summaryFile = path.join(root, 'coverage', 'coverage-summary.json');
const summary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : {};
const day2 = path.join(root, 'backend', 'src', 'domain', 'day2');

const MODULES = {
  streaming: ['streaming.js'],
  costream: ['costream.js'],
  qr_guest: ['qr.js', 'guest.js'],
  moderation_dlq: ['moderation.js'],
  observability: ['metrics.js'],
};

const out = {};
for (const [name, files] of Object.entries(MODULES)) {
  let total = 0;
  let covered = 0;
  for (const file of files) {
    const data = summary[path.join(day2, file)];
    if (data) {
      total += data.lines.total;
      covered += data.lines.covered;
    }
  }
  out[name] = total ? Math.floor((covered / total) * 1000) / 10 : 0;
}
fs.writeFileSync(path.join(root, 'COVERAGE_DAY2.json'), JSON.stringify(out, null, 2) + '\n');
console.log('COVERAGE_DAY2.json', out);
