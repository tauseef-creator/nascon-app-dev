#!/usr/bin/env bash
# Runs the Phase II QA suites against a running stack (docker compose up -d --build)
# and writes the reports the spec expects (1.3) into tests/reports/:
#   selenium-report.xml, appium-report.xml, k6-summary.json
#
# Steps: wait for /health + Grid, POST /audit/v1/reset, Selenium (pytest -n 3 via Grid),
# Appium (skipped with a placeholder report when no Appium server/device), k6.
# Env:
#   PYTHON        interpreter with pytest, pytest-xdist, selenium, requests
#                 (default ~/nascon-tools/venv/bin/python if present, else python3)
#   API_URL       URL the host uses to reach the API (http://localhost:8080)
#   BASE_URL      URL the Grid browsers load (http://backend:8080)
#   GRID_URL      Selenium Grid hub (http://localhost:4444)
#   APPIUM_URL    Appium 2 server (http://localhost:4723)
#   SKIP_SELENIUM / SKIP_APPIUM / SKIP_K6 = 1 to skip a step
#   K6_SCRIPT     k6 script (tests/k6_load.js)
# Exit code is non-zero when any executed step failed.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
REPORTS="tests/reports"
mkdir -p "$REPORTS"

if [ -z "${PYTHON:-}" ]; then
  if [ -x "$HOME/nascon-tools/venv/bin/python" ]; then PYTHON="$HOME/nascon-tools/venv/bin/python"; else PYTHON=python3; fi
fi
export API_URL="${API_URL:-http://localhost:8080}"
export BASE_URL="${BASE_URL:-http://backend:8080}"
export GRID_URL="${GRID_URL:-http://localhost:4444}"
export SELENIUM_GRID_URL="${SELENIUM_GRID_URL:-$GRID_URL}"
export APPIUM_URL="${APPIUM_URL:-http://localhost:4723}"

failed=()

step() { printf '\n=== %s ===\n' "$1"; }

skip_report() { # $1 file, $2 suite name, $3 reason
  cat > "$1" <<XML
<?xml version="1.0" encoding="utf-8"?>
<testsuites><testsuite name="$2" tests="1" errors="0" failures="0" skipped="1"><testcase classname="$2" name="suite"><skipped message="$3"/></testcase></testsuite></testsuites>
XML
}

step "wait for stack"
if [ "${SKIP_SELENIUM:-0}" = "1" ]; then SKIP_GRID=1 API_URL="$API_URL" scripts/qa/wait_ready.sh || failed+=(wait)
else API_URL="$API_URL" GRID_URL="$GRID_URL" scripts/qa/wait_ready.sh || failed+=(wait); fi

step "reset"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/audit/v1/reset" -H 'Content-Type: application/json' -d '{}')
echo "POST /audit/v1/reset -> $code"
[ "$code" = "200" ] || failed+=(reset)

if [ "${SKIP_SELENIUM:-0}" != "1" ]; then
  step "selenium (Grid $GRID_URL, BASE_URL=$BASE_URL)"
  if [ -d tests/selenium ]; then
    "$PYTHON" -m pytest -n 3 tests/selenium --junitxml="$REPORTS/selenium-report.xml" || failed+=(selenium)
  else
    echo "tests/selenium missing"; failed+=(selenium)
  fi
fi

if [ "${SKIP_APPIUM:-0}" != "1" ]; then
  step "appium ($APPIUM_URL)"
  if [ ! -d tests/appium ]; then
    echo "tests/appium missing, skipping"
    skip_report "$REPORTS/appium-report.xml" appium "tests/appium not present"
  elif ! curl -sf "$APPIUM_URL/status" >/dev/null 2>&1; then
    echo "no Appium server at $APPIUM_URL, skipping"
    skip_report "$REPORTS/appium-report.xml" appium "Appium server not reachable at $APPIUM_URL"
  elif command -v adb >/dev/null 2>&1 && ! adb devices | awk 'NR>1 && $2=="device"' | grep -q .; then
    echo "no Android device attached, skipping"
    skip_report "$REPORTS/appium-report.xml" appium "no Android device attached"
  else
    "$PYTHON" -m pytest tests/appium --junitxml="$REPORTS/appium-report.xml"
    rc=$?
    # 5 = no tests collected; anything else non-zero is a failure.
    [ "$rc" = "0" ] || [ "$rc" = "5" ] || failed+=(appium)
  fi
fi

if [ "${SKIP_K6:-0}" != "1" ]; then
  step "k6"
  BASE_URL="$API_URL" scripts/qa/run_k6.sh "${K6_SCRIPT:-tests/k6_load.js}" "$REPORTS/k6-summary.json" || failed+=(k6)
fi

echo
if [ "${#failed[@]}" -gt 0 ]; then echo "FAILED: ${failed[*]}"; exit 1; fi
echo "ALL QA STEPS PASSED"
