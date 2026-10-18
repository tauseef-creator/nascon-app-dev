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

## ADR-009: MediaMTX as the self-hosted media server
- **Context:** Phase II needs RTMP ingest on 1935, HLS on 8888 (`/live/{key}/index.m3u8`, `/costream/{id}/index.m3u8`) and WHIP / WHEP on 8889, with key-based publish authorization and a revoke that severs ingest within 2 s (FR-3.2, 6.1). The grader runs on 8 GB RAM.
- **Decision:** One `bluenviron/mediamtx:1.9.1-ffmpeg` container configured by `backend/media/mediamtx.yml`. Its native paths and ports already match the contract URLs. `authMethod: http` sends every publish and read to `POST /audit/v1/internal/media/auth`, which allows publishing on `live/{key}` only for an active key and answers 409 `KEY_REVOKED` for a revoked one. On rotate or revoke the API calls the MediaMTX control API (`/v3/.../kick/{id}`, port 9997, internal only) inside a 1.5 s budget. `runOnReady` / `runOnNotReady` hooks drive VOD indexing.
- **Alternatives:** LiveKit (an SFU with its own room and token model; its URLs do not match the contract paths, and it needs Redis plus TURN tuning); SRS (similar features, less convenient HTTP auth hook); nginx-rtmp (no WebRTC).
- **Consequences:** One light container covers every protocol, and authorization stays in our API, so key state has one source of truth. Recordings land on the MediaMTX `recordings` volume and are served by its playback server, not uploaded to MinIO; that gap is recorded in `TRACEABILITY.md`.

## ADR-010: Stream key lifecycle and DAY2 HMAC signing from the environment only
- **Context:** Keys must be generated, rotated and revoked with exact status codes, honour `stream_key_override`, match `^sk_live_[a-f0-9]{16}$`, and every Phase II record is signed with `DAY2_SALT` (5.3, 5.4). Hard-coding the salt voids the module (7.3).
- **Decision:** `domain/day2/streaming.js` holds the pure plan (`planKeyAction`): generate and rotate invalidate the prior active key, revoke marks the current key revoked and nulls the endpoints. Keys come from `crypto.randomBytes(8)` hex. `lib/signing.js` exposes `signDay2(entityId, payload)` = HMAC-SHA256 over `entity_id + "|" + canonical(payload)`, reusing the Day 1 canonical JSON. The salt is read verbatim from `process.env.DAY2_SALT` (never trimmed, never decoded) and is forwarded by `docker-compose.yml` as `${DAY2_SALT}`. Co-stream invite tokens use the same signer.
- **Alternatives:** JWT stream keys (longer than the regex allows); a separate signing helper per endpoint (risk of drift from the recipe).
- **Consequences:** One signing path, verified against Appendix A vector 1 in unit tests. The repository holds only dummy values (`.env.example`, CI fallbacks); real salts live in the local `.env` or repository secrets.

## ADR-011: Deterministic co-stream handoff, WebSocket presence and on-demand FFmpeg composite
- **Context:** A host drop must promote the next participant in array order within 1.5 s, or terminate with zero participants, keep `composite_playback_url` and `chat_room_id`, and leave no zombie processes (FR-3.3, 5.5, edge case 1).
- **Decision:** Handoff is a pure function (`resolveSession`, `applyDisconnect` in `domain/day2/costream.js`): remove the host, `active_host = remaining[0]`. Session writes are serialized with a per-session advisory lock and replays of an identical request return the stored body with 200. Live presence is the participant's authenticated socket on `/ws/costream/{id}`; its close event runs the same handoff immediately. The composite is not a long-lived process we manage: MediaMTX starts FFmpeg on demand for `costream/{id}` with arguments from `GET /audit/v1/internal/media/composite` (built by `compositeArgs`), restarts it when membership changes, and stops it 10 s after the last viewer leaves.
- **Alternatives:** An SFU (LiveKit) mixing in the browser (heavier, and the contract wants one composite HLS URL); a Node-managed FFmpeg pool (we would own process cleanup and crash recovery).
- **Consequences:** The audit probe and real disconnects share one state machine, so behaviour is identical in tests and on stage. Process lifetime is owned by the media server, which removes the zombie-process risk. Chat ids are derived from the session id, so they never reset on handoff.

