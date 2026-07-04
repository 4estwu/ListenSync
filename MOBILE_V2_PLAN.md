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

## Platform support matrix (revised — see "Apple Music pivot" below)

| | Spotify | Apple Music |
|---|---|---|
| iOS | ✅ App Remote SDK, wrapped by a maintained Expo module | ✅ WebView embedding the deployed web app (MusicKit JS) |
| Android | ✅ App Remote SDK, same wrapped module as iOS | ✅ Same WebView approach — identical on both platforms |

This table used to have an Android+Apple Music gap requiring a custom native
module (a "Phase 2," scoped separately, since Apple ships an official
**MusicKit for Android** SDK but no maintained React Native wrapper for it).
The WebView pivot below eliminates that gap entirely: Apple Music now works
the same way on both platforms, in Phase 1, with no native module at all.

## Apple Music pivot: WebView instead of the native MusicKit framework

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

**New approach**: skip the native MusicKit framework entirely. The web app's
MusicKit JS flow (Developer Token + `authorize()`, no code-signing or
entitlement concept at all — a completely different, unrelated auth system
from the native framework) already works, is already deployed, and is already
proven end-to-end. So the native mobile app embeds it directly: choosing
"Continue with Apple Music" in the native platform picker navigates straight
to a screen that renders the deployed web app inside a `react-native-webview`
WebView — same login, same room chooser, same room view, same sync engine,
running exactly as it does in a mobile browser today. No native module, no
entitlement, no provisioning gap.

This has two knock-on benefits:
- It directly answers the original library-trust concern:
  `react-native-webview` is one of the most widely-used libraries in the RN
  ecosystem — nothing like the ~50-star native MusicKit wrapper it replaces.
- It works identically on iOS and Android, which is why the platform matrix
  above no longer has an Android+Apple Music gap — the "Phase 2: custom
  native module" work this plan originally called for is no longer needed.

The Spotify side of this plan is unaffected: it still goes through the native
App Remote SDK (no entitlement issue there — it's a third-party SDK talking
to the separately-installed Spotify app via URL scheme, not gated by Apple's
provisioning tooling), which is the actual reason a native app is worth
building in the first place (see "Why this exists" above).

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
- **`react-native-webview`** for Apple Music, on both iOS and Android — embeds
  the deployed web app's already-working MusicKit JS flow instead of a native
  MusicKit framework wrapper. See "Apple Music pivot" above for why. One of
  the most widely-used RN libraries, so no library-trust concern here the way
  there was with the native wrapper it replaces.
- **React Navigation** for screen flow — standard, unopinionated choice,
  nothing platform-specific about this pick.
- Relay/protocol: **unchanged**. `packages/shared`'s `RelayEvent`/`RoomState`
  already fully describe the sync protocol; a mobile client talks to the same
  relay the web app does, no new endpoints needed for Phase 1.

## Architecture

Mirrors the web app's shape for the Spotify path, swapping the browser-specific
pieces for native equivalents; Apple Music is the WebView exception described
above.

- `PlaybackAdapter` interface (already exists in `apps/web/src/platform/adapter.ts`)
  gets a mobile-native implementation for Spotify only — same shape
  (`getState`, `play`, `pause`, `seek`, `search`, `resolveByIsrc`,
  `enqueueUpcoming`), different backing calls (native SDK methods instead of
  `fetch()`). The interface doesn't need to change; only what implements it
  does. There is no Apple Music adapter — the WebView owns its own auth/sync
  state internally, exactly as the web app does in a mobile browser.
- The actual sync engine logic (`useRoomSync`'s reconciliation, drift
  correction, auto-advance) is UI-framework-agnostic already — it's plain
  TypeScript operating on the adapter interface and the relay connection, no
  DOM/React-web-specific APIs inside it. The realistic plan is to **port it
  into `packages/shared` or a new `packages/sync-core`** so both the web app
  and the mobile app import the same reconciliation logic instead of
  maintaining two copies that can silently drift apart. Not done yet on this
  branch — flagged as the highest-value next step, see Open Questions. This
  only applies to the Spotify path; Apple Music's WebView reuses the web app's
  sync engine directly, by definition.
- Screens mirror the web app's flow 1:1 for the Spotify path (platform picker
  → login → room chooser → room view — now playing, progress bar, seek,
  search, queue, activity log). Apple Music instead jumps straight from the
  platform picker to the WebView screen.

## What's actually scaffolded on this branch right now

- `apps/mobile/` — a new Expo/TypeScript workspace, added to the root
  `package.json` workspaces array.
- Navigation + screen **stubs** matching the web app's flow, with real UI but
  fake/no-op data for the Spotify path — no native SDK wiring attempted
  blind. Wiring real Spotify App Remote calls without a device to test
  against risks writing plausible-looking code that's actually wrong in ways
  neither of us would catch until real device testing — worse than an honest
  stub.
- A typed `MobilePlaybackAdapter`-shaped interface file mirroring the web
  app's, with clear `// TODO(native)` markers at every point real Spotify SDK
  calls need to go in.
- `AppleMusicWebViewScreen.tsx` — real, working code (not a stub): renders
  the deployed web app in a `react-native-webview` WebView.
- `.env.example` for the mobile app's own config needs (Spotify client ID —
  reusable from the existing app, redirect URI scheme — new, needs
  registering; deployed web app URL for the Apple Music WebView).

## Open questions — need your input before this goes further

1. **Shared sync-core extraction** — worth doing before or after Phase 1's
   basic screens are wired up? Doing it first means less duplicate logic to
   maintain from day one; doing it after means faster visible progress on the
   mobile app itself. No wrong answer, just needs a call.
2. **Apple Developer Program enrollment** ($99/year) — needed for any real
   iOS device testing and App Store distribution (code signing, regardless of
   the MusicKit entitlement question the WebView pivot sidesteps). Nothing
   past Phase 1 scaffolding can be verified without this.
3. **Google Play developer account** ($25 one-time) — needed for Android
   distribution; Android *development* builds don't strictly require it.
4. **Spotify's app review** — production use of the App Remote SDK at scale
   typically needs your Spotify app's quota extended past development mode,
   same constraint the web app already has for OAuth users.
5. **EAS account** — needed to actually run cloud builds. Free tier exists
   with build-count limits; check whether that's sufficient for your expected
   iteration pace.
6. **Real device access** — I have none. The Spotify adapter is unverified
   beyond "it typechecks and matches the library's documented API shape."
   This is the single biggest gap between "drafted" and "working" for that
   path — flagging it clearly rather than overstating what's been done. The
   Apple Music WebView path has a smaller version of the same gap: unverified
   in a real dev-client build, though it carries much less risk since it's
   just a web view pointed at code that already works.
