# Mobile Build Plan (hand this to the agent building `mobile/`)

Worth 14 of 50 points: 10 UI/HCI (judges, from 15:15) + 4 offline sync. Read
`docs/SPEC_PART1.txt` sections 8.1-8.6 and 5.14, and `docs/MOBILE_API.md`.

## Current state

`mobile/` is a fresh Expo SDK 58 app (react-native 0.88, TypeScript, blank template).
Installed packages: expo-router, expo-dev-client, expo-sqlite, expo-secure-store,
expo-crypto, @react-native-community/netinfo, expo-file-system, expo-sharing,
expo-image, @expo/vector-icons, react-native-safe-area-context, react-native-screens,
react-native-gesture-handler, react-native-reanimated, react-native-worklets,
react-native-svg, @react-native-async-storage/async-storage, expo-build-properties,
expo-haptics, react-native-web, react-dom. **Do not add native packages** (each needs a
rebuild). No screens exist yet. Use Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`).

## Decisions already made by the team lead (do not change)

- **Navigation:** bottom tabs `Fixtures`, `Standings`, `Store`, `Club`, `More`. A sync
  status bar is pinned at the top of every screen (Online / Offline / Syncing +
  pending count; tap opens the Sync queue screen).
- **Visual style "Clean light":** background `#F5F6F8`, white cards with soft
  shadow, tenant brand colors from the login response (`tenant.primary_color`,
  `tenant.secondary_color`; Alpha = `#0B5FFF` / `#FFB800`, Beta = `#0E9F6E` /
  `#1F2937`) for header bar, active tab and primary buttons. Big bold scores.
- **Accessibility:** tap targets >= 48 dp, body text >= 16 sp, strong contrast,
  status always shown with text or icon (never color alone), `accessibilityLabel`
  on icons, `testID` + `accessibilityRole` on every interactive element. No
  overflow at 360x640 dp or after rotation.
- **Demo data:** `/reset` will seed demo matches/standings/roster with ids prefixed
  `demo-` (backend TODO, see AGENTS.md section 8).

## Setup

- `package.json` `"main": "expo-router/entry"`; remove `App.tsx` / `index.ts`.
- `app.json`: name "NaSCon League", slug "nascon-league", scheme "nascon",
  `android.package` "com.nxtmafia.nascon", `android.versionCode` 1,
  `userInterfaceStyle` "light", plugins: `"expo-router"`, `"expo-secure-store"`,
  `"expo-sqlite"`, `["expo-build-properties", {"android": {"usesCleartextTraffic": true, "minSdkVersion": 29}}]`.

## Architecture

- `src/api/client.ts`: base URL in AsyncStorage (default `http://10.0.2.2:8080`;
  Settings screen edits it, "Test connection" calls `GET /health`). Fetch with 8 s
  timeout, Bearer token, parse `{error:{code,message}}` into an `AppError` with a
  plain-language message (table at the end of `docs/MOBILE_API.md`); network
  failure -> code `NETWORK`.
- `src/auth`: AuthContext; `POST /api/v1/auth/login` -> `{token, user, tenant}`;
  token in expo-secure-store (Android Keystore); user + tenant persisted so the app
  opens offline.
- `src/offline/db.ts` (expo-sqlite): `cache(key PK, json, updated_at)`,
  `queue(action_id PK, type, queued_at, base_version, payload, status, error)`,
  `sync_results(action_id, status, error_code, message, at)`, `meta(key, value)`
  with a stable `device_id` (expo-crypto `randomUUID`).
- `src/offline/cache.ts`: `cachedGet(key, path)`: online -> fetch + store; on
  network error -> cached copy (flag `fromCache`). Cache fixtures, standings, club
  profile, products, match score.
- `src/offline/queue.ts` + `SyncProvider`: NetInfo status. Offline (or NETWORK
  failure) scoring and roster actions are queued in **exactly** the spec 5.14
  format: `{action_id: uuid, type: "score_event" | "roster_transfer", queued_at:
  "YYYY-MM-DDTHH:MM:SSZ" (UTC, no millis), base_version: int, payload: <the
  /audit/v1/events body or /audit/v1/roster/transfer body>}`. `base_version`:
  score events = `version` from the last `GET /audit/v1/score/:id`; roster = number
  of entries in `GET /audit/v1/roster/history/:player_id` (0 if 404). Queue survives
  force-close. On reconnect auto-sync with `POST /audit/v1/offline-sync
  {device_id, actions}`; show per-action results (applied / rejected + plain
  reason / duplicate), clear synced items; also a "Sync now" button.
