# Mobile progress log

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
