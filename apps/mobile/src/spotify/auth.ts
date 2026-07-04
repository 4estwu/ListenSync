import * as SecureStore from 'expo-secure-store'
import { Authenticate, isAvailable } from '@wwdrew/expo-spotify-sdk'

// Real auth, via @wwdrew/expo-spotify-sdk's native Spotify SSO handshake
// (config plugin in app.config.js supplies clientID/scheme/host at build
// time — authenticateAsync() itself takes no redirect URI, unlike the web
// app's PKCE flow). Session storage uses expo-secure-store (Keychain/
// Keystore-backed), not AsyncStorage — this holds an access token, worth the
// extra step over plain unencrypted storage.
//
// UNVERIFIED: the actual native authenticateAsync() call has not been
// exercised on a device (no device/simulator access while writing this).
// Everything downstream of getting an access token (spotify/player.ts,
// platform/spotifyAdapter.ts) is a straight port of apps/web's already-
// tested REST logic, so the real risk is concentrated in this file's
// authenticateAsync() call and SecureStore usage, not the playback logic.
const TOKEN_KEY = 'spotify_token'

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
  const session = await Authenticate.authenticateAsync({ scopes: [...SCOPES] })
  const token: SpotifyToken = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expirationDate,
  }
  await storeToken(token)
  return token
}

/**
 * Unlike apps/web's PKCE-based refresh (no client secret needed, so it can
 * silently re-mint a token from `accounts.spotify.com` on its own), this
 * native SDK's refresh_token — per its own docs — requires a server-side
 * token-refresh proxy holding the app's client secret (a `tokenRefreshURL`
 * passed to authenticateAsync(), not implemented here) to use safely. Without
 * one, there's no secure way to refresh in-app, so an expired token just
 * surfaces as "log in again" rather than silently failing later. This is a
 * known, deliberate gap — see MOBILE_V2_PLAN.md — not an oversight; adding a
 * relay-hosted refresh endpoint (mirroring the existing Apple developer-token
 * endpoint's pattern) is the natural next step if session length in testing
 * turns out to matter.
 */
export function ensureFreshToken(token: SpotifyToken): SpotifyToken {
  if (Date.now() >= token.expiresAt - 30_000) {
    throw new Error('Spotify session expired — log in again.')
  }
  return token
}
