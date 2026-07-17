import * as SecureStore from 'expo-secure-store'
import { Authenticate, isAvailable } from '@wwdrew/expo-spotify-sdk'

// Real auth, via @wwdrew/expo-spotify-sdk's native Spotify SSO handshake
// (config plugin in app.config.js supplies clientID/scheme/host at build
// time — authenticateAsync() itself takes no redirect URI, unlike the web
// app's PKCE flow). Session storage uses expo-secure-store (Keychain/
// Keystore-backed), not AsyncStorage — this holds an access token, worth the
// extra step over plain unencrypted storage.
//
// CONFIRMED on a real device (2026-07-17): calling authenticateAsync()
// without a tokenSwapURL fails after 2FA with "response type must be code".
// Root cause, found by reading the library's own Android source
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
// tokenRefreshURL is deliberately NOT passed here — the same Kotlin source
// only implements the tokenSwapURL call; there is no refresh-token HTTP
// call anywhere in the Android module, so passing tokenRefreshURL would
// silently do nothing on this platform. See ensureFreshToken below for the
// current refresh story.
const TOKEN_KEY = 'spotify_token'

// process.env, not EXPO_PUBLIC_RELAY_URL's own ws(s):// scheme — the relay
// serves plain HTTP alongside the WebSocket upgrade on the same port (see
// apps/relay/src/index.ts), so the token-swap POST just needs the scheme
// swapped.
const TOKEN_SWAP_URL = (process.env.EXPO_PUBLIC_RELAY_URL ?? 'ws://127.0.0.1:8787').replace(/^ws/, 'http') + '/spotify/token-swap'

// user-read-playback-state / user-modify-playback-state / user-read-currently-playing:
// read/control an existing external Spotify Connect device — this app
// registers no device of its own (no native equivalent of the web app's
// in-tab Web Playback SDK), so an external device (e.g. the phone's own
// separately-installed Spotify app) must already be active. `streaming` is
// kept for parity with apps/web's scope list even though this app doesn't
// run the Web Playback SDK — harmless to request, and cheap insurance if a
// future revision adds an in-app player.
const SCOPES = [
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
  return isAvailable()
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
  const session = await Authenticate.authenticateAsync({ scopes: [...SCOPES], tokenSwapURL: TOKEN_SWAP_URL })
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