- `src/theme.ts` tokens + components: `Screen` (SafeArea + SyncBar + header),
  `Card`, `PrimaryButton` / `SecondaryButton` (min height 48, loading, disabled),
  `EmptyState`, `ErrorBanner` (plain language + Retry), `LoadingView`,
  `StatusPill` (text + icon: LIVE, FT, UPCOMING, CLINCHED), `ConfirmDialog`.

## Screens (each with loading, empty, error, offline-cached states)

1. **Login:** email/password, show/hide, quick-fill chips for the 5 demo accounts
   (`*@nascon.test`, password `Nascon@26`), link to Settings.
2. **Fixtures tab:** league picker (`GET /api/v1/leagues`), matches from
   `GET /api/v1/matches?league_id=` grouped Live / Upcoming / Results; tap -> Match.
3. **Match detail** `app/match/[id].tsx`: big score header, timeline from
   `GET /audit/v1/score/:id` (compensated events struck through, "Corrected"),
   live updates via SSE `GET /realtime/matches/:id` (XMLHttpRequest streaming;
   fallback: poll every 5 s), pinned product card (`GET /api/v1/matches/:id/pinned`).
   For organizer / super admin: scoring buttons from the sport config
   (`GET /api/v1/sports/:sport_id` -> `config.scoring_events` keys) for home and
   away, Start / End match, Undo (compensation with confirm), Pin product.
   Each action `POST /audit/v1/events {event_id: uuid, match_id, type, payload}`;
   offline -> queue `score_event`, show as pending.
4. **Standings tab:** league picker, `GET /audit/v1/standings/:league_id`, team names
   from `/api/v1/clubs`, qualification as text pill + icon, horizontal scroll,
   legend; 404 -> "Standings are not available for this league yet".
5. **Club tab / profile** `app/club/[id].tsx`: `GET /api/v1/clubs/:id` (venue,
   social, staff, players). Club manager sees "Manage roster".
6. **Roster management** `app/roster.tsx` (club manager): `GET /api/v1/roster/:club_id`;
   Transfer / Loan (end date) / Release (confirm); `POST /audit/v1/roster/transfer
   {request_id: uuid, league_id, player_id, type, from_squad_id, to_squad_id,
   effective_date, loan_end_date, reason, requested_by: user.user_id}`; offline ->
   queue `roster_transfer`.
7. **Store tab:** `GET /api/v1/products`; product detail with size chips, quantity
   stepper; Cart with discount code (WELCOME10) and mock payment picker
   (`tok_success`, `tok_declined`, `tok_capture_fail`); confirm; `POST
   /audit/v1/checkout {order_id: uuid, customer_id: user.user_id, items, discount_code,
   payment:{token}}`; receipt screen with totals and "Open receipt PDF"
   (write `receipt.pdf_base64` with expo-file-system, open with expo-sharing).
8. **More tab:** profile, Sync queue, Settings, Logout (confirm).
9. **Sync queue** `app/sync.tsx`: pending list, last results with explanations, Sync now.

Role visibility: viewer/player read-only; scoring only organizer/super admin;
roster management only club manager/super admin.

## Judge tasks to rehearse

(A) find a league's standings and open one match; (B) buy an item with mock
payment and open the receipt; (C) as Club Manager do a roster action, then repeat
one in airplane mode, force-close, reopen, reconnect, sync.

## Verify and build the release APK

1. `npx tsc --noEmit` clean; `npx expo export --platform android` succeeds.
2. `npx expo prebuild -p android --clean`
3. Append to `android/gradle.properties` **after adding a newline** (the file has no
   trailing newline): `org.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=768m`; set
   `reactNativeArchitectures=arm64-v8a`.
4. `export JAVA_HOME=$HOME/.gradle/jdks/eclipse_adoptium-17-amd64-linux.2 ANDROID_HOME=$HOME/Android/Sdk`
   then `cd android && ./gradlew assembleRelease` (15-25 min; signed with the debug
   keystore, installable).
5. Copy `android/app/build/outputs/apk/release/app-release.apk` to
   `mobile/release/app-release.apk`, commit it. Install on the phone:
   `adb install -r mobile/release/app-release.apk`, then `adb reverse tcp:8080 tcp:8080`
   and set the server to `http://localhost:8080` in Settings.
