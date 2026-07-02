import type { Platform } from '@spotifyapple/shared'
import * as spotifyPlayer from '../spotify/player'
import * as applePlayer from '../apple/player'

export interface AdapterTrackResult {
  title: string
  artist: string
  durationMs: number
  isrc?: string
  platformId: string
  artworkUrl?: string
}

export interface AdapterPlaybackState {
  isPlaying: boolean
  positionMs: number
  durationMs: number | null
  /** This platform's own id/uri for whatever's currently loaded, or null if nothing is. */
  platformId: string | null
}

export interface PlaybackAdapter {
  platform: Platform
  getState(): Promise<AdapterPlaybackState | null>
  /** Omitting platformId resumes/repositions whatever's already loaded rather than starting a new track. */
  play(platformId?: string, positionMs?: number): Promise<void>
  pause(): Promise<void>
  seek(positionMs: number): Promise<void>
  search(query: string): Promise<AdapterTrackResult[]>
  resolveByIsrc(isrc: string): Promise<string | null>
}

interface SpotifyAdapterDeps {
  getAccessToken: () => Promise<string>
  getDeviceId: () => string
}

export function createSpotifyAdapter({ getAccessToken, getDeviceId }: SpotifyAdapterDeps): PlaybackAdapter {
  // Spotify's rate limit is per-app, shared across every user authenticated
  // through this client_id — with multiple Spotify clients in a room all
  // polling once a second, it's realistic to hit it. On a 429, back off for
  // however long Spotify says (Retry-After) and just keep answering with the
  // last known state instead of erroring every tick, so a temporary rate
  // limit doesn't look like a poll failure or block reconciliation from
  // seeing a coherent state.
  let cachedState: AdapterPlaybackState = { isPlaying: false, positionMs: 0, durationMs: null, platformId: null }
  let blockedUntil = 0

  // All Spotify calls go through here so a 429 anywhere (not just getState)
  // sets the shared backoff, and every call checks it first — attempting a
  // play/pause/seek while we already know we're rate-limited just wastes a
  // doomed request and can extend the block further.
  async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    if (Date.now() < blockedUntil) {
      throw new spotifyPlayer.SpotifyRateLimitError(blockedUntil - Date.now())
    }
    try {
      return await fn()
    } catch (err) {
      if (err instanceof spotifyPlayer.SpotifyRateLimitError) blockedUntil = Date.now() + err.retryAfterMs
      throw err
    }
  }

  return {
    platform: 'spotify',

    async getState() {
      if (Date.now() < blockedUntil) return cachedState
      try {
        const state = await withRateLimit(async () => spotifyPlayer.getPlaybackState(await getAccessToken()))
        cachedState = state
          ? {
              isPlaying: state.is_playing,
              positionMs: state.progress_ms ?? 0,
              durationMs: state.item?.duration_ms ?? null,
              platformId: state.item?.uri ?? null,
            }
          // 204 from Spotify = nothing currently loaded on any device — normal
          // for a freshly-selected device, NOT a poll failure. Treating it as
          // one (returning null) would make useRoomSync skip the tick, which
          // means a device that's never played anything could never be told
          // to start (reconciliation bails before ever calling adapter.play()).
          : { isPlaying: false, positionMs: 0, durationMs: null, platformId: null }
        return cachedState
      } catch (err) {
        if (err instanceof spotifyPlayer.SpotifyRateLimitError) return cachedState
        throw err
      }
    },

    async play(platformId, positionMs) {
      await withRateLimit(async () => {
        const token = await getAccessToken()
        await spotifyPlayer.play(token, getDeviceId(), platformId, positionMs)
      })
    },

    async pause() {
      await withRateLimit(async () => {
        const token = await getAccessToken()
        await spotifyPlayer.pause(token, getDeviceId())
      })
    },

    async seek(positionMs) {
      await withRateLimit(async () => {
        const token = await getAccessToken()
        await spotifyPlayer.seek(token, getDeviceId(), positionMs)
      })
    },

    async search(query) {
      const token = await getAccessToken()
      const results = await spotifyPlayer.searchTracks(token, query)
      return results.map((t) => ({
        title: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        durationMs: t.duration_ms,
        isrc: t.external_ids?.isrc,
        platformId: t.uri,
        artworkUrl: t.album.images.at(-1)?.url,
      }))
    },

    async resolveByIsrc(isrc) {
      const token = await getAccessToken()
      const result = await spotifyPlayer.searchByIsrc(token, isrc)
      return result?.uri ?? null
    },
  }
}

export function createAppleAdapter(music: MusicKit.MusicKitInstance): PlaybackAdapter {
  return {
    platform: 'apple',

    async getState() {
      const state = applePlayer.getPlaybackState(music)
      return {
        isPlaying: state.isPlaying,
        positionMs: state.positionMs,
        durationMs: state.durationMs,
        platformId: state.catalogId,
      }
    },

    async play(platformId, positionMs) {
      await applePlayer.play(music, platformId, positionMs)
    },

    async pause() {
      await applePlayer.pause(music)
    },

    async seek(positionMs) {
      await applePlayer.seek(music, positionMs)
    },

    async search(query) {
      const results = await applePlayer.searchTracks(music, query)
      return results.map((t) => ({
        title: t.name,
        artist: t.artist,
        durationMs: t.durationMs,
        isrc: t.isrc,
        platformId: t.id,
        artworkUrl: t.artworkUrl,
      }))
    },

    async resolveByIsrc(isrc) {
      const result = await applePlayer.lookupByIsrc(music, isrc)
      return result?.id ?? null
    },
  }
}