## ADR-012: Dynamic QR with stable short URLs, live target routes and privacy-safe telemetry
- **Context:** A printed poster (`/q/m1-live`) must keep working while its target follows the match state; QR codes export as SVG, PNG and PDF; scan analytics must hold no IP, User-Agent or fingerprints (FR-4.1, 5.6, NFR-9, edge case 2).
- **Decision:** `qr_codes` maps `entity_id` to a fixed `short_code`. `target_route` is computed at every read from the current effective match status (event log plus FR-1.3 overrides), never stored, and the signature is computed over that fresh route. `GET /q/{code}` answers 302 with `Cache-Control: no-store`. A 2 s read cache serves `?inspect=true` under load and is invalidated on every match, status or scan change. Each scan stores only the entity id, a `mobile` / `desktop` family and a UTC hour bucket. Exports are generated server-side (PDF with pdfkit).
- **Alternatives:** Encoding the target route in the QR (posters go stale); storing raw User-Agent and IP for analytics (violates NFR-9).
- **Consequences:** Posters never need reprinting, the signature always matches the current state, and erasure requests have no scan PII to find.

## ADR-013: Global server-side guest write guard and an idempotent atomic cart merge
- **Context:** Any guest write must fail with 403 `GUEST_WRITE_FORBIDDEN` on the server (UI hiding earns nothing), and a merge replayed after a network switch must not double-add items (FR-4.3, FR-4.4, 5.7, edge case 4).
- **Decision:** `lib/guest.js` mounts `guestWriteGuard` before every router: any non-GET request with `Bearer guest_*` is rejected, except the explicit guest cart staging routes under `/api/v1/guest/*`. The merge probe pushes a simulated write through this same guard to report `write_rejection_code: 403`. The merge runs in one transaction with advisory locks on the guest token and the member cart plus `SELECT ... FOR UPDATE`. A hash of `(guest_token, registered_user_id, guest_cart)` is stored in `cart_merges`: the same request returns the stored body with 200, a different one returns 409 `GUEST_TOKEN_ALREADY_MERGED`. Quantities are summed per variant and checked against stock; the cart reserves no inventory.
- **Alternatives:** Per-route guest checks (one missed route is a security hole); last-write-wins merges (double counting on retry).
- **Consequences:** New write endpoints are protected by default. The merge reuses the Day 1 idempotency pattern (ADR-005), so retries are safe without client cooperation.

## ADR-014: Moderation engine with normalization, flood rules, deduplication and a DLQ
- **Context:** Chat must be filtered before broadcast (leetspeak, flooding, rate limits); 10 concurrent identical moderation calls must not deadlock or duplicate kicks; failed notifications need bounded retry and a persistent DLQ (FR-5.2, FR-5.3, 5.8, edge case 3).
- **Decision:** `domain/day2/moderation.js` is pure and deterministic: normalize each token (`@`→a, `0`→o, `1`/`!`→i, `3`→e, `$`→s, strip `_ . - *` and zero-width characters), match against the dictionary and mask hits with `***`; flood (4 identical characters or 3 `!`/`?`) and more than 3 messages per sender in 2 s drop the message and mute the sender. Precedence is flood, then rate limit, then profanity. The service writes each room's batch as one statement sequence under a per-room advisory lock, with `moderation_actions PRIMARY KEY (room_id, user_id, action)` and chat `PRIMARY KEY (room_id, seq)`. `services/day2/notify.js` retries a delivery at most 3 times with exponential backoff, then inserts into `dlq_events`.
- **Alternatives:** A third-party profanity service (network dependency, no leetspeak control); an external broker for the DLQ (extra container for a small queue).
- **Consequences:** Results are reproducible for the grader and fully unit tested; concurrency is resolved by the database, so races cannot produce duplicates or 500s. The DLQ survives restarts and is cleared only by `/audit/v1/reset`.

## ADR-015: Guest web player as a lightweight server-served page with WebSocket and SSE
- **Context:** The guest player must load instantly from a QR scan with no install or login, pass Selenium on Chrome and Firefox, update the score within 500 ms and meet WCAG 2.1 AA (1.1, FR-4.2, 6.2.2, NFR-1, NFR-8).
- **Decision:** One static page (`backend/web/index.html`, `assets/player.js`, `assets/player.css`, vendored `hls.min.js`) served by the API on port 8080 for every `/web/*` route; the script reads the route and calls `/api/v1/guest/*`. Live scores use both a WebSocket (`/ws/matches/{id}`) and SSE (`/api/v1/matches/{id}/stream`), and the page renders whichever newer version arrives first. All required `data-testid` attributes are fixed in the markup.
- **Alternatives:** Expo web build of the mobile app (large bundle, slower first paint, harder to keep the exact DOM contract); a separate frontend container (extra port and build step).
- **Consequences:** Zero build step and a small payload; the same origin as the API removes CORS issues. Two transports give resilience on venue networks, at the cost of a little duplicate traffic.

