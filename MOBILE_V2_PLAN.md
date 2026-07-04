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

## Platform support matrix (revised — see "Apple Music pivot" below)

| | Spotify | Apple Music |
|---|---|---|
| iOS | ✅ Native auth + REST playback (not App Remote — see below) | ✅ WebView embedding the deployed web app (MusicKit JS) |
| Android | ✅ Same as iOS | ✅ Same WebView approach — identical on both platforms |

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
- Navigation + all screens, real UI throughout.
- `AppleMusicWebViewScreen.tsx` — real, working code: renders the deployed
  web app in a `react-native-webview` WebView.
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
   iOS device testing and App Store distribution (code signing, regardless of
   the MusicKit entitlement question the WebView pivot sidesteps). Nothing
   past Phase 1 scaffolding can be verified without this.
3. **Google Play developer account** ($25 one-time) — needed for Android
   distribution; Android *development* builds don't strictly require it.
4. **Spotify's app review** — production use at scale typically needs your
   Spotify app's quota extended past development mode, same constraint the
   web app already has for OAuth users (this no longer has anything to do
   with App Remote specifically, since that isn't used — see above).
7. **No token refresh for the Spotify session** — `spotify/auth.ts`'s
   `ensureFreshToken()` just throws once the session expires; the native
   SDK's refresh token needs a server-side proxy holding the Spotify client
   secret to use safely (its own docs recommend a "token swap/refresh"
   endpoint for exactly this). Not built — would mean adding a relay
   endpoint mirroring the existing Apple developer-token endpoint's pattern,
   plus a new `SPOTIFY_CLIENT_SECRET` env var on Render. Worth doing if
   session length becomes annoying in testing; skipped for now to keep this
   pass scoped to "real playback control," not "production-grade auth."
8. **No real App Remote binding** — see "Why this exists" above. If
   App Remote's connect/disconnect lifecycle (vs. this app's REST polling)
   ever becomes worth having, the options are: write a custom native module
   bridging Spotify's App Remote SDK directly, or find/fork a library that
   actually implements it. Not attempted here — REST parity with the web
   app was the pragmatic choice given no verified alternative exists.
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
