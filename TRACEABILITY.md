# Traceability Matrix

Unit tests: `./run_tests.sh` (jest, `tests/*.test.js`). Contract tests against the live
stack: `tests/contract/` (pytest). Paths are relative to the repo root.

| ID | Requirement | Implementation | Automated tests | Status |
|---|---|---|---|---|
| FR-1.1 | Multi-sport taxonomy, sports as JSON, mystery sport | `backend/src/domain/scoring/sportConfig.js`, `backend/src/routes/audit/sports.js`, `backend/src/db/seedData.js` | `tests/sports.test.js`; `tests/contract/test_domain.py::test_mystery_sport_and_scoring_flow` | Done |
| FR-1.1 | Event-sourced scoring, compensating events, HMAC signatures | `backend/src/domain/scoring/{projection,rules,eventSchema}.js`, `backend/src/services/events.js`, `backend/src/lib/signing.js` | `tests/scoring.test.js`, `tests/scoring.service.test.js`, `tests/signing.test.js`; `test_domain.py::test_cricket_overs_and_innings_limit` | Done |
| FR-1.2 | League setup scoped to seasons | `backend/src/domain/scoring/league.js`, `backend/src/routes/audit/leagues.js` | `tests/scoring.service.test.js`; `test_domain.py::test_standings_draw_lots_vector` | Done |
| FR-1.3 | Fixtures: round robin, Swiss, single and double elimination | `backend/src/domain/fixtures/*`, `backend/src/routes/audit/fixtures.js` | `tests/fixtures.test.js`; `test_domain.py::test_round_robin_*`, `test_swiss_*`, `test_single_elim_six_exact`, `test_double_elim_counts` | Done |
| FR-1.3 | Match status state machine, real-time broadcast | `backend/src/domain/scoring/rules.js`, `backend/src/lib/realtime.js`, `backend/src/routes/realtime.js` | `tests/scoring.test.js` | Done |
| FR-1.4 | Standings, tie-breakers, H2H, qualification | `backend/src/domain/standings/index.js`, `backend/src/routes/audit/standings.js` | `tests/standings.test.js`; `test_domain.py::test_standings_draw_lots_vector` | Done |
| FR-2.1 | Club profiles, tenant isolation, white-label branding | `backend/src/routes/api.js`, `backend/src/routes/app.js`, `backend/src/domain/rbac/policy.js` | `tests/rbac.routes.test.js` | Done |
| FR-2.2 | Roster: transfer, loan, release, audit trail, auto-return | `backend/src/domain/roster/{validate,rules}.js`, `backend/src/services/roster.js`, `backend/src/routes/audit/roster.js` | `tests/roster.test.js`; `test_domain.py::test_roster_*` | Done |
| FR-2.3 | Store, mock gateway, PDF receipt, order events | `backend/src/domain/store/*`, `backend/src/services/store.js`, `backend/src/services/pdf.js`, `backend/src/lib/queue.js`, `backend/src/worker.js` | `tests/store.test.js`, `tests/store.service.test.js`; `test_core_security.py::test_checkout_*` | Done |
| FR-5.1 | Five-tier RBAC, negative authorization tests | `backend/src/domain/rbac/policy.js`, `backend/src/lib/auth.js`, `backend/src/routes/audit/rbac.js` | `tests/rbac.matrix.test.js`, `tests/rbac.auth.test.js`, `tests/rbac.routes.test.js`; `test_core_security.py::test_rbac_*` | Done |
| NFR-3 | Concurrency: 20 buyers, last unit | `backend/src/services/store.js` (atomic conditional UPDATE) | `tests/store.service.test.js`; `test_core_security.py::test_concurrent_checkout_last_unit` | Done |
| NFR-4 | Offline tolerance, sync with conflict handling | `backend/src/domain/sync/index.js`, `backend/src/routes/audit/offlineSync.js`, `mobile/src/offline/*` | `tests/sync.test.js`; `test_domain.py::test_offline_sync_flow` | Backend done; mobile in progress |
| NFR-5 | Security: JWT, rate limit, validation, body limit | `backend/src/lib/auth.js`, `backend/src/lib/rateLimit.js`, `backend/src/lib/errors.js`, `backend/src/app.js` | `tests/rbac.auth.test.js`; `test_core_security.py::test_rate_limit_ping`, `test_body_over_1mb_is_413`, `test_sql_injection_sport_id_is_400` | Done |
| NFR-7 | Reproducible one-command stack with seed data | `docker-compose.yml`, `backend/Dockerfile`, `backend/src/db/{schema,reset,seedData,demoSeed}.js` | `test_core_security.py::test_health_and_reset_shape`, `test_reset_is_repeatable` | Done |