## ADR-016: QA harness with Selenium Grid in compose, Appium, k6 and GitHub Actions
- **Context:** The grader queries a live Grid on 4444 with at least 3 nodes, Appium on 4723, runs k6 at 550 VUs, and expects reports in `tests/reports/` and a workflow on every push to main (1.3, 6.1 to 6.4, 7.3).
- **Decision:** `docker-compose.yml` adds `selenium-hub` and three nodes (`node-chrome-1`, `node-chrome-2`, `node-firefox`) with `shm_size: "1gb"` and VNC disabled. Browsers reach the API through the `backend` network alias. Appium 2 (uiautomator2) runs on the host next to the USB device, because a container cannot reach the phone reliably. k6 runs in the `grafana/k6` container on the host network (`scripts/qa/run_k6.sh`). `scripts/qa/run_all.sh` runs the suites and writes `selenium-report.xml`, `appium-report.xml` and `k6-summary.json`. `.github/workflows/autograde.yml` checks the Day 1 ancestry, brings the stack up, runs jest and contract tests as blocking steps, then the QA suites, and uploads the reports.
- **Alternatives:** Selenium standalone (no multi-node parallelism); a hosted grid (not allowed, and the runner has no external access to our stack).
- **Consequences:** One command reproduces the grader's environment locally. Without a device, Appium writes a skipped report instead of failing the pipeline.

## ADR-017: FR-1.3 match status overrides added after Day 1 feedback
- **Context:** On Day 1 the contract derived only upcoming, in progress and completed from the event log, and judges asked to postpone and cancel matches in the UI. Phase II QR routing also needs postponed, cancelled and abandoned states (`/notice?state=`).
- **Decision:** Postponed, abandoned and cancelled (plus reschedule) are administrative overrides stored in a separate `match_status` table beside the append-only log. `domain/matchStatus.js` defines the allowed transitions and `effectiveStatus`; frozen states reject new events. Changes are exposed through `/api/v1/matches/:id/status` and broadcast in real time; QR resolution reads the effective status.
- **Alternatives:** Encoding states as special events in `match_events` (changes graded `/audit/v1` score outputs and signatures).
- **Consequences:** Day 1 graded responses are unchanged, the UI covers every FR-1.3 state, and QR targets follow administrative changes. Bracket re-evaluation and reschedule conflict detection remain out of scope.

## ADR-018: Literal reading of Phase II spec ambiguities
- **Context:** A cross-audit of both specs found three places where the text allows more than one reading: co-stream validation order (5.5), the status for an unauthenticated write (FR-4.3 versus Appendix B), and the Selenium image tag (7.1 lists 4.25.0, the pre-event booklet pre-pulled 4.24.0).
- **Decision:** Co-stream checks run in the documented "exact order": schema (400), participant existence (404), then capacity (409 `COSTREAM_SESSION_FULL`). A request carrying a guest token gets 403 `GUEST_WRITE_FORBIDDEN` on every write; a request with no credentials at all keeps the Appendix B 401 `UNAUTHENTICATED`. The Grid uses the 4.24.0 hub and node images that were pre-pulled offline; the Grid 4 API on 4444 is identical between the two tags.
- **Alternatives:** Checking capacity first so 409 is reachable with only four seeded players (contradicts the stated order); returning 403 for anonymous writes (contradicts Appendix B); pulling 4.25.0 over the venue network during the sprint (slow and a startup risk).
- **Consequences:** Responses match the written contract. With the four seeded players, five unique real participants are not possible, so a five-entry request that includes an unknown id returns 404 before capacity is checked.

## ADR-019: Multi-process API and a larger listen backlog for NFR-2
- **Context:** The k6 profile (500 guest viewers plus 50 chat posters for 15 s, p95 under 800 ms, 0% failures) produced a 13 to 17 s tail on one Node process. Profiling showed the cause was the TCP accept queue: Node's default backlog of 511 overflowed when 550 clients connected at once, and dropped SYNs were retried after 1, 3, 7 and 15 s.
- **Decision:** `backend/src/server.js` listens with a backlog of 4096 (`LISTEN_BACKLOG`) and runs `WEB_CONCURRENCY` workers (default 4 in compose) under Node cluster. The primary migrates and seeds once, then forks. Cross-worker state lives in Redis: hub events over pub/sub (`nascon:hub`), the chat and API rate windows as sorted sets updated by one Lua script, the QR inspect cache generation (`qr:gen`), WebSocket connection gauges, co-stream presence and the live-since record used for VOD indexing.
- **Alternatives:** Horizontal containers behind a proxy (extra service and port); more caching only (did not address the accept queue).
- **Consequences:** On the final stack k6 measured p95 730 ms with 0% failures over 14035 requests, and the 25-client WebSocket probe measured p95 44 ms. If Redis is down, every worker still serves requests, with per-worker rate windows and uncached QR reads. `WEB_CONCURRENCY=1` restores the single-process behaviour.
