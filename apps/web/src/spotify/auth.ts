import { consumeCodeVerifier, createPkcePair, storeCodeVerifier } from './pkce'

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string
const REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string
const TOKEN_KEY = 'spotify_token'
const PENDING_ROOM_KEY = 'spotify_pending_room'

// user-read-playback-state / user-modify-playback-state / user-read-currently-playing:
// read/control an existing Spotify Connect device (external or in-tab).
// streaming / user-read-email / user-read-private: required for the Web
// Playback SDK specifically — without `streaming`, the token can't fetch
// Widevine DRM licenses. The SDK still authorizes and starts buffering
// without it, so this was easy to miss: playback plays through the initial
// ~10s buffer, then the next license request 403s and audio dies right at
// that boundary — indistinguishable from a genuine SDK/browser bug unless
// you're specifically watching the network tab for widevine-license calls.
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'user-read-email',
  'user-read-private',
].join(' ')

export interface SpotifyToken {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

// localStorage (not sessionStorage) deliberately — the refresh token is
// long-lived, and the goal is to survive actually closing the browser/tab
// (common on mobile — backgrounding an app can lead to it being killed and
// reopened later), not just a same-tab reload. ensureFreshToken already
// re-mints a new access token from the refresh token on every use, so a
// stale cached access token here is never actually a problem.
export function getStoredToken(): SpotifyToken | null {
  const raw = localStorage.getItem(TOKEN_KEY)
  return raw ? (JSON.parse(raw) as SpotifyToken) : null
}

function storeToken(token: SpotifyToken): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** Reads and clears the room code stashed before an OAuth redirect (see `redirectToAuthorize`). */
export function consumePendingRoom(): string | null {
  const roomId = sessionStorage.getItem(PENDING_ROOM_KEY)
  sessionStorage.removeItem(PENDING_ROOM_KEY)
  return roomId
}

/**
 * `pendingRoomId` survives the full OAuth redirect (stashed here, read back via
 * `consumePendingRoom` after `handleRedirectCallback`) so a share-link join isn't
 * lost when the user has to log in first.
 */
export async function redirectToAuthorize(pendingRoomId?: string): Promise<void> {
  const { verifier, challenge } = await createPkcePair()
  storeCodeVerifier(verifier)
  if (pendingRoomId) sessionStorage.setItem(PENDING_ROOM_KEY, pendingRoomId)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
  })

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`
}

function tokenFromResponse(data: TokenResponse, fallbackRefreshToken?: string): SpotifyToken {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? fallbackRefreshToken ?? '',
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

/** Reads `code` from the current URL, exchanges it for a token, and strips the query string. */
export async function handleRedirectCallback(): Promise<SpotifyToken | null> {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')
  const code = params.get('code')

  if (error) throw new Error(`Spotify authorization failed: ${error}`)
  if (!code) return null

  const verifier = consumeCodeVerifier()
  if (!verifier) throw new Error('Missing PKCE code verifier — start login again.')

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)

  const token = tokenFromResponse((await res.json()) as TokenResponse)
  storeToken(token)
  window.history.replaceState({}, '', window.location.pathname)
  return token
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyToken> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)

  const token = tokenFromResponse((await res.json()) as TokenResponse, refreshToken)
  storeToken(token)
  return token
}

/** Returns a valid access token, refreshing first if the stored one is expired or about to expire. */
export async function ensureFreshToken(token: SpotifyToken): Promise<SpotifyToken> {
  if (Date.now() < token.expiresAt - 30_000) return token
  return refreshAccessToken(token.refreshToken)
}
