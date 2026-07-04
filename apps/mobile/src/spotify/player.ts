// Verbatim port of apps/web/src/spotify/player.ts. Architecturally important:
// @wwdrew/expo-spotify-sdk (the native module used for auth, see spotify/auth.ts)
// only wraps Spotify's native SSO/auth handshake — as of this writing its own
// README lists "Supported Features: Authentication... More to come" with no
// App Remote playback surface at all (confirmed by inspecting its shipped
// .d.ts files directly: only `isAvailable()`/`Authenticate.authenticateAsync()`
// are exported). So there is no native App Remote play/pause/seek/search here —
// playback control goes over the same Spotify Web API REST calls apps/web
// already uses and has tested, just from React Native's fetch instead of the
// browser's (same API surface). This needs an *external* Spotify Connect
// device already active somewhere (this app registers no device of its own,
// unlike apps/web's in-tab Web Playback SDK, which has no native-app
// equivalent) — same real-world constraint already documented for apps/web's
// external-device fallback path.
const API_BASE = 'https://api.spotify.com/v1'

export interface SpotifyDevice {
  id: string
  name: string
  type: string
  is_active: boolean
}

export interface SpotifyTrackSummary {
  uri: string
  name: string
  artists: { name: string }[]
  album: { name: string; images: { url: string }[] }
  duration_ms: number
  external_ids?: { isrc?: string }
}

export interface PlaybackState {
  is_playing: boolean
  progress_ms: number | null
  device: SpotifyDevice
  item: SpotifyTrackSummary | null
}

export interface QueueState {
  currently_playing: SpotifyTrackSummary | null
  queue: SpotifyTrackSummary[]
}

/** Spotify enforces rate limits per app (client_id), aggregated across every user authenticated through it — not per-user. */
export class SpotifyRateLimitError extends Error {
  retryAfterMs: number
  constructor(retryAfterMs: number) {
    super(`Spotify API rate limit exceeded, retry after ${retryAfterMs}ms`)
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * Every call in this file that targets a specific device (transfer, play,
 * pause, seek, queue) 404s with this shape when Spotify no longer recognizes
 * that device_id — this means the device's Connect session actually ended
 * (not just "currently paused"), most often because the physical
 * app/device went properly offline. The cached deviceId won't start working
 * again on its own; distinguishing this from a generic error lets the UI
 * explain what's actually wrong instead of a silent "nothing happens."
 */
export class SpotifyDeviceError extends Error {}

async function spotifyFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 429) {
    const retryAfterSeconds = Number(res.headers.get('Retry-After') ?? '1')
    throw new SpotifyRateLimitError(retryAfterSeconds * 1000)
  }
  if (res.status === 404) {
    throw new SpotifyDeviceError(`Spotify lost this device (${path}) — its Connect session ended`)
  }
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify API ${res.status} ${path}: ${await res.text()}`)
  }
  return res
}

export async function getDevices(accessToken: string): Promise<SpotifyDevice[]> {
  const res = await spotifyFetch(accessToken, '/me/player/devices')
  const data = (await res.json()) as { devices: SpotifyDevice[] }
  return data.devices
}

/** Returns null when nothing is currently active on the account (204 No Content). */
export async function getPlaybackState(accessToken: string): Promise<PlaybackState | null> {
  const res = await spotifyFetch(accessToken, '/me/player')
  if (res.status === 204) return null
  return (await res.json()) as PlaybackState
}

/**
 * Activates deviceId as the current Spotify Connect target. Without this,
 * `/me/player/play?device_id=X` can return success and update "what should
 * play" without the device actually starting audio, if it was never
 * transferred-to as the active device this session — the symptom is the
 * track visibly changing but never actually advancing/playing.
 *
 * Explicitly passes `play: true` — omitting it makes Spotify's backend "keep
 * the current playback state" on transfer, which is ambiguous with the
 * separate `/play` call issued right after this. Real device handshaking
 * isn't instant, and if the transfer's own "keep state" (still paused, since
 * we're always transferring right before a resume/play) resolves on
 * Spotify's backend a moment after our /play call already started audio, it
 * can silently pull playback back to paused a few seconds in — the "plays
 * briefly then stops" symptom. Only called from play() (never pause()), so
 * asserting play:true here always matches intent.
 */
export async function transferPlayback(accessToken: string, deviceId: string): Promise<void> {
  await spotifyFetch(accessToken, '/me/player', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play: true }),
  })
}

/**
 * `forceTransfer` defaults to true (safe default: activate the device before
 * touching it) but should be passed `false` by callers who already know —
 * from a recent getState()'s device.is_active — that the target device is
 * already the active one. Re-transferring an already-active device isn't a
 * pure no-op: it can interrupt the Web Playback SDK's in-flight
 * buffering/loading, which showed up as a rapid buffering-start/buffering-
 * end/playback_error loop every time a correction fired — i.e. our own
 * "always transfer to be safe" fix was itself causing instability once the
 * device WAS already active and just needed a plain resume/seek.
 */
export async function play(
  accessToken: string,
  deviceId: string,
  trackUri?: string,
  positionMs?: number,
  forceTransfer = true,
): Promise<void> {
  if (forceTransfer) await transferPlayback(accessToken, deviceId)

  const body: { uris?: string[]; position_ms?: number } = {}
  if (trackUri) body.uris = [trackUri]
  if (positionMs !== undefined) body.position_ms = Math.round(positionMs)
  const hasBody = trackUri !== undefined || positionMs !== undefined

  await spotifyFetch(accessToken, `/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: hasBody ? JSON.stringify(body) : undefined,
  })
}

