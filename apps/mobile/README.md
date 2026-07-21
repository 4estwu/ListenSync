# apps/mobile — ListenSync v2 (iOS + Android)

Status: **Android verified end-to-end on a real emulator, including real
Spotify App Remote playback (2026-07-20); iOS unattempted.** See
[`/MOBILE_V2_PLAN.md`](../../MOBILE_V2_PLAN.md) at the repo root for the
full architecture writeup, platform support matrix, and open questions —
read that first.

This is on the `mobile-v2` branch, not `master`/`main` — nothing here affects
the deployed web app or relay.

## What's real vs. unverified

- **Real, working, and unit-tested**: `src/relay/client.ts` (WebSocket
  connection to the same relay `apps/web` uses), `src/sync/useRoomSync.ts`
  and `src/sync/resolveTrack.ts` (ported from `apps/web`, same sync/drift-
  correction logic), `src/spotify/appRemotePlayer.ts` and
  `src/platform/spotifyAdapter.ts` (playback control via Spotify's **App
  Remote SDK** — see the correction note below; `src/spotify/player.ts`
  still does plain Web API REST, but only for catalog search now), all the
  screens/navigation, and `src/screens/AppleMusicScreen.tsx` (launches the
  deployed web app in a Chrome Custom Tab — see "Apple Music: Custom Tabs,
  not a WebView" below).
- **Real, and verified live on a real Android emulator (2026-07-20)**:
  `src/spotify/auth.ts`'s `authenticate()` (native SSO handshake) →
  `AppRemote.connect()` → search → queue → play, all working end to end
  with the playback position genuinely advancing — no external Spotify
  Connect device, no separately opening Spotify and pressing play first.
  The Apple Music Custom Tab flow was also exercised live, reaching Apple's
  real sign-in and consent screens.
- **Still unverified**: the whole iOS side — no Apple Developer Program
  enrollment or physical iPhone used yet (Windows can't run an iOS
  Simulator at all, so a physical device is mandatory there regardless).

**Correction (2026-07-04), superseded 2026-07-20**: `@wwdrew/expo-spotify-sdk`
was auth-only at the time this was written (confirmed by reading its
shipped `.d.ts` files). It has since shipped real App Remote support in its
`1.0.0` release — see `/MOBILE_V2_PLAN.md`'s "Why this exists" section for
the full history, including three real AGP/upstream build bugs hit and
fixed while upgrading, and why the library's "Expo SDK 55 lane" framing
didn't block using it on this project's SDK 52 setup for Android. Playback
no longer needs an external Spotify Connect device — App Remote controls
the Spotify app running on the same device directly. `platform/
spotifyAdapter.ts` still uses plain Web API REST for one thing: catalog
search, which App Remote doesn't expose.

**Real bugs found and fixed (2026-07-17, 2026-07-20)**: `@wwdrew/expo-spotify-sdk`
requests `response_type=token` (implicit grant) unless a `tokenSwapURL` is
configured — and Spotify's authorization server now rejects that flow
outright (deprecated server-side), surfacing as "response type must be
code" right after 2FA. `spotify/auth.ts` now passes `tokenSwapURL` pointing
at a relay endpoint (`apps/relay/src/spotifyTokenSwap.ts`) that exchanges
the code server-side using `SPOTIFY_CLIENT_SECRET`. Token *refresh* is
still not implemented — the same library has no refresh HTTP call wired up
on Android at all — so an expired session still requires logging in again.
Separately: installing the actual Spotify app on the test device switches
the SDK to app-to-app auth, which needs the debug keystore's SHA-1
fingerprint registered in the Spotify Developer Dashboard's "Android
Packages" section (a different section from Redirect URIs) — without it,
login fails hard with `AUTHENTICATION_SERVICE_UNAVAILABLE` instead of
falling back to the browser flow.

## Apple Music: Custom Tabs, not a WebView

Apple Music does **not** use a native adapter, and — as of 2026-07-17 —
does **not** use an embedded `react-native-webview` either (an earlier
version of this app did; see `/MOBILE_V2_PLAN.md`'s "Apple Music pivot #1"
for that history). Choosing "Continue with Apple Music" launches the
already-deployed web app in a **Chrome Custom Tab** via `expo-web-browser`.

The WebView approach was reverted after a real, reproduced bug: MusicKit
JS's `authorize()` opens a popup that completes only via a genuine
`window.opener.postMessage()` handshake (confirmed by reading MusicKit JS's
actual source — no fallback exists). An embedded WebView cannot preserve
that relationship (confirmed by reading `react-native-webview`'s native
Android/iOS source directly — its `onOpenWindow` event only ever surfaces a
URL string, never a real window handle), so the flow would hang forever
right after tapping "Allow." Custom Tabs run the real Chrome engine, so
`window.opener` works normally, the same as it already does for the
deployed web app's regular mobile-browser users. See
`/MOBILE_V2_PLAN.md`'s "Apple Music pivot #2" for the full writeup.

## Setup

```
npm install          # from the repo root — this is an npm workspace
cd apps/mobile
cp .env.example .env # fill in EXPO_PUBLIC_SPOTIFY_CLIENT_ID etc.
npx expo prebuild     # generates native ios/ and android/ projects
npx eas login          # needed for cloud builds — see below
```

This app uses a native module (`@wwdrew/expo-spotify-sdk`, for auth + App
Remote — see the correction above), so **Expo Go won't work** — it can't
load arbitrary native code. You need a **development build** instead:

```
eas build --profile development --platform ios
eas build --profile development --platform android
```

`eas.json` is already checked in (generated via `eas build:configure`).

## Why EAS specifically

EAS Build runs in Expo's cloud, so iOS builds work from this Windows machine
without a Mac/Xcode. iOS builds still need a paid Apple Developer Program
membership ($99/yr) for code signing — no way around that part. Both a real
EAS cloud build and a local Gradle build (`./gradlew assembleDebug`, with
`JAVA_HOME` pointed at Android Studio's bundled JBR) have succeeded for
Android as of 2026-07-17 — the local build is much faster for iterating
(no upload/queue wait) once Android Studio + an SDK are installed locally.

## Testing reality check

Verified end-to-end on a real Android emulator (2026-07-20): the app
installs, launches, the platform picker renders, Spotify's native login
flow runs for real, `AppRemote.connect()` succeeds, and search → queue →
play genuinely plays audio through the Spotify app on the same device
(position confirmed advancing across a real wait, not a static display) —
no external Spotify Connect device needed. The Apple Music Custom Tab flow
reaches Apple's genuine sign-in/consent screens. iOS is entirely
unverified — needs the Apple Developer Program enrollment and a physical
iPhone (Windows can't run an iOS Simulator at all).

## Unit tests

`npm test -w apps/mobile` (or `npm run test` from this directory) runs
Vitest — 22 tests across `sync/resolveTrack.test.ts` (verbatim port of the
web app's test — same logic), `relay/client.test.ts` (real reconnect/backoff
behavior against a throwaway `ws` server, not mocks), `sync/useRoomSync.test.ts`
(a smaller subset of the web app's regression suite: event-driven
reconciliation, correction cooldown, poll-loop resilience to adapter
failures, device-error surfacing, seek/queue actions), and
`platform/spotifyAdapter.test.ts` (App Remote-backed adapter: state
mapping, play/pause/seek delegation, search result mapping, best-effort
queue mirroring).
Hook tests use `react-test-renderer`, not `@testing-library/react` +
`react-dom` — mixing react-dom@19 (hoisted to the repo root from `apps/web`)
with this workspace's pinned react@18.3.1 (react-native's peer requirement)
crashes with a dual-React-instance error; `react-test-renderer` avoids
react-dom entirely and is the standard way to test RN hooks. See
`vitest.config.ts`'s comments for the same issue with a stray `ws@6` nested
under this workspace by an Expo/RN transitive dependency.

Not covered: `spotify/auth.ts`'s actual native SSO handshake, and the mobile
UI itself — both still need physical device testing, as noted above.
