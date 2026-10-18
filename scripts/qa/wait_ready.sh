#!/usr/bin/env bash
# Waits until the API answers GET /health with 200 and the Selenium Grid reports
# ready with at least MIN_NODES nodes (spec 5.2, 6.2.1, 7.3).
# Env: API_URL (http://localhost:8080), GRID_URL (http://localhost:4444),
#      TIMEOUT seconds (120), MIN_NODES (3), SKIP_GRID=1 to only wait for the API.
set -uo pipefail

API_URL="${API_URL:-http://localhost:8080}"
GRID_URL="${GRID_URL:-http://localhost:4444}"
TIMEOUT="${TIMEOUT:-120}"
MIN_NODES="${MIN_NODES:-3}"
start=$(date +%s)

elapsed() { echo $(( $(date +%s) - start )); }

until [ "$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/health")" = "200" ]; do
  if [ "$(elapsed)" -ge "$TIMEOUT" ]; then echo "API not healthy after ${TIMEOUT}s" >&2; exit 1; fi
  sleep 2
done
echo "API healthy after $(elapsed)s"

[ "${SKIP_GRID:-0}" = "1" ] && exit 0

grid_ok() {
  curl -s "$GRID_URL/status" | python3 -c '
import json, sys
v = json.load(sys.stdin)["value"]
up = [n for n in v.get("nodes", []) if n.get("availability") == "UP"]
print("ready=%s nodes=%d" % (v.get("ready"), len(up)))
sys.exit(0 if v.get("ready") and len(up) >= int(sys.argv[1]) else 1)
' "$MIN_NODES"
}

until grid_ok; do
  if [ "$(elapsed)" -ge "$TIMEOUT" ]; then echo "Grid not ready with >= $MIN_NODES nodes after ${TIMEOUT}s" >&2; exit 1; fi
  sleep 2
done
echo "Grid ready after $(elapsed)s"
