# v2: Native iOS + Android app

Status: **draft, unreviewed** — written autonomously while you were away. Nothing
here is final. Treat every architectural call below as a recommendation to
push back on, not a decision already made. `apps/mobile/` has been scaffolded
on the `mobile-v2` branch (not `master`/`main`) so none of this touches the
live web app or its deploy.

## Why this exists

The web app hit a real ceiling on mobile: Spotify blocks its Web Playback SDK
on every mobile browser (not a bug, a deliberate Spotify policy), so a phone
Spotify user always needs an already-active external Connect device. A native
app can use Spotify's actual **App Remote SDK** instead of the Web Playback
SDK — different code path, not subject to that browser restriction, with a
real connection lifecycle (connect/disconnect callbacks, reconnect) instead of
REST polling that silently goes stale. That's the concrete win native buys us;
everything else in this plan is in service of getting there.

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

## Platform support matrix (this is the part most likely to surprise you)

| | Spotify | Apple Music |
|---|---|---|
| iOS | ✅ App Remote SDK, wrapped by a maintained Expo module | ✅ Native MusicKit, wrapped by a maintained RN module |
| Android | ✅ App Remote SDK, same wrapped module as iOS | ⚠️ Apple ships an official native Android MusicKit SDK — but no maintained RN wrapper exists. Real native module work (Kotlin), not a quick add. |

The Android+Apple Music cell is the one worth flagging explicitly: I'd
assumed going in that Apple Music simply wasn't available on Android at all.
That's wrong — Apple publishes an actual **MusicKit for Android** SDK
(`developer.apple.com/musickit/android/`) with an Authentication library and a
Media Playback library that plays Apple Music content natively, controllable
from the lock screen/background, same shape as Spotify's App Remote (it talks
to the installed Apple Music app, not fully standalone without it). It's real
and usable — there's just no existing React Native wrapper for it, meaning
supporting it means writing one (a Kotlin native module bridging Apple's AAR),
not just installing a library like every other cell in this table.

**Recommended phasing**, given that:
- **Phase 1**: iOS (Spotify + Apple Music) and Android (Spotify only). This
  covers the two "just wrap an existing maintained library" platforms plus the
  one where wrapping doesn't exist yet for the fourth.
- **Phase 2**: Android + Apple Music, via a custom native module. Scope this
  separately once Phase 1 is proven out — it's a distinct, nontrivial chunk of
  native Android work, not a natural extension of Phase 1's wiring.
- Until Phase 2, an Android user who wants Apple Music can still use the web
  app in their mobile browser — same experience as today, not a regression.

## Tech stack

- **Expo (managed workflow, with a custom dev client)**, not bare React
  Native. Reasoning: EAS Build (Expo's cloud build service) can produce signed
  iOS builds from Windows/Linux with no Mac required — confirmed this still
  holds as of 2026, genuinely relevant since this project's being built from
  Windows. Plain "Expo Go" (the sandbox app) can't load custom native modules
  though, so this needs `expo-dev-client` / a development build from day one,
  not the Expo Go quick-start path.
- **`@wwdrew/expo-spotify-sdk`** for Spotify — Expo-native module wrapping the
  real Spotify iOS/Android SDKs (auth + App Remote), actively maintained as of
  this writing. Note the honest risk: single maintainer, moderate but not huge
  install base — if it goes stale, the fallback is forking it (it's open
  source) rather than waiting on someone else. **Do not use
  `react-native-spotify-remote`** — confirmed unmaintained, it's the
  predecessor this newer module was written to replace.
- **`@lomray/react-native-apple-music`** for Apple Music on iOS — actively
  maintained (as of April 2026), supports React Native's New Architecture.
  Real constraint worth knowing now: **MusicKit does not work in the iOS
  Simulator** — every bit of Apple Music testing needs an actual device. This
  matters for how you'll validate this work; I can't run a simulator or
  device from here at all, so none of the native SDK wiring in this plan has
  been runtime-tested by me, only written from the libraries' documented
  APIs. Budget real device-testing time before trusting it.
- **React Navigation** for screen flow — standard, unopinionated choice,
  nothing platform-specific about this pick.
- Relay/protocol: **unchanged**. `packages/shared`'s `RelayEvent`/`RoomState`
  already fully describe the sync protocol; a mobile client talks to the same
  relay the web app does, no new endpoints needed for Phase 1.

## Architecture

Mirrors the web app's shape, swapping the browser-specific pieces for native
equivalents:

- `PlaybackAdapter` interface (already exists in `apps/web/src/platform/adapter.ts`)
  gets a mobile-native implementation instead of the Web API/MusicKit-JS one —
  same shape (`getState`, `play`, `pause`, `seek`, `search`, `resolveByIsrc`,
  `enqueueUpcoming`), different backing calls (native SDK methods instead of
  `fetch()`/`MusicKit.js`). The interface doesn't need to change; only what
  implements it does.
- The actual sync engine logic (`useRoomSync`'s reconciliation, drift
  correction, auto-advance) is UI-framework-agnostic already — it's plain
  TypeScript operating on the adapter interface and the relay connection, no
  DOM/React-web-specific APIs inside it. The realistic plan is to **port it
  into `packages/shared` or a new `packages/sync-core`** so both the web app
  and the mobile app import the same reconciliation logic instead of
  maintaining two copies that can silently drift apart. Not done yet on this
  branch — flagged as the highest-value next step, see Open Questions.
- Screens mirror the web app's flow 1:1 for Phase 1 (see scaffold below):
  platform picker → platform login/device setup → room chooser → room view
  (now playing, progress bar, seek, search, queue, activity log).

## What's actually scaffolded on this branch right now

- `apps/mobile/` — a new Expo/TypeScript workspace, added to the root
  `package.json` workspaces array.
- Navigation + screen **stubs** matching the web app's flow, with real UI but
  fake/no-op data — no native SDK wiring attempted blind. Wiring real Spotify
  App Remote / MusicKit calls without a device to test against risks writing
  plausible-looking code that's actually wrong in ways neither of us would
  catch until real device testing — worse than an honest stub.
- A typed `MobilePlaybackAdapter`-shaped interface file mirroring the web
  app's, with clear `// TODO(native)` markers at every point real SDK calls
  need to go in.
- `.env.example` for the mobile app's own config needs (Spotify client ID —
  reusable from the existing app, redirect URI scheme — new, needs
  registering).

## Open questions — need your input before this goes further

1. **Shared sync-core extraction** — worth doing before or after Phase 1's
   basic screens are wired up? Doing it first means less duplicate logic to
   maintain from day one; doing it after means faster visible progress on the
   mobile app itself. No wrong answer, just needs a call.
2. **Apple Developer Program enrollment** ($99/year) — needed for any real
   iOS device testing, MusicKit entitlements, and App Store distribution.
   Nothing past Phase 1 scaffolding can be verified without this.
3. **Google Play developer account** ($25 one-time) — needed for Android
   distribution; Android *development* builds don't strictly require it.
4. **Spotify's app review** — production use of the App Remote SDK at scale
   typically needs your Spotify app's quota extended past development mode,
   same constraint the web app already has for OAuth users.
5. **EAS account** — needed to actually run cloud builds. Free tier exists
   with build-count limits; check whether that's sufficient for your expected
   iteration pace.
6. **Real device access** — I have none. All native-SDK-touching code on this
   branch is unverified beyond "it typechecks and matches the libraries'
   documented API shape." This is the single biggest gap between "drafted"
   and "working" here — flagging it clearly rather than overstating what's
   been done.
