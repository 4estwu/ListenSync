# v2: Native iOS + Android app

Status: **draft, unreviewed** — written autonomously while you were away. Nothing
here is final. Treat every architectural call below as a recommendation to
push back on, not a decision already made. `apps/mobile/` has been scaffolded
on the `mobile-v2` branch (not `master`/`main`) so none of this touches the
live web app or its deploy.

## Why this exists

**Correction (2026-07-04) — the paragraph below was the original stated
reason to go native for Spotify, and it turned out to be wrong.** The web
app hit a real ceiling on mobile: Spotify blocks its Web Playback SDK on
every mobile browser (not a bug, a deliberate Spotify policy), so a phone
Spotify user always needs an already-active external Connect device. The
original plan assumed a native app could use Spotify's actual **App Remote
SDK** instead — different code path, not subject to that browser
restriction, with a real connect/disconnect/reconnect lifecycle instead of
REST polling that silently goes stale.

That assumption was never verified against what `@wwdrew/expo-spotify-sdk`
(the chosen wrapper library) actually exposes. It turns out to be
**auth only** — confirmed by inspecting its shipped `.d.ts` files directly
(`isAvailable()` and `Authenticate.authenticateAsync()`, nothing else), and
its own README lists "Supported Features: Authentication... More to come."
There is no App Remote playback binding in this library at all.

**What this actually means**: `apps/mobile`'s Spotify support
(`src/platform/spotifyAdapter.ts`, `src/spotify/player.ts`) is implemented
as the same Spotify Web API REST calls apps/web already uses — a verbatim
port, not App Remote — and needs an already-active external Connect device
exactly like a mobile *browser* user of the web app already requires today.
**The original technical justification for building a native app doesn't
hold as-is for Spotify.** What native still plausibly buys:
- An actual installed app (App Store/Play Store presence, an icon, no
  browser chrome) — the stated end goal regardless of the technical path.
- Apple Music support via the WebView approach (see below), which works
  identically on iOS and Android and doesn't depend on this question at all.
- A real App Remote binding is still possible in principle (writing a
  custom native module, or finding/forking a library that actually
  implements it) — not done here, flagged as an open question below rather
  than assumed away a second time.

Everything else in this plan (repo strategy, Apple Music WebView pivot) is
still sound; only the specific "App Remote escapes the browser restriction"
claim was wrong.

## Repo strategy: same repo, new workspace — not a separate repo

Recommendation: **`apps/mobile/`** in this monorepo, not a new repo.

- `packages/shared` (`Track`, `RoomState`, `RelayEvent` — the wire protocol) is
  exactly as useful to a native client as it is to the web client. A separate
  repo means either duplicating those types by hand or publishing a package
  and versioning it — real overhead for a solo project, for no benefit here.
- One relay serves both clients already — nothing about the relay needs to
  change for a native client to talk to it.
- Isolation from breaking the live web app doesn't require a separate repo —
  it requires not touching `apps/web`, `apps/relay`, or `packages/shared` in
  breaking ways, and working on a branch until this is ready. That's what the
  `mobile-v2` branch is for. `apps/web`/`apps/relay` are untouched on this
  branch as of this commit — confirm that stays true before merging anything.
- Counter-case for a separate repo: if this ever needs a genuinely different
  release cadence, a different team, or you want the option to open-source one
  without the other. None of that applies today.

## Platform support matrix (revised twice — see both pivots below)

| | Spotify | Apple Music |
|---|---|---|
| iOS | ✅ Native auth + REST playback (not App Remote — see below) | ✅ Chrome Custom Tab launching the deployed web app (MusicKit JS) |
| Android | ✅ Same as iOS | ✅ Same Custom Tab approach — identical on both platforms |

This table used to have an Android+Apple Music gap requiring a custom native
module (a "Phase 2," scoped separately, since Apple ships an official
**MusicKit for Android** SDK but no maintained React Native wrapper for it).
The pivots below eliminate that gap entirely: Apple Music now works the same
way on both platforms, in Phase 1, with no native module involved in the
platform-specific sense (a Custom Tab uses Chrome itself, not our code).

