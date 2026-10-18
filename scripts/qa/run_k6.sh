#!/usr/bin/env bash
# Runs the k6 load profile (spec 6.4) in the grafana/k6 container on the host network
# and writes the summary to tests/reports/k6-summary.json.
#
# Usage: scripts/qa/run_k6.sh [script] [summary-file]
#   script        default tests/k6_load.js (scripts/qa/k6_smoke.js for a short CI check)
#   summary-file  default tests/reports/k6-summary.json
# Env: BASE_URL (default http://localhost:8080), K6_IMAGE (default grafana/k6:0.54.0)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="${1:-tests/k6_load.js}"
SUMMARY="${2:-tests/reports/k6-summary.json}"
IMAGE="${K6_IMAGE:-grafana/k6:0.54.0}"
BASE_URL="${BASE_URL:-http://localhost:8080}"

mkdir -p "$ROOT/$(dirname "$SUMMARY")"
echo "k6: $SCRIPT -> $SUMMARY (BASE_URL=$BASE_URL)"
exec docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  -v "$ROOT:/work" -w /work \
  -e BASE_URL="$BASE_URL" \
  "$IMAGE" run --summary-export="$SUMMARY" "$SCRIPT"
