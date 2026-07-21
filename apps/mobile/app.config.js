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

const path = require('node:path')
const { withAppBuildGradle, withProjectBuildGradle } = require('@expo/config-plugins')

// Works around a real bug in @wwdrew/expo-spotify-sdk@1.0.0's Android config
// plugin: passing `redirectPathPattern` in the plugin config (below) has no
// effect — the generated android/app/build.gradle's manifestPlaceholders
// block never gets a redirectPathPattern entry at all, regardless of what's
// configured, so the manifest merge fails with "requires a placeholder
// substitution but no value for <redirectPathPattern> is provided." Confirmed
// by inspecting the generated build.gradle after prebuild — the key is
// simply absent. Runs after the wwdrew plugin (Expo applies each plugin's
// mods in array order — see plugins below) so its manifestPlaceholders
// block already exists to patch into. Matches both build types (debug and
// release each get their own manifestPlaceholders block in this file).
function withSpotifyRedirectPathPatternFix(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') return config
    const needle = /redirectHostName:\s*"([^"]*)"/g
    if (!needle.test(config.modResults.contents)) {
      throw new Error(
        "withSpotifyRedirectPathPatternFix: couldn't find redirectHostName in app/build.gradle — " +
          '@wwdrew/expo-spotify-sdk may have changed its generated manifestPlaceholders shape; update this plugin.',
      )
    }
    config.modResults.contents = config.modResults.contents.replace(needle, (match) => `${match},\n          redirectPathPattern: ".*"`)
    return config
  })
}

// Second workaround for the same App Remote AAR problem (see
// patches/@wwdrew+expo-spotify-sdk+1.0.0.patch, applied via patch-package):
// that patch switches the wwdrew module's own build.gradle from
// `implementation files('libs/...')` to the flatDir module-coordinate form
// (`implementation(name: ..., ext: 'aar')`), which fixes AGP's "Direct
// local .aar file dependencies are not supported when building an AAR"
// error — building wwdrew's own library AAR now works. But a flatDir
// repository declared ONLY inside a leaf subproject's own build.gradle
// isn't visible when a *different* project (:app, resolving its full
// runtime classpath transitively through :expo -> :wwdrew-expo-spotify-sdk)
// resolves that dependency — Gradle multi-project dependency resolution
// uses the requesting project's own repository chain for transitive deps,
// not each dependency's declaring project's repos. Confirmed by hitting
// "Could not find :spotify-app-remote-release-0.8.0:." on
// :app:debugRuntimeClasspath specifically, immediately after the previous
// fix made the wwdrew module itself buildable. Fix: add the same flatDir
// repo to the root build.gradle's `allprojects { repositories { ... } }`
// block, generated fresh by every `expo prebuild` — so it's visible
// uniformly, matching how :app's classpath resolution actually reaches it.
function withSpotifyAppRemoteFlatDir(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') return config
    const libsDir = path.join(path.dirname(require.resolve('@wwdrew/expo-spotify-sdk/package.json')), 'android', 'libs').replace(/\\/g, '/')
    const needle = /allprojects\s*\{\s*repositories\s*\{/
    if (!needle.test(config.modResults.contents)) {
      throw new Error(
        "withSpotifyAppRemoteFlatDir: couldn't find 'allprojects { repositories {' in the root build.gradle — " +
          'the Expo/RN template may have changed; update this plugin.',
      )
    }
    config.modResults.contents = config.modResults.contents.replace(
      needle,
      (match) => `${match}\n        flatDir {\n            dirs "${libsDir}"\n        }`,
    )
    return config
  })
}

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
          // Passing redirectPathPattern here has no effect on Android as of
          // v1.0.0 (real plugin bug, not a config mistake) — see
          // withSpotifyRedirectPathPatternFix below, which is what actually
          // fixes this.
        },
      ],
      // Must run after the wwdrew plugin above — Expo applies plugin mods in
      // array order, and this patches build.gradle content that plugin
      // generates.
      withSpotifyRedirectPathPatternFix,
      withSpotifyAppRemoteFlatDir,
    ],
  },
}
