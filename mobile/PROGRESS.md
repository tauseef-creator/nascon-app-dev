# Mobile progress log

## 2026-10-17 15:27 PKT release on Pixel 6a

- Rebuilt `mobile/release/app-release.apk` successfully (`assembleRelease`, arm64-v8a; SHA-256 `071a2a4119f2f50e08bb97bdac7c36992c2d482077df1e3e95cc92ec0a404f0a`) and installed it on Pixel 6a `19301FDEE003AS`. The new Fixtures hero, counts, and quick actions render on-device.
- Rebuilt the live `n-api-1` container from the latest source and confirmed it is healthy. The local ignored `.env` now has the assigned salt; never copy it into Git. The demo database contains 12 fixtures and four products. The Pixel Store shows all four products with the newly bundled jersey, scarf, and bottle photos. Product image display on the phone is confirmed.
- USB reconnects can remove `adb reverse tcp:8080 tcp:8080`; it was restored. The phone still uses `http://localhost:8080`. If the USB cable disconnects, reconnect and repeat that ADB reverse command, or switch Server settings to this laptop's reachable hotspot address (`http://10.213.195.190:8080` as of this checkpoint).
- After the demo seed/API rebuild, `run_tests.sh --runInBand` passed all 522 tests across 13 suites. Overall line coverage is 98.99%; `COVERAGE.json` remains 100% in the six scored backend areas. No live contract reset was run against the active phone database.

## 2026-10-17 15:20 PKT home screen

- The Fixtures home now features the current live match, next fixture, or latest result over the bundled stadium photo, followed by live/upcoming/results counts and role-aware quick actions. All values come from the existing matches response, so the view works with offline cache and requires no new endpoint. The existing tabbed fixture list and test IDs remain.
- `npx tsc --noEmit` and `npx expo export --platform android` pass. A release APK still needs rebuilding for the new home and product photos; the currently installed phone build predates both.

## 2026-10-17 15:18 PKT demo data and merchandise imagery

- Commit `3b15d63` added separate demo-only fixtures, completed results, realistic club details, and three merchandise products in `backend/src/db/demoSeed.js`. The binding baseline in `seedData.js` and audit reset are unchanged. The live Docker stack has not yet been rebuilt for these additions, so its current database still has the older catalog.
- Store and product detail now use bundled product photos. The previous vector shirt artwork was removed from store, detail, and receipt. Four AI-generated product photos cover the two jerseys, scarf, and bottle; the fallback photo remains for any other product. `npx tsc --noEmit` passes. These photos are local assets and work offline.
- Rebuild the release APK before expecting the new photos on a device. `mobile/android/` is generated and ignored; on Fedora, run `npm ci` and generate native files locally. Deploying the demo seed requires rebuilding/restarting the API, which resets local demo state at startup; avoid interrupting an active judge session.

## 2026-10-17 15:04 PKT device and requirements audit

- Reinstalled the latest committed release APK on Galaxy A06; the existing `n-*` Docker stack is healthy on port 8080 and `adb reverse tcp:8080 tcp:8080` is active. A second Compose project started through the Windows repo symlink collided on port 8080; only those duplicate `nascon-app-dev-*` containers were stopped. Leave the healthy `n-*` stack running for judging.
- Completed purchase on the phone while signed in as Player: Store -> Alpha United Home Jersey (size L, quantity 1) -> Buy now -> approved mock card -> Pay now. Receipt showed successful PKR 4,500 payment. `Open receipt PDF` generated a PDF and opened Android's share sheet. `npx tsc --noEmit` passes.
- The five bottom tabs are shared by design (`docs/MOBILE_BUILD_PLAN.md`), so accounts look similar. The role badge changes; Organizer scoring controls appear inside Match detail; Manager's Manage roster link appears in More; Player/Viewer cannot use scoring/roster controls. This satisfies most role visibility, but the spec also calls for a role-aware home; the role-specific entry points are not prominent on the shared Fixtures home.
- Small-screen finding on Galaxy A06 (360 dp): the item-line amount on Receipt wraps awkwardly because `Row` gives its long label nonshrinking width; the final purchase/receipt buttons sit close to Android's system navigation area. The buttons remained tappable in this test. If there is time for another APK rebuild, address receipt row wrapping and bottom scroll padding.
- Code finding: `canPin()` includes Club Manager and backend `POST /api/v1/matches/:match_id/pin` permits that role, but the Pin button is nested inside the Organizer-only scoring panel in `app/match/[id].tsx`, so managers cannot reach it from the app. Scoring, roster mutation, offline queue survival/sync, and landscape were not re-tested in this short audit. Do not claim those device flows passed based on this note.

## 2026-10-17 14:38 PKT: Apple Sports redesign, final APK

- Fixtures shows one rounded panel with a Results / Live / Upcoming switcher and a league header, and match rows separated by thin dividers. Match detail has a gradient hero in the two teams' crest colours. Standings is a compact table with a crest per row. Clubs get generated SVG crests (`src/components/ClubCrest.tsx`, no network needed).
- Blue removed from the UI, along with the left-border card accents and the bolt icon on Buy now. Qualification places are now shown by a green rank number.
- Release APK `mobile/release/app-release.apk` (42256151 bytes, SHA-256 `310878ca458111c72bb5b736e8e9ac66ad5f2cf0ee079b844953e07c62a3a143`; 14:43 build adds smaller type and the pitch app mark in `src/components/AppMark.tsx`), arm64-v8a only. Build with `./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a` from `E:\n\mobile\android`; on this Windows machine the build for all ABIs fails on armeabi-v7a.
- Installed on Galaxy A06. Fixtures, Match detail, Standings, Clubs and Product screens render on the device. The scoring panel was not re-checked after the redesign; the phone was signed in to a session that did not show it. Its logic is unchanged.

- Second pass, built from the Mobbin Apple Sports screens. Pure-black background with a green gradient wash at the top. Large 34pt left-aligned titles. Sync status is a rounded strip. Cards are rounded and borderless (`#1C1C1E`). Primary buttons are green pills; selected chips are white segments. The tab bar is near-black with a green active tint.
- Match cards are compact rows: tenant-coloured crests, scores beside the crests (the trailing team's score is dimmed), and kickoff time, "Final" or a red LIVE dot in the centre. Live cards have a red tint. Match detail scores are white at 64pt.
- Fixed contrast bugs: the standings "(you)" row was near-white behind white text. Error, info and success banners used dark text on dark backgrounds. Form inputs now sit on a raised `#2C2C2E` surface so they show up inside cards.
- Changes are limited to styling. No logic, testID or accessibility label was changed or removed (checked with git diff). `npx tsc --noEmit` and `npx expo export --platform android` pass.

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

- 14:51 build: new tab icons, a role label in the main headers, and an Unsplash football banner on Store (`assets/merch.jpg`). APK 42379135 bytes, SHA-256 `86ecd8493f56032b9c2e135a59864c7f9336f9757d146f3598fefe9bfea20329`. Only one product is seeded, so the store shows one item.
- 14:57 build: Inter font (`@expo-google-fonts/inter`, loaded in `app/_layout.tsx`; style weights are mapped to the `Inter_600SemiBold` / `Inter_700Bold` / `Inter_800ExtraBold` families), a ball app mark, and drawn kit artwork for apparel (`src/components/JerseyArt.tsx`). APK 45426879 bytes, SHA-256 `5fb09a3a10f0b6456271bb00f1df7eeb765bb5911a6f78e65cff063e274f60ce`. Run `npm ci` after pulling, because a dependency was added.