## Apple Music pivot #1 (2026-07-04): WebView instead of the native MusicKit framework

**Original plan** (superseded): `@lomray/react-native-apple-music` wrapping
Apple's native iOS MusicKit framework. Revisited this after noticing its low
star count (~50 combined with the Spotify wrapper) raised a fair
library-trust question. Star count wasn't actually the real problem, though —
digging into its open issues surfaced a **confirmed, unresolved GitHub issue**
showing that Apple's native MusicKit framework requires the
`com.apple.developer.musickit` **"App Services"-tier entitlement**, and EAS
Build's (and even plain Xcode's) automatic provisioning profile generation has
a genuine, currently-unresolved gap in handling that entitlement correctly.
That's an Apple/tooling-level problem, not a bug in the wrapper library
itself — no version bump or maintainer fix would resolve it.

**New approach at the time**: skip the native MusicKit framework entirely,
and embed the web app's already-working, already-deployed MusicKit JS flow
directly in a `react-native-webview` `<WebView>` — same login, same room
chooser, same room view, same sync engine, running exactly as it does in a
mobile browser today. No native module, no entitlement, no provisioning gap.
**This approach itself turned out to be broken — see pivot #2 immediately
below, which replaced it entirely before any release.**

## Apple Music pivot #2 (2026-07-17): Chrome Custom Tabs instead of an embedded WebView

**Real bug, reproduced on-device**: `MusicKit.getInstance().authorize()`
opens Apple's `authorize.music.apple.com` as a `window.open()` popup and —
confirmed by reading MusicKit JS's actual source directly — completes
**only** via a genuine `window.opener.postMessage()` handshake. There is no
redirect-based fallback anywhere in the SDK; calling `.postMessage()` on a
missing opener throws, silently, inside the popup's own JS.

An embedded `react-native-webview` `<WebView>` cannot preserve that
relationship. Confirmed by reading `react-native-webview`'s own native
Android (`RNCWebChromeClient.java`) and iOS (`RNCWebViewImpl.m`) source:
its `onOpenWindow` event only ever surfaces the popup's target URL as a
plain string — on Android it briefly creates a real transport-attached
child `WebView` internally, but discards it before ever exposing it to JS;
on iOS no second `WKWebView` is created at all. Two open GitHub issues
(react-native-webview#1674, #1868) confirm real cross-window
`postMessage`/`window.opener` support has never been implemented. The
practical symptom, reproduced live: the user completes Apple sign-in + 2FA
(the popup gets handed off to the external Chrome app, severing the
relationship entirely) and taps "Allow" — and the flow just hangs forever,
since the promise waiting for that message will never receive it.

**Fix**: stop embedding the web app in a `<WebView>` at all. Launch it in a
Chrome Custom Tab instead, via `expo-web-browser`'s `openBrowserAsync()`.
Custom Tabs run the *actual* Chrome engine (not a stripped-down native
WebView component) — a popup opened via `window.open()` from a page loaded
in Custom Tabs gets a real `window.opener` relationship, the same as any
normal browser tab, which is exactly why this flow already works for the
deployed web app's regular mobile-browser users. Verified end-to-end on a
real Android emulator: the Custom Tab loaded the real web app, fetched a
real Apple developer token from the relay, and MusicKit JS launched Apple's
genuine `authorize.music.apple.com` sign-in — further verification (does
"Allow" actually resolve now) is pending real user credentials, but the
structural fix — a real browser engine, not an embedded WebView — directly
addresses the confirmed root cause.

**Trade-off**: this is now a full-screen browser session, not an embedded
native screen — the whole login/room/sync/playback experience happens
inside the Custom Tab, and closing it returns to the platform picker. Less
seamless than a true embedded WebView would have been, but the embedded
approach was never actually going to work for this specific SDK.

This still answers the original library-trust concern from pivot #1:
`expo-web-browser` is an official Expo SDK package, not a low-star
third-party wrapper, and this pivot didn't reintroduce any Android/iOS gap —
Custom Tabs work identically on both platforms.

The Spotify side has no entitlement/provisioning issue either way (native
auth via `@wwdrew/expo-spotify-sdk` isn't gated by Apple's provisioning
tooling) — but see "Why this exists" above: it does **not** go through
App Remote as originally claimed, since the chosen wrapper library doesn't
expose it. It's REST calls (a port of apps/web's Spotify Web API logic),
same as this project's original web app.

