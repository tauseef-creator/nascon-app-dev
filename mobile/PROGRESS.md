# Mobile progress log

## 2026-10-17 14:10 PKT update

- Apple Sports reference is the full Mobbin gallery screenshot supplied by the user. Commit `0882164` pushed the first dark UI pass. Its match cards are still too large and too blue compared with the reference; a tighter green-accented fixture layout is the next visual change.
- New release APK built successfully at 14:04 PKT and installed on Galaxy A06 (`R8VY500M3DM`). `mobile/release/app-release.apk` is 42,102,723 bytes, SHA-256 `8a2ae2f3eb0c0936cc4fa5386be3137e363680c39086873021e1425c65bec798`; `apksigner verify` passed (v2), minSdk 29, arm64-v8a. The phone launched the release app and rendered the dark Fixtures screen with live backend data through `adb reverse tcp:8080 tcp:8080`.
- The debug APK was also built and installed for a Metro preview. Metro on port 8082 has been unusually slow on Windows; the standalone release APK is the reliable review build. The generated `mobile/android/` directory and Windows-only Gradle workaround remain ignored; Fedora source compatibility is unchanged.

## 2026-10-17 Windows handoff (updated 13:52 PKT; update this checkpoint as work completes)

- Synced `main` from GitHub, ran `npm install` in `mobile` (lockfile unchanged), and passed `npx tsc --noEmit` after the changes below. Native `mobile/android/` was generated with `npx expo prebuild -p android --no-install`; it is ignored by Git, so Fedora must generate its own native directory when building. Do not commit `mobile/android/`.
- Docker Compose is up on this Windows laptop: API on port 8080, Postgres, Redis, MinIO, worker. `/health`, organizer login, leagues, fixtures, standings, clubs, store products, and manager roster returned data. A local ignored `.env` contains a *test* `DAY1_SALT`; replace it with the assigned salt before signature grading. Never commit the assigned salt. `requirements.pdf` is an untracked attachment at repo root; leave it untouched and do not stage it.
- Commit `09d1d1e` (`Mobile: save paid receipt before opening it`) is pushed to `origin/main`. It waits for the local receipt cache write before opening the receipt, avoiding a navigation race. It also handles a cache-read failure on the receipt screen.
- Windows release build succeeded in 13m29s after a local-only Windows Ninja path workaround in generated `mobile/android/app/build.gradle`: `buildStagingDirectory "E:/c"` and `-DCMAKE_OBJECT_PATH_MAX=200`. This generated file is ignored and must not be committed or copied to Fedora. The release APK is `mobile/release/app-release.apk` (41,772,371 bytes, arm64-v8a; SHA-256 `4bfaf986ee4ea23dedec724d42955aca5a5671008b44a1fbaf5674ab6c93caa2`). `apksigner verify` passed with APK Signature Scheme v2; `aapt dump badging` confirms package `com.nxtmafia.nascon`, minSdk 29, targetSdk 36. The APK is ready to install; it has not yet been run on a phone.
- The APK was installed and launched on a Pixel 6a over ADB. Server settings were changed from the emulator default to `http://localhost:8080`; Test connection succeeded through `adb reverse tcp:8080 tcp:8080`. Organizer sign-in succeeded; Fixtures showed the live 1–0 match and upcoming list, and Standings rendered the four-team table and legend. Pixel USB then repeatedly disconnected (ADB transport IDs changed), losing the reverse mapping; Match detail showed Server unreachable as a result. For reliable testing, set Server URL to this laptop's current Wi-Fi IP (at 13:30 PKT `http://10.213.195.190:8080`; verify current IP before using). A Galaxy A06 is now visible as MTP but not ADB; the user is enabling USB debugging. Once stable, rehearse match, store/receipt, roster, airplane-mode queue/reopen/sync, and 360x640/landscape. No emulator is installed here.
- Backend correction `077e488` is pushed: club profiles now read current registrations when a club has a configured roster, instead of showing stale seed players. After `docker compose up -d --build api`, the manager's profile and roster each returned 6 players; an unconfigured club still showed its seed player, and foreign-tenant access still returned 403. All previously called mobile API paths have handlers. Commit `7af8171` is pushed: the mobile add-player flow and `POST /api/v1/roster/:club_id/players` backend route implement the PDF's missing add action. `npx tsc --noEmit`, `node --check`, and `npx expo export --platform android` pass. Live endpoint checks: unauthenticated 401, viewer 403, invalid body 400, other club 403, add 201, duplicate 409; roster and club profile both showed the added player. The temporary test player and its audit record were deleted, restoring roster count to 6. Add requires a connection because spec 5.14 has no offline add action type. Do not use `/audit/v1/roster/setup` for a single add: it replaces the whole league roster.
- Ran `./run_tests.sh` through Git Bash after the backend edit: 13 suites, 522 tests pass; line coverage 98.99%; `COVERAGE.json` stayed unchanged at 100% for each scored backend area. The grader-style live contract suite against Docker also passed: 27 tests in 75.90 s (`python -m pytest tests/contract -q`). Tests reset/reseed the stack, so any manual demo edits made before the suite were cleared.
- After pushing APK commit `7af9581`, cloned `origin/main` into a separate directory, built the full Compose stack on port 8081 (isolated from the live port-8080 stack), and received HTTP 200 from `/health`. The APK hash in the fresh clone matched the local one. The isolated containers and volumes were stopped and removed; the live stack remains healthy on port 8080.
- Mobbin MCP is available. Reviewed Sofascore fixture/league screens; existing clean-light, five-tab layout already follows the useful score/status/league hierarchy. The Pixel 6a screenshots confirm the login, Fixtures, and Standings render cleanly. Match detail, receipt PDF viewer, SSE stream, and offline action queue are still unverified on device.
- Fedora compatibility: the committed mobile source is TypeScript/Expo and the lockfile is unchanged. On Fedora, `cd mobile && npm ci`, then use `npx expo run:android` for a development build or install the committed release APK. Set the backend URL in app Settings to Fedora's LAN IP on port 8080, or use `adb reverse tcp:8080 tcp:8080` and `http://localhost:8080` when tethered. Keep Android SDK/native build files local to each machine.
- UI direction changed on user request to [Apple Sports on Mobbin](https://mobbin.com/apps/apple-sports-ios-d243ea62-51b4-4aa5-be37-08bbdb4236b5/c3881ed5-2045-4c23-8f59-0eeb94946c89/screens): dark surfaces, compact score cards, muted sync strip, restrained tenant accents, and a real stadium photo on match detail (`assets/stadium.jpg`, [Unsplash image source](https://images.unsplash.com/photo-1522778119026-d647f0596c20)). TypeScript passes. **The APK committed at `7af9581` predates this UI change and must be rebuilt before evaluation.** Metro is running on port 8082 and a debug build is in progress for live preview on Galaxy A06.

- 12:08 Phase 1 done: app.json/package.json per plan, android/ prebuilt (gradle.properties patched), src/theme.ts, src/api (client, errors, types), src/auth/AuthContext, src/offline (db, cache, queue, SyncProvider, netState), shared components (Screen, SyncBar, ui, ConfirmDialog, Toast), Cart/League contexts, app/_layout (providers + auth gate), login, settings, tabs layout. tsc clean.
- 12:17 Phase 2 done: Fixtures tab (league picker, Live/Upcoming/Results), match/[id] (score header, timeline with corrections, SSE + 5 s polling fallback, pinned product, organizer scoring panel with start/end/undo/pin, offline queueing), Standings tab (table, legend, 404 empty state), Club tab + club/[id]. tsc clean.
- 12:24 Phase 3 done: Store tab, product/[id] (size chips, stepper, buy now / add), cart (discount code, mock payment picker, confirm, checkout), receipt/[id] (totals, Open receipt PDF via expo-file-system File + expo-sharing), roster (transfer/loan/release form + confirm, offline queue), More tab (profile, links, logout confirm), sync screen (pending list with JSON details, discard, results, Sync now).
- 12:26 Phase 4 done: `npx tsc --noEmit` clean, `npx expo export --platform android` succeeds, README.md written. Phase 5 (release APK) SKIPPED on coordinator request; no gradle build was completed (a warm-up build was stopped).

## What is done

All screens of plan section "Screens" 1-9 exist and type-check. Offline action format was
verified against the live backend (`POST /audit/v1/offline-sync` accepted both action types
and returned per-action results).

## What is next (for the next agent)

1. Continue on a device with a stable network address and rehearse judge tasks A, B, C from
   the plan; fix any runtime issues. Pixel 6a login, Fixtures, and Standings passed; USB
   instability interrupted match detail and the remaining flows.
2. Check at 360x640 and in landscape: score header, standings table (horizontal scroll),
   scoring grid (two columns), roster action buttons.
3. Install the committed release APK on the attached phone as soon as Windows detects it, and verify server settings point to the running Docker backend.

## Known gaps / risks

- Not yet verified on a device: SSE streaming via XMLHttpRequest on Android is untested (polling
  fallback kicks in after 6 s if no event arrives).
- Roster add is implemented through the separate authenticated `/api/v1/roster/:club_id/players` route and requires a connection; transfer / loan / release support the spec's offline queue.
- Discount code is not pre-validated; it is checked by the server at payment and an invalid
  code shows a plain-language error.
- Order history is only the last receipt (More > Last receipt) and receipts cached in SQLite.
- `isConnected` from NetInfo drives Online/Offline; a reachable network with the backend down
  shows "Server unreachable" after the first failed request.
- No dedicated tests (Appium/Selenium) yet; every interactive element has a testID.
