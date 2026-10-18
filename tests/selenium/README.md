# Guest Web Player on Selenium Grid 4

Spec Part II sections 6.2.2 (DOM contract) and 6.2.3 (required test cases), plus NFR-8.
Every test runs on Chrome and Firefox through the Grid hub on `http://localhost:4444`, and each
test opens its own Grid session, so every test starts as a fresh anonymous guest.

| Test | What it checks |
|---|---|
| `test_qr_resolution_zero_friction_load` | `GET /q/m1-live` answers 302 to `/web/matches/match-m1/live`; the browser lands there and `guest-video-player` and `live-score-banner` are visible within 3 s with no `progressive-auth-modal` |
| `test_guest_write_block_opens_progressive_modal` | a guest chat send is rejected (403 `GUEST_WRITE_FORBIDDEN`), the message is not appended and the modal opens |
| `test_guest_cart_staging_and_realtime_score` | `add-to-guest-cart-btn` moves `guest-cart-count` from 0 to 1; a score posted to `/audit/v1/events` reaches `live-score-banner` in under 500 ms (measured in the browser with a MutationObserver, from just before the POST to the DOM update) |
| `test_accessibility_contract` | NFR-8: 48x48 px targets, accessible names and ARIA labels on media controls, text contrast of at least 4.5:1, Tab and Enter keyboard operation |

## Run

```bash
docker compose up -d --build          # backend on :8080, hub on :4444 with 3 browser nodes
pip install -r tests/selenium/requirements.txt
pytest -n 3 tests/selenium/
```

The suite calls `POST /audit/v1/reset` once per run (a file lock keeps it to one call across
pytest-xdist workers) and writes JUnit XML to `tests/reports/selenium-report.xml`. Pass
`--junitxml=<path>` to write it somewhere else.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SELENIUM_REMOTE_URL` | `http://localhost:4444` | Grid hub |
| `BASE_URL` | `http://host.docker.internal:8080` | backend as the browser nodes reach it (use `http://api:8080` for the compose service name) |
| `API_URL` | `http://localhost:8080` | backend as this test process reaches it |
| `BROWSERS` | `chrome,firefox` | browsers to parametrize over |

The browser nodes need `extra_hosts: ["host.docker.internal:host-gateway"]` on Linux so that
`host.docker.internal` resolves inside the Grid containers.
