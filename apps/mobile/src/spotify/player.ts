// Search only. Playback control (play/pause/seek/skip/queue/state) moved to
// spotify/appRemotePlayer.ts, backed by @wwdrew/expo-spotify-sdk's App
// Remote API (v1.0.0+, upgraded 2026-07-20 — see auth.ts's comment for the
// SDK-lane investigation). App Remote has no catalog search of its own
// (`Content.*` browses recommendations/library, not arbitrary text search),
// so this still goes over the plain Spotify Web API REST search endpoint,
// same as before.
const API_BASE = 'https://api.spotify.com/v1'

export interface SpotifyTrackSummary {
  uri: string
  name: string
  artists: { name: string }[]
  album: { name: string; images: { url: string }[] }
  duration_ms: number
  external_ids?: { isrc?: string }
}

/** Spotify enforces rate limits per app (client_id), aggregated across every user authenticated through it — not per-user. */
export class SpotifyRateLimitError extends Error {
  retryAfterMs: number
  constructor(retryAfterMs: number) {
    super(`Spotify API rate limit exceeded, retry after ${retryAfterMs}ms`)
    this.retryAfterMs = retryAfterMs
  }
}

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
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify API ${res.status} ${path}: ${await res.text()}`)
  }
  return res
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
