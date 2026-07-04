import type { AdapterPlaybackState, AdapterTrackResult, PlaybackAdapter } from './adapter'
import { AdapterDeviceError } from './adapter'
import * as spotifyPlayer from '../spotify/player'

// Port of apps/web/src/platform/adapter.ts's createSpotifyAdapter — same
// rate-limit/backoff logic, same device-transfer reasoning (see
// spotify/player.ts's doc comments), just REST calls instead of App Remote
// (see spotify/player.ts's top comment for why: the installed native SDK
// wrapper only does auth, not playback control).
interface SpotifyAdapterDeps {
  getAccessToken: () => Promise<string>
  getDeviceId: () => string
}

export function createSpotifyAdapter({ getAccessToken, getDeviceId }: SpotifyAdapterDeps): PlaybackAdapter {
  // Spotify's rate limit is per-app, shared across every user authenticated
  // through this client_id — with multiple clients in a room all polling,
  // it's realistic to hit it. On a 429, back off for however long Spotify
  // says (Retry-After) and keep answering with the last known state instead
  // of erroring every tick.
  let cachedState: AdapterPlaybackState = { isPlaying: false, positionMs: 0, durationMs: null, platformId: null }
  let blockedUntil = 0
  // Updated from the most recent getState() poll's device.is_active. Used to
  // decide whether play()/seek() actually need to re-transfer the device —
  // doing it unconditionally "to be safe" is itself a bug on the web side
  // (interrupts in-flight SDK buffering); kept here for parity even though
  // this app has no in-tab player of its own to interrupt, since the same
  // "don't re-transfer an already-active device" reasoning still reduces
  // unnecessary calls against an external device too.
  let deviceConfirmedActive = false

  async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    if (Date.now() < blockedUntil) {
      throw new spotifyPlayer.SpotifyRateLimitError(blockedUntil - Date.now())
    }
    try {
      return await fn()
    } catch (err) {
      if (err instanceof spotifyPlayer.SpotifyRateLimitError) blockedUntil = Date.now() + err.retryAfterMs
      if (err instanceof spotifyPlayer.SpotifyDeviceError) throw new AdapterDeviceError(err.message)
      throw err
    }
  }

  return {
    platform: 'spotify',

    async getState() {
      if (Date.now() < blockedUntil) return cachedState
      try {
        const state = await withRateLimit(async () => spotifyPlayer.getPlaybackState(await getAccessToken()))
        deviceConfirmedActive = state !== null && state.device.id === getDeviceId() && state.device.is_active
        cachedState = state
          ? {
              isPlaying: state.is_playing,
              positionMs: state.progress_ms ?? 0,
              durationMs: state.item?.duration_ms ?? null,
              platformId: state.item?.uri ?? null,
            }
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
        await spotifyPlayer.play(token, getDeviceId(), platformId, positionMs, !deviceConfirmedActive)
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
        await spotifyPlayer.seek(token, getDeviceId(), positionMs, !deviceConfirmedActive)
      })
    },

    async search(query): Promise<AdapterTrackResult[]> {
      return withRateLimit(async () => {
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
      })
    },

    async resolveByIsrc(isrc) {
      return withRateLimit(async () => {
        const token = await getAccessToken()
        const result = await spotifyPlayer.searchByIsrc(token, isrc)
        return result?.uri ?? null
      })
    },

    async enqueueUpcoming(platformIds) {
      const token = await getAccessToken()
      const deviceId = getDeviceId()
      // Sequential, not concurrent — Spotify's queue endpoint appends in call
      // order, and concurrent requests would race for that order. Best-
      // effort: one track failing shouldn't abort the rest.
      for (const platformId of platformIds) {
        await withRateLimit(() => spotifyPlayer.addToQueue(token, deviceId, platformId)).catch(() => undefined)
      }
    },
  }
}
