# apps/mobile — ListenSync v2 (iOS + Android)

Status: **scaffold, unverified**. See [`/MOBILE_V2_PLAN.md`](../../MOBILE_V2_PLAN.md)
at the repo root for the full architecture writeup, platform support matrix,
and open questions — read that first.

This is on the `mobile-v2` branch, not `master`/`main` — nothing here affects
the deployed web app or relay.

## What's real vs. unverified

Nothing is a stub anymore, but "real" and "runtime-verified on a device"
aren't the same thing — see the breakdown below.

- **Real, working, and unit-tested**: `src/relay/client.ts` (WebSocket
  connection to the same relay `apps/web` uses), `src/sync/useRoomSync.ts`
  and `src/sync/resolveTrack.ts` (ported from `apps/web`, same sync/drift-
  correction logic), `src/spotify/player.ts` and
  `src/platform/spotifyAdapter.ts` (verbatim ports of apps/web's Spotify Web
  API REST logic — rate-limit backoff, device-transfer skip logic — **not**
  App Remote, see the correction note below), all the screens/navigation,
  and `src/screens/AppleMusicWebViewScreen.tsx` (embeds the deployed web
  app — see "Apple Music: WebView, not native" below).
- **Real, but unverified on a device**: `src/spotify/auth.ts`'s
  `authenticate()` — the native Spotify SSO handshake via
  `@wwdrew/expo-spotify-sdk` has not been exercised on a device/simulator
  (none available while writing this). This is the one genuinely
  unconfirmed piece; everything downstream of getting an access token is
  proven logic with matching tests, not a guess.

**Correction (2026-07-04)**: `@wwdrew/expo-spotify-sdk` — confirmed by
reading its shipped `.d.ts` files — only wraps Spotify's native auth
handshake (`isAvailable()` / `Authenticate.authenticateAsync()`); it does
**not** expose Spotify's App Remote SDK for playback control, despite the
original plan assuming it did. So `platform/spotifyAdapter.ts` uses the same
Spotify Web API REST calls `apps/web` already uses (a verbatim port), which
needs an already-active **external** Spotify Connect device — same
constraint a mobile *browser* user of the web app already has. See
`/MOBILE_V2_PLAN.md`'s "Why this exists" section for the full correction and
what this means for the original rationale to go native for Spotify at all.

## Apple Music: WebView, not native

Apple Music does **not** use a native adapter here. Choosing "Continue with
Apple Music" on the platform picker navigates straight to
`AppleMusicWebViewScreen`, which embeds the already-deployed web app (its own
login, room chooser, and room view all render inside that one WebView) via
`react-native-webview`. This sidesteps the native MusicKit framework
entirely — see `/MOBILE_V2_PLAN.md` for why: EAS Build's (and even plain
Xcode's) automatic provisioning has a confirmed, unresolved gap in handling
MusicKit's required "App Services"-tier entitlement. `react-native-webview`
is one of the most widely-used RN libraries (no library-trust concern like
the native MusicKit wrapper it replaces had), and this approach works
identically on iOS and Android, which also eliminates the original plan's
separate "Android + Apple Music needs a custom native module" phase.

## Setup (not yet run/verified in this environment)

```
npm install          # from the repo root — this is an npm workspace
cd apps/mobile
cp .env.example .env # fill in EXPO_PUBLIC_SPOTIFY_CLIENT_ID etc.
npx expo prebuild     # generates native ios/ and android/ projects
npx eas login          # needed for cloud builds — see below
```

This app uses a native module (`@wwdrew/expo-spotify-sdk`, for auth only —
see the correction above) plus `react-native-webview` for Apple Music, so
**Expo Go won't work** — it can't load arbitrary native code. You need a
**development build** instead:

```
eas build --profile development --platform ios
eas build --profile development --platform android
```

`eas.json` isn't created yet — `eas build:configure` sets it up interactively.

## Why EAS specifically

EAS Build runs in Expo's cloud, so iOS builds work from this Windows machine
without a Mac/Xcode. iOS builds still need a paid Apple Developer Program
membership ($99/yr) for code signing — no way around that part.

## Testing reality check

`spotify/auth.ts`'s native SSO handshake needs physical device access to
verify, which wasn't available while this was drafted — everything else in
the Spotify path (`platform/spotifyAdapter.ts`, `spotify/player.ts`) is
covered by unit tests instead (see below) since it's REST logic, not native
bindings. The Apple Music WebView path has no such constraint in principle
(it's just a web view), but is likewise unverified in an actual dev-client
build here.

## Unit tests

`npm test -w apps/mobile` (or `npm run test` from this directory) runs
Vitest — 22 tests across `sync/resolveTrack.test.ts` (verbatim port of the
web app's test — same logic), `relay/client.test.ts` (real reconnect/backoff
behavior against a throwaway `ws` server, not mocks), `sync/useRoomSync.test.ts`
(a smaller subset of the web app's regression suite: event-driven
reconciliation, correction cooldown, poll-loop resilience to adapter
failures, device-error surfacing, seek/queue actions), and
`platform/spotifyAdapter.test.ts` (a smaller subset of the web app's
adapter tests: state mapping, rate-limit backoff, device-transfer skip
logic, search result mapping, queue mirroring).
Hook tests use `react-test-renderer`, not `@testing-library/react` +
`react-dom` — mixing react-dom@19 (hoisted to the repo root from `apps/web`)
with this workspace's pinned react@18.3.1 (react-native's peer requirement)
crashes with a dual-React-instance error; `react-test-renderer` avoids
react-dom entirely and is the standard way to test RN hooks. See
`vitest.config.ts`'s comments for the same issue with a stray `ws@6` nested
under this workspace by an Expo/RN transitive dependency.

Not covered: `spotify/auth.ts`'s actual native SSO handshake, and the mobile
UI itself — both still need physical device testing, as noted above.