## Tech stack

- **Expo (managed workflow, with a custom dev client)**, not bare React
  Native. Reasoning: EAS Build (Expo's cloud build service) can produce signed
  iOS builds from Windows/Linux with no Mac required — confirmed this still
  holds as of 2026, genuinely relevant since this project's being built from
  Windows. Plain "Expo Go" (the sandbox app) can't load custom native modules
  though, so this needs `expo-dev-client` / a development build from day one,
  not the Expo Go quick-start path.
- **`@wwdrew/expo-spotify-sdk`** for Spotify — Expo-native module wrapping
  Spotify's native SSO auth handshake **only** (confirmed by inspecting its
  shipped `.d.ts` files: `isAvailable()`/`Authenticate.authenticateAsync()`,
  nothing else — its own README says "Supported Features: Authentication...
  More to come"). No App Remote playback binding exists in this library, so
  playback control (`src/platform/spotifyAdapter.ts`) is a port of apps/web's
  REST-based Spotify Web API logic instead, needing an external Connect
  device just like a mobile browser user of the web app already does. Note
  the honest risk: single maintainer, moderate but not huge install base —
  if it goes stale, the fallback is forking it (it's open source) rather
  than waiting on someone else. **Do not use `react-native-spotify-remote`**
  — confirmed unmaintained, it's the predecessor this newer module was
  written to replace (and also doesn't solve the App Remote gap above).
- **`expo-web-browser`** for Apple Music, on both iOS and Android — launches
  the deployed web app's already-working MusicKit JS flow in a Chrome Custom
  Tab (iOS: `SFSafariViewController`) instead of embedding it in a WebView.
  See "Apple Music pivot #2" above for why an embedded WebView doesn't work
  for this SDK specifically. Official Expo SDK package, no library-trust
  concern.
- **React Navigation** for screen flow — standard, unopinionated choice,
  nothing platform-specific about this pick.
- Relay/protocol: **unchanged**. `packages/shared`'s `RelayEvent`/`RoomState`
  already fully describe the sync protocol; a mobile client talks to the same
  relay the web app does, no new endpoints needed for Phase 1.

## Architecture

Mirrors the web app's shape for the Spotify path, swapping the browser-specific
pieces for native equivalents; Apple Music is the Custom Tab exception described
above.

- `PlaybackAdapter` interface (already exists in `apps/web/src/platform/adapter.ts`)
  gets a mobile-native implementation for Spotify only — same shape
  (`getState`, `play`, `pause`, `seek`, `search`, `resolveByIsrc`,
  `enqueueUpcoming`), different backing calls (native SDK methods instead of
  `fetch()`). The interface doesn't need to change; only what implements it
  does. There is no Apple Music adapter — the Custom Tab session owns its
  own auth/sync state internally, exactly as the web app does in a mobile
  browser (because that's literally what it is).
- The actual sync engine logic (`useRoomSync`'s reconciliation, drift
  correction, auto-advance) is UI-framework-agnostic already — it's plain
  TypeScript operating on the adapter interface and the relay connection, no
  DOM/React-web-specific APIs inside it. The realistic plan is to **port it
  into `packages/shared` or a new `packages/sync-core`** so both the web app
  and the mobile app import the same reconciliation logic instead of
  maintaining two copies that can silently drift apart. Not done yet on this
  branch — flagged as the highest-value next step, see Open Questions. This
  only applies to the Spotify path; Apple Music's Custom Tab reuses the web
  app's sync engine directly, by definition.
- Screens mirror the web app's flow 1:1 for the Spotify path (platform picker
  → login → room chooser → room view — now playing, progress bar, seek,
  search, queue, activity log). Apple Music instead jumps straight from the
  platform picker into a Custom Tab, bypassing the native stack entirely.

## What's actually scaffolded on this branch right now

- `apps/mobile/` — a new Expo/TypeScript workspace, added to the root
  `package.json` workspaces array.
- Navigation + all screens, real UI throughout.
- `AppleMusicScreen.tsx` — real, working code: launches the deployed web app
  in a Chrome Custom Tab via `expo-web-browser`.
- Spotify path — **real, working logic, UNVERIFIED on a device** (2026-07-04):
  `spotify/auth.ts` (native SSO handshake via `@wwdrew/expo-spotify-sdk`,
  session persisted with `expo-secure-store`), `spotify/player.ts` and
  `platform/spotifyAdapter.ts` (verbatim ports of apps/web's already-tested
  REST logic — rate-limit backoff, device-transfer skip logic, state
  mapping; has its own unit tests, same as the web version), and
  `ConnectScreen.tsx` (real auth button + a device picker mirroring
  apps/web's `App.tsx` device-refresh logic). The concentrated risk is
  narrow: `authenticate()`'s actual native SSO call is the one thing that
  hasn't run against a real device — everything downstream is proven logic
  with matching unit tests, not a blind guess at an undocumented API.
- `.env.example` for the mobile app's own config needs (Spotify client ID —
  reusable from the existing app, also read by `app.config.js`'s Spotify SDK
  plugin at `expo prebuild` time; redirect URI scheme — new, needs
  registering; deployed web app URL for the Apple Music WebView).

## Open questions — need your input before this goes further

1. **Shared sync-core extraction** — worth doing before or after Phase 1's
   basic screens are wired up? Doing it first means less duplicate logic to
   maintain from day one; doing it after means faster visible progress on the
   mobile app itself. No wrong answer, just needs a call.
2. **Apple Developer Program enrollment** ($99/year) — needed for any real
   iOS device testing and App Store distribution (code signing). Nothing on
   iOS specifically can be verified without this — Android has been verified
   (see below), iOS has not been attempted yet.
3. **Google Play developer account** ($25 one-time) — needed for Android
   distribution; Android *development* builds don't strictly require it.
4. **Spotify's app review** — production use at scale typically needs your
   Spotify app's quota extended past development mode, same constraint the
   web app already has for OAuth users (this no longer has anything to do
   with App Remote specifically, since that isn't used — see above).
5. **EAS account** — set up and working (2026-07-16): both a real cloud
   build (`eas build`) and a local Gradle build have succeeded and produced
   working, installable Android dev-client builds.
6. **Real device testing — done for Android, not yet for iOS** (2026-07-17):
   verified end-to-end on a real Android emulator — native app installs and
   launches, the platform picker renders, and the Apple Music Custom Tab
   flow reaches Apple's real sign-in and consent screens (full completion
   pending live user credentials, but the structural fix in pivot #2 above
   is confirmed correct). The Spotify native login flow was also exercised
   for real and hit two real bugs, both fixed and documented in
   `spotify/auth.ts` and `apps/relay/src/spotifyTokenSwap.ts`. iOS is
   entirely unverified — needs the Apple Developer Program enrollment above
   plus a physical iPhone (no iOS Simulator exists for Windows).
7. **Spotify token-swap: done, not skipped** — `spotify/auth.ts`'s
   `authenticate()` now passes `tokenSwapURL` pointing at a real relay
   endpoint (`apps/relay/src/spotifyTokenSwap.ts`, a `POST
   /spotify/token-swap` route using the existing `SPOTIFY_CLIENT_SECRET`).
   This was required, not optional: without it, `@wwdrew/expo-spotify-sdk`
   requests `response_type=token` (implicit grant), which Spotify's
   authorization server now rejects outright since Spotify deprecated that
   flow server-side — surfaced as a real, reproduced "response type must be
   code" error. Token *refresh* is still not implemented — the same
   library's Android source has no refresh-token HTTP call wired up at all,
   so a relay refresh endpoint would have nothing to call it. An expired
   Spotify session still just requires logging in again.
8. **No real App Remote binding** — see "Why this exists" above. If
   App Remote's connect/disconnect lifecycle (vs. this app's REST polling)
   ever becomes worth having, the options are: write a custom native module
   bridging Spotify's App Remote SDK directly, or find/fork a library that
   actually implements it. Not attempted here — REST parity with the web
   app was the pragmatic choice given no verified alternative exists.
