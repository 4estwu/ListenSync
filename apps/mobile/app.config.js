// Was app.json (plain JSON) — converted to a JS config so the
// @wwdrew/expo-spotify-sdk plugin below can read the Spotify client ID from
// the same EXPO_PUBLIC_SPOTIFY_CLIENT_ID env var used elsewhere, instead of
// hardcoding it here. Expo loads .env files into process.env for this file's
// evaluation regardless of the EXPO_PUBLIC_ prefix (that prefix only
// controls whether a var also gets inlined into the JS bundle — this one
// already needs to be, since spotify/auth.ts reads it too, so one var
// serves both purposes).
//
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
