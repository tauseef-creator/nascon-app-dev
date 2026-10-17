# Architecture Decision Records

## ADR-001: Modular monolith with pure domain modules
- **Context:** One 4-hour sprint, six independently graded backend areas, an 85% coverage bonus per area.
- **Decision:** One Node.js 20 / Express 5 API. Domain rules (fixtures, scoring, standings, roster, store, RBAC, sync) are pure functions in `backend/src/domain/`; services load and persist; routes only parse and respond.
- **Alternatives:** Microservices per area (deployment overhead, no benefit at this scale); logic inside route handlers (hard to unit test).
- **Consequences:** Fast, DB-free unit tests with 100% domain coverage; one deployable image reused by the worker.

## ADR-002: Event sourcing for match scoring
- **Context:** Scores must be rebuilt from an append-only log; corrections must never mutate history (FR-1.1, 5.9).
- **Decision:** `match_events` is append-only with `PRIMARY KEY (match_id, sequence)` and a unique `event_id`. The projection (`domain/scoring/projection.js`) is recomputed from the log on every read. A correction is a new signed `compensation` event; the projection treats the target and the compensation as neutral.
- **Alternatives:** Mutable score counters (fast reads, but lose history and violate the contract).
- **Consequences:** Full audit trail and trivially correct standings recomputation (edge case 5); reads cost O(events), which is small per match.

## ADR-003: Sports as data, never as code
- **Context:** A "mystery sport" is added at grading time; branching on sport or event names costs 8 points.
- **Decision:** Each sport is a JSON config (`scoring_model` = event / innings / round, `scoring_events`, periods, roster limits, tie-break order) stored in `sports.config`. All logic reads the config; seeded sports use the same schema.
- **Alternatives:** A class per sport (fails the mystery-sport requirement).
- **Consequences:** New sports work instantly through `POST /audit/v1/sports`; three generic scoring models cover every sport.

## ADR-004: Database-level concurrency control
- **Context:** 20 simultaneous buyers on the last unit must produce exactly one order (NFR-3); concurrent events on one match need unique sequences.
- **Decision:** Stock is reserved with one atomic conditional statement per item (`UPDATE variants SET stock = stock - q, reserved = reserved + q WHERE stock >= q`) inside a transaction, in sorted variant order. Match appends are serialized with `pg_advisory_xact_lock(hashtext('match:'||id))`; roster writes with a roster advisory lock. Order ids are claimed with `INSERT ... ON CONFLICT DO NOTHING`.
- **Alternatives:** Application-level mutexes (break with more than one API instance); `SERIALIZABLE` isolation with retries (more complex, slower under the burst).
- **Consequences:** Zero overselling, never negative stock (also guarded by `CHECK (stock >= 0)`), correct under horizontal scaling.

## ADR-005: Idempotency by client-supplied ids
- **Context:** Clients retry; offline devices replay actions (5.2, 5.14).
- **Decision:** Every write carrying `event_id`, `order_id`, `request_id` or `(device_id, action_id)` stores a hash of the canonical request and the response. Same id + same body returns the stored response with 200; a different body returns 409.
- **Consequences:** Safe retries and offline replays; the stored response wins even if the action would now be illegal.

## ADR-006: Five-tier RBAC as policy-as-code with JWT
- **Context:** Five roles with scoped permissions and absolute tenant isolation (FR-5.1, 5.13).
- **Decision:** A pure `authorize(principal, action, target)` policy matrix in `domain/rbac/policy.js`, default deny. HS256 JWTs verified with an explicit algorithm allow-list (rejects `alg:none`, tampering, expiry). Cross-tenant access returns 403, never 404.
- **Alternatives:** Database policy table (harder to test exhaustively); Keycloak (heavy container for the RAM budget).
- **Consequences:** Every cell of the 85-entry matrix is unit tested; adding a role means adding rows, not code paths.

## ADR-007: Redis for rate limiting and the internal queue; MinIO for receipts
- **Context:** The stack needs a cache, a queue and an object store within 8 GB RAM; graded probes need rate limiting on `/api/v1/*` only.
- **Decision:** Redis 7 serves the Redis Streams domain-event queue (`domain-events`, consumed by the `worker` service). The rate limiter is a sliding window of 100 requests per 10 s per IP. PDF receipts are generated server-side with pdfkit and uploaded to MinIO (`bitnamilegacy/minio`, because `minio/minio` was removed from Docker Hub).
- **Alternatives:** RabbitMQ or NATS (extra container and RAM for the same job; Redis Streams is on the approved list).
- **Consequences:** Four lightweight containers; queue and storage failures never fail a request (best effort).

## ADR-008: Offline-first mobile app with an action queue
- **Context:** Judges use the app in airplane mode, force-close it, then sync (NFR-4, 8.4).
- **Decision:** Expo (React Native) with expo-router. Fixtures, standings, clubs, products and scores are cached in SQLite. Offline score and roster actions are stored in a persistent SQLite queue in the exact 5.14 format and replayed through `POST /audit/v1/offline-sync`, which processes actions by `queued_at`, rebases stale versions and reports server-wins conflicts per action. Tokens live in the Android Keystore via expo-secure-store; live scores arrive over Server-Sent Events with a polling fallback.
- **Alternatives:** Last-write-wins client sync (silently loses conflicts); Firebase (banned).
- **Consequences:** The same sync logic is used by the grader and the app; conflicts are explained to the user in plain language.
