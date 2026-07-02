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
  return {
    platform: 'spotify',

    async getState() {
      const token = await getAccessToken()
      const state = await spotifyPlayer.getPlaybackState(token)
      if (!state) {
        // 204 from Spotify = nothing currently loaded on any device — normal
        // for a freshly-selected device, NOT a poll failure. Returning null
        // here would make useRoomSync treat it as "poll failed, skip this
        // tick," which means a device that's never played anything could
        // never be told to start (reconciliation bails before ever calling
        // adapter.play()).
        return { isPlaying: false, positionMs: 0, durationMs: null, platformId: null }
      }
      return {
        isPlaying: state.is_playing,
        positionMs: state.progress_ms ?? 0,
        durationMs: state.item?.duration_ms ?? null,
        platformId: state.item?.uri ?? null,
      }
    },

    async play(platformId, positionMs) {
      const token = await getAccessToken()
      await spotifyPlayer.play(token, getDeviceId(), platformId, positionMs)
    },

    async pause() {
      const token = await getAccessToken()
      await spotifyPlayer.pause(token, getDeviceId())
    },

    async seek(positionMs) {
      const token = await getAccessToken()
      await spotifyPlayer.seek(token, getDeviceId(), positionMs)
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
