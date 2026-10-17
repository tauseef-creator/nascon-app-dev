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
