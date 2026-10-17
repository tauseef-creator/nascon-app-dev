# NaSCon League mobile app

Expo SDK 58 (React Native 0.88, TypeScript, expo-router). Android 10+ (minSdk 29).
Plan and decisions: `../docs/MOBILE_BUILD_PLAN.md`; API contract: `../docs/MOBILE_API.md`.

## Run in development

```bash
source ~/.nvm/nvm.sh && nvm use 22      # Expo SDK 58 needs Node >= 22.13
cd mobile
npm install                              # only after a fresh clone
npx tsc --noEmit                         # type check
npx expo run:android                     # first time: builds and installs the dev-client APK
npm start                                # afterwards: Metro, press "a" to open on the device
```

JavaScript changes hot-reload. Rebuild the APK only when a native package or an
`app.json` plugin changes. Do not add native packages without a rebuild.

## Point the app at the backend

The backend runs on the laptop at port 8080 (`docker compose up`). The server address is
editable in the app: **Login > Server settings** or **More > Settings**, then
"Test connection" (calls `GET /health`) and "Save address".

| Where the app runs | Server address |
|---|---|
| Android emulator | `http://10.0.2.2:8080` (default) |
| Phone over USB | run `adb reverse tcp:8080 tcp:8080`, then use `http://localhost:8080` |
| Phone on the same Wi-Fi / hotspot | `http://<laptop LAN IP>:8080` (find it with `ip -4 addr`) |

Cleartext HTTP is allowed (`expo-build-properties` `usesCleartextTraffic: true`).

## Build the release APK

```bash
cd mobile
npx expo prebuild -p android --clean
printf '\norg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=768m\n' >> android/gradle.properties
sed -i 's/^reactNativeArchitectures=.*/reactNativeArchitectures=arm64-v8a/' android/gradle.properties
export JAVA_HOME=$HOME/.gradle/jdks/eclipse_adoptium-17-amd64-linux.2 ANDROID_HOME=$HOME/Android/Sdk
(cd android && ./gradlew assembleRelease)          # 15-25 min, signed with the debug keystore
mkdir -p release && cp android/app/build/outputs/apk/release/app-release.apk release/app-release.apk
adb install -r release/app-release.apk
adb reverse tcp:8080 tcp:8080                      # then set http://localhost:8080 in Settings
```

The generated `android/gradle.properties` has no trailing newline, so always add the
newline before appending (the `printf` above does). If Gradle reports "Temporary failure
in name resolution", stop the daemon (`./gradlew --stop`) and run it again.

## Demo accounts

All use the password `Nascon@26` (quick-fill chips on the login screen):
`admin@`, `organizer@`, `manager@`, `player@`, `viewer@nascon.test`.

## Code map

| Path | What it does |
|---|---|
| `app/_layout.tsx` | Providers (Auth, Sync, Toast, League, Cart) and the sign-in gate |
| `app/(tabs)/` | Fixtures (`index`), Standings, Store, Club, More |
| `app/match/[id].tsx` | Live score (SSE with 5 s polling fallback), timeline, pinned product, scoring panel |
| `app/club/[id].tsx`, `app/roster.tsx` | Club profile; roster transfer / loan / release (club manager) |
| `app/product/[id].tsx`, `app/cart.tsx`, `app/receipt/[id].tsx` | Store flow with mock payment and receipt PDF |
| `app/sync.tsx`, `app/settings.tsx`, `app/login.tsx` | Sync queue, server address, login |
| `src/api/` | HTTP client (8 s timeout, Bearer token), error-code to plain-language mapping, types |
| `src/auth/AuthContext.tsx` | Login, token in expo-secure-store, tenant brand colours (`useBrand`) |
| `src/offline/` | SQLite (`cache`, `queue`, `sync_results`, `meta`), read-through cache, spec 5.14 queue, SyncProvider |
| `src/components/` | Screen + SyncBar + header, buttons, cards, pills, dialogs, toast |

## Offline behaviour (NFR-4)

- Fixtures, standings, club profiles, products and match scores are cached in SQLite and
  shown with a "saved copy" notice when offline.
- Scoring and roster actions made offline (or failing with a network error) are queued in
  the exact spec 5.14 format (`action_id`, `type`, `queued_at` UTC without millis,
  `base_version`, `payload`) and survive force-close.
- The queue syncs automatically on reconnect, on app foreground, every 20 s while items
  are pending, and through "Sync now" on the Sync queue screen. Each result (applied,
  rejected with a plain reason, already synced) is listed there.
