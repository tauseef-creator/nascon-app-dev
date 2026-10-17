# Architecture Decision Records

## ADR-001: Modular monolith with pure domain modules
- **Context:** One 4-hour sprint, six independently graded backend areas, 85% coverage bonus per area.
- **Decision:** One Node.js/Express API. Domain logic (fixtures, scoring, standings, roster, store, RBAC) lives in pure functions under `backend/src/domain/`; routes only parse, load and persist.
- **Alternatives:** Microservices per area (too much ops overhead); logic inside route handlers (hard to unit test).
- **Consequences:** Fast unit tests and high coverage; a single deployable plus one worker.
