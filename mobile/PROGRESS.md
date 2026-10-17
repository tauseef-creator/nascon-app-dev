# Mobile progress log

## 2026-10-17 Windows handoff (12:49 PKT; update this checkpoint as work completes)

- Synced `main` from GitHub, ran `npm install` in `mobile` (lockfile unchanged), and passed `npx tsc --noEmit` after the changes below. Native `mobile/android/` was generated with `npx expo prebuild -p android --no-install`; it is ignored by Git, so Fedora must generate its own native directory when building. Do not commit `mobile/android/`.
- Docker Compose is up on this Windows laptop: API on port 8080, Postgres, Redis, MinIO, worker. `/health`, organizer login, leagues, fixtures, standings, clubs, store products, and manager roster returned data. A local ignored `.env` contains a *test* `DAY1_SALT`; replace it with the assigned salt before signature grading. Never commit the assigned salt. `requirements.pdf` is an untracked attachment at repo root; leave it untouched and do not stage it.
- Commit `09d1d1e` (`Mobile: save paid receipt before opening it`) is pushed to `origin/main`. It waits for the local receipt cache write before opening the receipt, avoiding a navigation race. It also handles a cache-read failure on the receipt screen.
- The release build is running on Windows from `E:\n\mobile\android` with `gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=2`. It has reached native CMake configuration but has **not** finished yet. When it succeeds, copy `android/app/build/outputs/apk/release/app-release.apk` to `mobile/release/app-release.apk`, check the APK and commit/push it. Avoid starting a second Gradle build concurrently.
- Windows currently sees **no Android USB/MTP/ADB device** (`adb devices -l` is empty). The user has been asked to reconnect the phone, select File Transfer, enable USB debugging, and accept the prompt. Once visible, run `adb install -r mobile/release/app-release.apk`, `adb reverse tcp:8080 tcp:8080`, set the app server address to `http://localhost:8080`, and rehearse judge tasks A/B/C including airplane-mode sync. An emulator is not installed here.
- Backend correction `077e488` is pushed: club profiles now read current registrations when a club has a configured roster, instead of showing stale seed players. After `docker compose up -d --build api`, the manager's profile and roster each returned 6 players; an unconfigured club still showed its seed player, and foreign-tenant access still returned 403. All mobile API calls checked have route handlers; the original PDF also asks for an “add player” roster action, but no safe add endpoint exists yet (transfer/loan/release are implemented). Do not use `/audit/v1/roster/setup` for a single add: it replaces the whole league roster.
- Mobbin MCP is available. Reviewed Sofascore fixture/league screens; existing clean-light, five-tab layout already follows the useful score/status/league hierarchy. Preserve this design system and test it on a small phone before changing it. The phone runtime, receipt PDF viewer, SSE stream, and offline action queue are still unverified on device.
- Fedora compatibility: the committed mobile source is TypeScript/Expo and the lockfile is unchanged. On Fedora, `cd mobile && npm ci`, then use `npx expo run:android` for a development build or install the committed release APK. Set the backend URL in app Settings to Fedora's LAN IP on port 8080, or use `adb reverse tcp:8080 tcp:8080` and `http://localhost:8080` when tethered. Keep Android SDK/native build files local to each machine.

- 12:08 Phase 1 done: app.json/package.json per plan, android/ prebuilt (gradle.properties patched), src/theme.ts, src/api (client, errors, types), src/auth/AuthContext, src/offline (db, cache, queue, SyncProvider, netState), shared components (Screen, SyncBar, ui, ConfirmDialog, Toast), Cart/League contexts, app/_layout (providers + auth gate), login, settings, tabs layout. tsc clean.
- 12:17 Phase 2 done: Fixtures tab (league picker, Live/Upcoming/Results), match/[id] (score header, timeline with corrections, SSE + 5 s polling fallback, pinned product, organizer scoring panel with start/end/undo/pin, offline queueing), Standings tab (table, legend, 404 empty state), Club tab + club/[id]. tsc clean.
- 12:24 Phase 3 done: Store tab, product/[id] (size chips, stepper, buy now / add), cart (discount code, mock payment picker, confirm, checkout), receipt/[id] (totals, Open receipt PDF via expo-file-system File + expo-sharing), roster (transfer/loan/release form + confirm, offline queue), More tab (profile, links, logout confirm), sync screen (pending list with JSON details, discard, results, Sync now).
- 12:26 Phase 4 done: `npx tsc --noEmit` clean, `npx expo export --platform android` succeeds, README.md written. Phase 5 (release APK) SKIPPED on coordinator request; no gradle build was completed (a warm-up build was stopped).

## What is done

All screens of plan section "Screens" 1-9 exist and type-check. Offline action format was
verified against the live backend (`POST /audit/v1/offline-sync` accepted both action types
and returned per-action results).

## What is next (for the next agent)

1. Run on a device or emulator (`npx expo run:android` or a release build per README) and
   rehearse judge tasks A, B, C from the plan; fix any runtime issues (nothing has been run
   on a device yet, only tsc + export).
2. Check at 360x640 and in landscape: score header, standings table (horizontal scroll),
   scoring grid (two columns), roster action buttons.
3. Build the release APK (README "Build the release APK"), copy to `mobile/release/app-release.apk`.

## Known gaps / risks

- Not yet run on a device: SSE streaming via XMLHttpRequest on Android is untested (polling
  fallback kicks in after 6 s if no event arrives).
- Roster "add player" is not implemented (the backend has no add endpoint besides
  `/audit/v1/roster/setup`, which replaces league state). Transfer / loan / release work.
- Discount code is not pre-validated; it is checked by the server at payment and an invalid
  code shows a plain-language error.
- Order history is only the last receipt (More > Last receipt) and receipts cached in SQLite.
- `isConnected` from NetInfo drives Online/Offline; a reachable network with the backend down
  shows "Server unreachable" after the first failed request.
- No dedicated tests (Appium/Selenium) yet; every interactive element has a testID.
