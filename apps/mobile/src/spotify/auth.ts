import * as SecureStore from 'expo-secure-store'
import { Auth } from '@wwdrew/expo-spotify-sdk'

// Real auth, via @wwdrew/expo-spotify-sdk's native Spotify SSO handshake
// (config plugin in app.config.js supplies clientID/scheme/host at build
// time — Auth.authenticate() itself takes no redirect URI, unlike the web
// app's PKCE flow). Session storage uses expo-secure-store (Keychain/
// Keystore-backed), not AsyncStorage — this holds an access token, worth the
// extra step over plain unencrypted storage.
//
// CONFIRMED on a real device (2026-07-17): calling authenticate() without a
// tokenSwapURL fails after 2FA with "response type must be code". Root
// cause, found by reading the library's own Android source
// (ExpoSpotifySDKModule.kt): it only requests response_type=code when
// tokenSwapURL/tokenRefreshURL is set; otherwise it requests
// response_type=token (implicit grant), which Spotify's authorization
// server now rejects outright — Spotify deprecated implicit grant. So
// tokenSwapURL isn't optional config, it's the only way this library can
// authenticate at all. The relay's /spotify/token-swap route (see
// apps/relay/src/spotifyTokenSwap.ts) implements the exact request shape
// the library's Kotlin source sends: a bare `code` param, expecting
// Spotify's raw token JSON straight back.
//
// tokenRefreshURL is deliberately NOT passed here — see ensureFreshToken
// below for the current refresh story (unchanged by the v1 upgrade: v1's
// own README confirms Android still has no refresh HTTP call implemented,
// only the code-swap).
//
// Upgraded from v0.5.0 (auth-only) to v1.0.0 (2026-07-20) specifically for
// App Remote support — see platform/spotifyAdapter.ts and
// spotify/appRemotePlayer.ts. This is the "Expo SDK 55 lane" per the
// library's own versioning scheme, but that floor turned out to be an
// iOS-only CocoaPods podspec constraint (`s.platform :ios, '15.1'`); the
// Android build has no equivalent version gate, and this project's mobile
// work is Android-only so far (iOS unattempted — no Developer Program
// enrollment or device). Confirmed by reading the package's own
// android/build.gradle and package.json (empty "dependencies", wildcard
// peerDependencies) before committing to the upgrade.
const TOKEN_KEY = 'spotify_token'

// process.env, not EXPO_PUBLIC_RELAY_URL's own ws(s):// scheme — the relay
// serves plain HTTP alongside the WebSocket upgrade on the same port (see
// apps/relay/src/index.ts), so the token-swap POST just needs the scheme
// swapped.
const TOKEN_SWAP_URL = (process.env.EXPO_PUBLIC_RELAY_URL ?? 'ws://127.0.0.1:8787').replace(/^ws/, 'http') + '/spotify/token-swap'

// app-remote-control: required for AppRemote.connect() — without it, the
// Spotify app rejects the App Remote IPC handshake outright regardless of
// what the other granted scopes allow. user-read-playback-state /
// user-modify-playback-state / user-read-currently-playing are no longer
// load-bearing for playback itself (App Remote replaces the Web API REST
// calls those gated — see spotify/appRemotePlayer.ts) but are kept since
// search still hits the Web API directly (spotify/player.ts) and the
// account-tier check in ConnectScreen.tsx reads GET /v1/me. `streaming` is
// kept for parity with apps/web's scope list.
const SCOPES = [
  'app-remote-control',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'user-read-email',
  'user-read-private',
] as const

export interface SpotifyToken {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
}

export function isSpotifyAppAvailable(): boolean {
  return Auth.isAvailable()
}

async function storeToken(token: SpotifyToken): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(token))
}

export async function getStoredToken(): Promise<SpotifyToken | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY)
  return raw ? (JSON.parse(raw) as SpotifyToken) : null
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

/**
 * Triggers the native SSO handshake (or a webview fallback if the Spotify
 * app isn't installed — handled inside the SDK itself, not here) and
 * persists the resulting session.
 */
export async function authenticate(): Promise<SpotifyToken> {
  const session = await Auth.authenticate({ scopes: [...SCOPES], tokenSwapURL: TOKEN_SWAP_URL })
  const token: SpotifyToken = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expirationDate,
  }
  await storeToken(token)
  return token
}

/**
 * No silent refresh: reading the library's Android source (see the top of
 * this file) confirmed there is no tokenRefreshURL HTTP call implemented at
 * all on this platform — only the initial code-swap is wired up. So even
 * with a relay endpoint standing by, this native SDK has no code path that
 * would call it. An expired token just surfaces as "log in again" rather
 * than silently failing later. Known, deliberate gap — see
 * MOBILE_V2_PLAN.md — not an oversight; revisit if iOS's Swift module turns
 * out to implement refresh differently, or if this library adds it later.
 */
export function ensureFreshToken(token: SpotifyToken): SpotifyToken {
  if (Date.now() >= token.expiresAt - 30_000) {
    throw new Error('Spotify session expired — log in again.')
  }
  return token
}
