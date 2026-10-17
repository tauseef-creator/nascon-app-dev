# Mobile App <-> Backend Contract

Base URL is configurable in the app's Settings screen. Defaults:
emulator `http://10.0.2.2:8080`, phone over USB `http://localhost:8080` after
`adb reverse tcp:8080 tcp:8080`, phone over hotspot `http://<laptop-LAN-IP>:8080`.

All bodies are JSON. Errors always look like
`{"error":{"code":"OUT_OF_STOCK","message":"...","details":{}}}`. **Never show
`code` or HTTP numbers to the user**; map codes to plain language (table at the end).

Auth: send `Authorization: Bearer <token>` on `/api/v1/*` calls after login.
Store the token with `expo-secure-store` (Android Keystore).

## Auth and profile

| Method | Path | Body / notes | Response |
|---|---|---|---|
| POST | `/api/v1/auth/login` | `{email, password}` | `{token, user:{user_id,email,role,tenant_id,league_id,club_id,player_id,display_name}, tenant:{tenant_id,name,primary_color,secondary_color,logo_url}}` |
| GET | `/api/v1/me` | | same `user` + `tenant` |

Roles: `super_admin`, `league_organizer`, `club_manager`, `player`, `viewer`.
Show screens by role: Scoring entry only for `league_organizer` (and super admin),
Roster management only for `club_manager`.

## Leagues, fixtures, matches

| Method | Path | Response |
|---|---|---|
| GET | `/api/v1/leagues` | `[{league_id, name, sport_id, tenant_id}]` |
| GET | `/api/v1/matches?league_id=...` | `[{match_id, league_id, sport_id, home_team_id, away_team_id, home_name, away_name, scheduled_at, venue, status, home_score, away_score}]` |
| GET | `/audit/v1/score/{match_id}` | live score projection: `status, outcome, home{team_id,score,...}, away{...}, events[]` (timeline) |
| GET | `/audit/v1/standings/{league_id}` | `table[{rank, team_id, played, won, drawn, lost, scored, conceded, diff, points, status}]`; `status` is `clinched` / `eliminated` / `still_possible` |
| GET | `/realtime/matches/{match_id}` | Server-Sent Events stream. Events: `score` (new projection), `status`, `pinned_product`. Reconnect on drop. |

## Scoring entry (League Organizer)

`POST /audit/v1/events` with
`{event_id:<uuid>, match_id, type:"score", payload:{team_id, event_type}}`.
`event_type` values come from the sport config (`GET /api/v1/sports/{sport_id}` returns
`config.scoring_events` keys). Compensation (undo):
`{event_id:<uuid>, match_id, type:"compensation", payload:{compensates:<event_id>, reason}}`.
Other types: `match_start`, `match_end` with `payload:{}`.

## Clubs and roster (Club Manager)

| Method | Path | Response |
|---|---|---|
| GET | `/api/v1/clubs` | `[{club_id, name, tenant_id}]` |
| GET | `/api/v1/clubs/{club_id}` | `{club_id, name, tenant_id, home_venue{name,lat,lng}, social{}, staff{coach,manager,physio}, roster[{player_id,name,position,role}]}` |
| POST | `/audit/v1/roster/transfer` | body of spec 5.11: `{request_id, league_id, player_id, type:"transfer"|"loan"|"release", from_squad_id, to_squad_id, effective_date, loan_end_date, reason, requested_by}` |
| GET | `/audit/v1/roster/history/{player_id}` | audit trail |

## Store

| Method | Path | Response |
|---|---|---|
| GET | `/api/v1/products` | `[{product_id, name, category, description, variants:[{variant_id, size, color, price_minor, currency, stock}]}]` |
| GET | `/audit/v1/inventory/{variant_id}` | `{variant_id, stock, reserved}` |
| POST | `/audit/v1/checkout` | `{order_id:<uuid>, customer_id, items:[{variant_id, quantity}], discount_code:null|"WELCOME10", payment:{token:"tok_success"|"tok_declined"|"tok_capture_fail"}}` -> 201 order with `receipt.pdf_base64` (save to file with expo-file-system and open with expo-sharing) |

Money is in paisa: display `price_minor / 100` with two decimals, prefix `PKR`.

## Offline queue (NFR-4, judged on the phone)

While offline, store each action in SQLite in exactly this format and show it as
"pending":

```json
{ "action_id": "<uuid>", "type": "score_event", "queued_at": "2026-10-17T11:00:00Z",
  "base_version": 3, "payload": { ...the /audit/v1/events body... } }
{ "action_id": "<uuid>", "type": "roster_transfer", "queued_at": "...",
  "base_version": 1, "payload": { ...the /audit/v1/roster/transfer body... } }
```

`base_version` = for score events the match `version` from the last `/score`
fetch; for roster actions the number of entries in the player's history.
When back online: `POST /audit/v1/offline-sync` with
`{device_id:<stable id>, actions:[...]}` -> `results[]` with `status`
(`applied` / `rejected` / `duplicate`), `error_code`. Show each result and explain
rejections in plain language, then clear the queue.

## Error code -> user message

| Code | Message |
|---|---|
| UNAUTHENTICATED | "Your session has expired. Please sign in again." |
| FORBIDDEN | "You don't have permission to do that." |
| OUT_OF_STOCK | "Sorry, this item just sold out." |
| PAYMENT_DECLINED | "Your payment was declined. Try another card." |
| PAYMENT_CAPTURE_FAILED | "Payment couldn't be completed. You were not charged." |
| INVALID_DISCOUNT_CODE | "That discount code isn't valid." |
| TRANSFER_WINDOW_CLOSED | "The transfer window is closed for that date." |
| SQUAD_FULL | "The destination squad is already full." |
| MIN_POSITION_VIOLATION | "This move would leave the squad short in that position." |
| PLAYER_ON_LOAN | "This player is currently on loan." |
| NOT_IN_SQUAD | "This player is not in the selected squad." |
| MATCH_NOT_IN_PROGRESS | "Scores can only be added while the match is live." |
| INVALID_COMPENSATION | "That event was already corrected." |
| RATE_LIMITED | "Too many requests. Please wait a moment." |
| (network error) | "You're offline. Your action was saved and will sync automatically." |
| anything else | "Something went wrong. Please try again." |
