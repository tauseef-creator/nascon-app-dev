# NaSCon '26 App Dev: Multi-Sport League & Club Operations Platform

## Run the backend

```sh
cp .env.example .env            # optional; compose has defaults
DAY1_SALT=<team-salt> docker compose up -d --build
curl http://localhost:8080/health   # {"status":"ok"}
```

Services: `api` (Node 20 + Express, port 8080), `worker` (domain-event consumer),
`postgres` 16, `redis` 7 (rate limiting + Redis Streams queue), `minio` (PDF receipts).

## Tests

```sh
./run_tests.sh    # unit tests + coverage, regenerates COVERAGE.json
```

## Demo accounts (password for all: `Nascon@26`)

| Role | Email |
|---|---|
| Platform Super-Admin | admin@nascon.test |
| League Organizer (owns league-alpha-1) | organizer@nascon.test |
| Club Manager (owns club-alpha-1) | manager@nascon.test |
| Player (player-alpha-1) | player@nascon.test |
| General Viewer | viewer@nascon.test |

## Mobile app

Source in `mobile/` (Expo React Native). Release build: `mobile/release/app-release.apk`.
The server address is editable on the app's Settings screen (emulator: `10.0.2.2:8080`, phone: laptop LAN IP).

## Phase II: live streaming, dynamic QR, guest web player and grid QA

### Run the full stack

```sh
cp .env.example .env    # put your own DAY1_SALT and DAY2_SALT here (never commit .env)
DAY1_SALT=<day1-team-salt> DAY2_SALT=<day2-team-salt> docker compose up -d --build
scripts/qa/wait_ready.sh                  # waits for /health 200 and a ready Grid with 3 nodes
curl http://localhost:8080/health         # {"status":"ok"}
curl http://localhost:4444/status         # value.ready == true, 3 nodes
```

Both salts are read only from the environment. The repository holds placeholders only; do not
put real salts in any tracked file, test or doc.

Phase II adds `mediamtx` (RTMP, HLS, WebRTC), `selenium-hub` and three browser nodes
(`node-chrome-1`, `node-chrome-2`, `node-firefox`) to the Phase I services.

| Port | Service | Probe |
|---|---|---|
| 8080 | Core API, guest web player (`/web/*`), `/metrics`, WebSocket `/ws/*` | `GET /health` |
| 4444 | Selenium Grid 4 hub (3 browser nodes) | `GET /status` |
| 4723 | Appium 2 with uiautomator2 (runs on the host, not in compose) | `GET /status` |
| 1935 | MediaMTX RTMP ingest | `rtmp://localhost:1935/live/{stream_key}` |
| 8888 | MediaMTX HLS playback | `/live/{stream_key}/index.m3u8`, `/costream/{session_id}/index.m3u8` |
| 8889 | MediaMTX WebRTC (WHIP ingest, WHEP playback) | `/live/{stream_key}/whip` |

### Guest web player

Open http://localhost:8080/q/m1-live in any browser. The short link redirects (302) to
`/web/matches/match-m1/live`, which plays the stream, shows the live score and pinned
merchandise, and lets a guest stage a cart without signing in. Other routes:
`/web/players/{id}`, `/web/clubs/{id}`, `/web/costream/{id}` and the match `preview`, `vod`
and `notice` views.

To go live, create a key with `POST /audit/v1/stream/key` (`{"action":"generate","player_id":"player-alpha-1"}`)
or from the app's broadcast screen, then publish from OBS or FFmpeg to the returned RTMP or WHIP URL.

### Accounts, notifications and VOD storage

- `POST /api/v1/auth/register` with `{"email","password","display_name"?,"tenant_id"?,"guest_token"?}`
  creates a viewer account (201, same `{token, user, tenant}` shape as login plus `cart_merge`). When
  `guest_token` is sent in the body, the staged guest cart is merged into the new member cart (FR-4.4).
- Guest tokens from `POST /api/v1/guest/session` expire after `GUEST_TOKEN_TTL_S` seconds (default
  86400) and are then rejected with 401 `GUEST_TOKEN_EXPIRED`. The seeded `guest_anon_tok_7721` does
  not expire (FR-4.2).
- `ws://localhost:8080/ws/users/me?token=<jwt>` pushes `{"type":"order_status","data":{...}}` frames for
  the signed-in user's orders (FR-5.2).
- When a live stream ends, its recording is copied from the `recordings` volume to MinIO under
  `vods/<vod_id>/` (bucket `MINIO_VOD_BUCKET`, else `MINIO_BUCKET`), best effort (FR-3.2).

### Test suites

Run these from the repo root. Every suite except the unit tests needs the stack running.

| Suite | Command | Report |
|---|---|---|
| Unit (jest) + coverage | `./run_tests.sh` | `coverage/`, `COVERAGE.json`, `COVERAGE_DAY2.json` |
| Contract (Phase I + II) | `BASE_URL=http://localhost:8080 pytest tests/contract -q` (salts come from the environment or `.env`, same values as the stack) | terminal |
| Selenium Grid (3 parallel sessions) | `pip install -r tests/selenium/requirements.txt` then `pytest -n 3 tests/selenium/` | `tests/reports/selenium-report.xml` |
| Appium (Android device on USB, Appium 2 on 4723) | `pytest tests/appium` | `tests/reports/appium-report.xml` |
| k6 load (550 VUs, 15 s) | `k6 run --summary-export=tests/reports/k6-summary.json tests/k6_load.js` or `scripts/qa/run_k6.sh` (Docker, no local k6 needed) | `tests/reports/k6-summary.json` |
| All QA suites | `scripts/qa/run_all.sh` | all three files above in `tests/reports/` |

Notes:
- Selenium browsers reach the API at `BASE_URL` (default `http://host.docker.internal:8080`; `run_all.sh`
  uses the compose alias `http://backend:8080`). See `tests/selenium/README.md` for all variables.
- Appium settings (`APPIUM_URL`, `ANDROID_UDID`, `APP_PACKAGE`) are documented in `tests/appium/conftest.py`.
  Without a server or device the suite records a skipped report instead of failing.
- `run_all.sh` accepts `SKIP_SELENIUM=1`, `SKIP_APPIUM=1` and `SKIP_K6=1`.
- `.github/workflows/autograde.yml` runs the same steps on every push to `main` and uploads
  `tests/reports/` as the `qa-reports` artifact.

### Demo accounts

Unchanged from Phase I (see the table above). The reset also seeds the Phase II baseline:
`match-m1` in progress at 1 - 0, QR short links `m1-live`, `p-alpha-1` and `c-alpha-1`, the guest
token `guest_anon_tok_7721` and an empty cart for `player-alpha-1`.

Design decisions: `ADR.md` (ADR-009 onward). Requirement mapping: `TRACEABILITY.md` (Phase II section).
