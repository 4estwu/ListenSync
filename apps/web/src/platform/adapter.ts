import type { Platform } from '@spotifyapple/shared'
import * as spotifyPlayer from '../spotify/player'
import * as applePlayer from '../apple/player'
import { subscribeToPlaybackDiagnostics } from '../spotify/webPlayback'

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

/**
 * Platform-agnostic wrapper around a lost/expired playback device (see
 * SpotifyDeviceError in spotify/player.ts — Apple's adapter never throws
 * this today, but callers in useRoomSync shouldn't need to know which
 * platform they're talking to).
 */
export class AdapterDeviceError extends Error {}

export interface PlaybackAdapter {
  platform: Platform
  getState(): Promise<AdapterPlaybackState | null>
  /** Omitting platformId resumes/repositions whatever's already loaded rather than starting a new track. */
  play(platformId?: string, positionMs?: number): Promise<void>
  pause(): Promise<void>
  seek(positionMs: number): Promise<void>
  search(query: string): Promise<AdapterTrackResult[]>
  resolveByIsrc(isrc: string): Promise<string | null>
  /** Optional: platform-specific diagnostic events (local SDK errors, buffering stalls) surfaced for logging. */
  onDiagnostic?(cb: (message: string) => void): void
  /**
   * Optional: mirrors upcoming tracks into this platform's own native queue,
   * so playback started here can keep advancing through them even if this
   * tab stops running (backgrounded/killed) before they'd otherwise play.
   * Only Spotify Connect has a server-side queue we can push into this way —
   * Apple's MusicKit JS plays directly within this tab's own JS/audio
   * context, so there's no separate session to keep going without it; that
   * limitation isn't something a web app can work around.
   */
  enqueueUpcoming?(platformIds: string[]): Promise<void>
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
  // Updated from the most recent getState() poll's device.is_active. Used to
  // decide whether play()/seek() actually need to re-transfer the device —
  // doing it unconditionally "to be safe" turned out to be its own bug: it
  // can interrupt the Web Playback SDK's in-flight buffering/loading,
  // producing a buffering-start/end/playback_error loop every time a
  // correction fired against a device that was already fine. Starts false so
  // the very first play() (a device that's never been used this session)
  // still transfers.
  let deviceConfirmedActive = false

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

    async search(query) {
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

    onDiagnostic(cb) {
      subscribeToPlaybackDiagnostics(cb)
    },

    async enqueueUpcoming(platformIds) {
      const token = await getAccessToken()
      const deviceId = getDeviceId()
      // Sequential, not Promise.all — Spotify's queue endpoint appends in
      // call order, and concurrent requests would race for that order.
      // Best-effort: one track failing (e.g. a transient error) shouldn't
      // abort the rest.
      for (const platformId of platformIds) {
        await withRateLimit(() => spotifyPlayer.addToQueue(token, deviceId, platformId)).catch(() => undefined)
      }
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
