// Was app.json (plain JSON) — converted to a JS config so the
// @wwdrew/expo-spotify-sdk plugin below can read the Spotify client ID from
// the same EXPO_PUBLIC_SPOTIFY_CLIENT_ID env var used elsewhere, instead of
// hardcoding it here.
//
// Loads .env explicitly (not relying on Expo's own automatic dotenv
// loading) — `eas build:configure`/`eas build` internally shell out to
// `expo config --json` with EXPO_NO_DOTENV=1 set, which skips Expo's
// auto-load entirely in that sub-process. Without this explicit require,
// clientID silently resolved to '' in that path, and the plugin below
// throws ("Missing required Spotify config value: clientID") with the
// error swallowed by eas-cli's own process spawning — surfaced only as a
// bare "exited with non-zero code: 1". Loading .env ourselves here means
// this file no longer depends on which wrapper CLI is calling into it.
//
// This alone isn't enough for actual cloud builds, though: `.env` is
// gitignored, so it never reaches EAS's build servers at all — a real
// build failed with the same "Missing required Spotify config value"
// error even after the fix above, until the same vars were registered
// with `eas env:create development --name X --value Y --visibility
// plaintext` (EAS's own environment-variable store, injected into both
// the prebuild step and the bundled JS during a cloud build). Keep the
// EAS-registered vars for the "development" environment in sync with
// .env.example by hand — there's no automatic link between the two.
require('dotenv').config()

// Note: authenticateAsync() (spotify/auth.ts) takes no redirect URI
// argument at all — the effective redirect URI is entirely determined by
// this plugin's scheme/host at prebuild time, baked into the native
// project. EXPO_PUBLIC_SPOTIFY_REDIRECT_URI in .env.example exists only so
// the same string can be registered in the Spotify Developer Dashboard;
// nothing in this app reads it directly.
module.exports = {
  expo: {
    name: 'ListenSync',
    slug: 'listensync-mobile',
    version: '0.0.1',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    scheme: 'listensync',
    ios: {
      bundleIdentifier: 'com.listensync.mobile',
      supportsTablet: false,
    },
    android: {
      package: 'com.listensync.mobile',
    },
    // Links this local project to the EAS project created via `eas init`
    // (@forestlwu/listensync-mobile). Not a secret — this ID is how EAS
    // Build/Submit know which cloud project to build/store credentials
    // against; static config files (app.json) get this written in
    // automatically, but a dynamic app.config.js has to set it by hand.
    extra: {
      eas: {
        projectId: '895f6bf7-e381-4c9d-9fcc-338b8d43066a',
      },
    },
    plugins: [
      'expo-dev-client',
      [
        '@wwdrew/expo-spotify-sdk',
        {
          clientID: process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '',
          scheme: 'listensync',
          host: 'spotify-auth',
        },
      ],
    ],
  },
}
