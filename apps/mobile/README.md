# apps/mobile — ListenSync v2 (iOS + Android)

Status: **scaffold, unverified**. See [`/MOBILE_V2_PLAN.md`](../../MOBILE_V2_PLAN.md)
at the repo root for the full architecture writeup, platform support matrix,
and open questions — read that first.

This is on the `mobile-v2` branch, not `master`/`main` — nothing here affects
the deployed web app or relay.

## What's real vs. stubbed

- **Real, working code**: `src/relay/client.ts` (WebSocket connection to the
  same relay `apps/web` uses — no native module needed, React Native's
  built-in WebSocket is enough), `src/sync/useRoomSync.ts` and
  `src/sync/resolveTrack.ts` (ported from `apps/web`, same sync/drift-
  correction logic), all the screens/navigation, and
  `src/screens/AppleMusicWebViewScreen.tsx` (embeds the deployed web app —
  see "Apple Music: WebView, not native" below).
- **Stubbed, needs native SDK wiring**: `src/platform/spotifyAdapter.ts` —
  every method throws "not yet implemented." Auth in
  `src/screens/ConnectScreen.tsx` is the same. This needs real calls into
  `@wwdrew/expo-spotify-sdk` — written from that library's documented API but
  not runtime-verified (no device/simulator available while drafting this).
  Look for `TODO(native)` comments.

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

This app uses a native module (Spotify's App Remote SDK) plus
`react-native-webview` for Apple Music, so **Expo Go won't work** — it can't
load arbitrary native code. You need a **development build** instead:

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

Spotify's App Remote SDK expects the real Spotify app to be installed, so
`src/platform/spotifyAdapter.ts` can't be meaningfully tested without
physical device access, which wasn't available while this was drafted. The
Apple Music WebView path has no such constraint in principle (it's just a
web view), but is likewise unverified here.

## Unit tests

`npm test -w apps/mobile` (or `npm run test` from this directory) runs
Vitest — 15 tests across `sync/resolveTrack.test.ts` (verbatim port of the
web app's test — same logic), `relay/client.test.ts` (real reconnect/backoff
behavior against a throwaway `ws` server, not mocks), and
`sync/useRoomSync.test.ts` (a smaller subset of the web app's regression
suite: event-driven reconciliation, correction cooldown, poll-loop
resilience to adapter failures, device-error surfacing, seek/queue actions).
Hook tests use `react-test-renderer`, not `@testing-library/react` +
`react-dom` — mixing react-dom@19 (hoisted to the repo root from `apps/web`)
with this workspace's pinned react@18.3.1 (react-native's peer requirement)
crashes with a dual-React-instance error; `react-test-renderer` avoids
react-dom entirely and is the standard way to test RN hooks. See
`vitest.config.ts`'s comments for the same issue with a stray `ws@6` nested
under this workspace by an Expo/RN transitive dependency.

Nothing native (Spotify App Remote, the actual mobile UI) is covered —
that still needs physical device testing, as noted above.
