#!/usr/bin/env sh
# Runs all unit tests with line coverage and regenerates COVERAGE.json (spec 9.3).
set -e
cd "$(dirname "$0")/backend"
[ -d node_modules ] || npm ci --no-audit --no-fund
npx jest --config jest.config.js --coverage "$@"
node scripts/coverage-areas.js
node scripts/coverage-day2.js
