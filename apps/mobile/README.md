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
  correction logic), all the screens/navigation.
- **Stubbed, needs native SDK wiring**: `src/platform/spotifyAdapter.ts` and
  `src/platform/appleMusicAdapter.ts` — every method throws
  "not yet implemented." Auth in `src/screens/ConnectScreen.tsx` is the same.
  These need real calls into `@wwdrew/expo-spotify-sdk` and
  `@lomray/react-native-apple-music` — written from those libraries'
  documented APIs but not runtime-verified (no device/simulator available
  while drafting this). Look for `TODO(native)` comments.

## Setup (not yet run/verified in this environment)

```
npm install          # from the repo root — this is an npm workspace
cd apps/mobile
cp .env.example .env # fill in EXPO_PUBLIC_SPOTIFY_CLIENT_ID etc.
npx expo prebuild     # generates native ios/ and android/ projects
npx eas login          # needed for cloud builds — see below
```

This app uses native modules (Spotify/Apple Music SDKs), so **Expo Go won't
work** — it can't load arbitrary native code. You need a **development
build** instead:

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

MusicKit (Apple Music) does not work in the iOS Simulator at all — only a
real device, with a real Apple Music subscription. Spotify's App Remote SDK
similarly expects the real Spotify app to be installed. Neither of the two
native adapters in this scaffold can be meaningfully tested without physical
device access, which wasn't available while this was drafted.
