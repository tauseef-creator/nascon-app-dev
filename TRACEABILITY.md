# Traceability Matrix

| ID | Requirement | Implementation | Automated tests | Status |
|---|---|---|---|---|
| FR-1.1 | Multi-sport taxonomy, event-sourced scoring | `backend/src/domain/scoring/`, `backend/src/routes/audit/sports.js`, `events.js` | `tests/scoring*.test.js` | In progress |
| FR-1.2 | League and tournament setup | `backend/src/routes/audit/leagues.js` | `tests/standings*.test.js` | In progress |
| FR-1.3 | Fixture scheduling (RR, Swiss, SE, DE) | `backend/src/domain/fixtures/` | `tests/fixtures*.test.js` | In progress |
| FR-1.4 | Standings and tie-breakers | `backend/src/domain/standings/` | `tests/standings*.test.js` | In progress |
| FR-2.1 | Club profiles, tenant isolation | `backend/src/routes/api.js`, `backend/src/domain/rbac/` | `tests/rbac*.test.js` | In progress |
| FR-2.2 | Roster, transfers, loans, audit trail | `backend/src/domain/roster/`, `routes/audit/roster.js` | `tests/roster*.test.js` | In progress |
| FR-2.3 | Merchandise store, concurrency-safe checkout, PDF receipt | `backend/src/domain/store/`, `routes/audit/store.js` | `tests/store*.test.js` | In progress |
| FR-5.1 | Five-tier RBAC | `backend/src/domain/rbac/` | `tests/rbac*.test.js` | In progress |
| NFR-3 | Concurrency correctness | atomic conditional `UPDATE` on `variants` | `tests/store*.test.js` | In progress |
| NFR-4 | Offline tolerance | `mobile/`, `routes/audit/offlineSync.js` | `tests/sync*.test.js` | In progress |
| NFR-5 | Security (JWT, rate limit, validation) | `backend/src/lib/rateLimit.js`, `domain/rbac/` | `tests/rbac*.test.js` | In progress |
| NFR-7 | Reproducibility | `docker-compose.yml`, `backend/src/db/reset.js` | `/health`, `/audit/v1/reset` | Done |
| 5.3 | HMAC signatures | `backend/src/lib/signing.js` | `tests/signing.test.js` | Done |