export async function pause(accessToken: string, deviceId: string): Promise<void> {
  await spotifyFetch(accessToken, `/me/player/pause?device_id=${deviceId}`, { method: 'PUT' })
}

export async function skipNext(accessToken: string, deviceId: string): Promise<void> {
  await spotifyFetch(accessToken, `/me/player/next?device_id=${deviceId}`, { method: 'POST' })
}

/**
 * Seeks within the currently playing track — cheaper than reissuing play()
 * when only position has drifted. `forceTransfer` follows the same reasoning
 * as play() above: only re-transfer when there's actual evidence (a recent
 * device.is_active reading) that the device isn't already active — otherwise
 * this can interrupt an already-fine, already-playing device.
 */
export async function seek(accessToken: string, deviceId: string, positionMs: number, forceTransfer = true): Promise<void> {
  if (forceTransfer) await transferPlayback(accessToken, deviceId)
  const params = new URLSearchParams({ position_ms: String(Math.round(positionMs)), device_id: deviceId })
  await spotifyFetch(accessToken, `/me/player/seek?${params.toString()}`, { method: 'PUT' })
}

export async function searchTracks(accessToken: string, query: string, limit = 10): Promise<SpotifyTrackSummary[]> {
  const params = new URLSearchParams({ q: query, type: 'track', limit: String(limit) })
  const res = await spotifyFetch(accessToken, `/search?${params.toString()}`)
  const data = (await res.json()) as { tracks: { items: SpotifyTrackSummary[] } }
  return data.tracks.items
}

/** Spotify's search supports field filters — `isrc:` restricts to an exact ISRC match. */
export async function searchByIsrc(accessToken: string, isrc: string): Promise<SpotifyTrackSummary | null> {
  const results = await searchTracks(accessToken, `isrc:${isrc}`, 1)
  return results[0] ?? null
}

/** Appends a track to the end of the active device's Spotify Connect queue (Spotify's own queue, not app state). */
export async function addToQueue(accessToken: string, deviceId: string, trackUri: string): Promise<void> {
  const params = new URLSearchParams({ uri: trackUri, device_id: deviceId })
  await spotifyFetch(accessToken, `/me/player/queue?${params.toString()}`, { method: 'POST' })
}

export async function getQueue(accessToken: string): Promise<QueueState> {
  const res = await spotifyFetch(accessToken, '/me/player/queue')
  return (await res.json()) as QueueState
}
