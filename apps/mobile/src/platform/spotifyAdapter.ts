import type { AdapterPlaybackState, AdapterTrackResult, PlaybackAdapter } from './adapter'
import * as appRemote from '../spotify/appRemotePlayer'
import * as spotifyPlayer from '../spotify/player'

// Playback control goes through App Remote (spotify/appRemotePlayer.ts),
// controlling the Spotify app already running on this device directly — no
// external-device concept at all, unlike the REST-based version this
// replaced (see git history for that version's device-transfer/rate-limit
// reasoning, still relevant background if App Remote is ever unavailable).
// Search still hits the plain Web API (spotify/player.ts) since App Remote
// has no arbitrary catalog search of its own.
interface SpotifyAdapterDeps {
  getAccessToken: () => Promise<string>
}

export function createSpotifyAdapter({ getAccessToken }: SpotifyAdapterDeps): PlaybackAdapter {
  return {
    platform: 'spotify',

    async getState(): Promise<AdapterPlaybackState | null> {
      const state = await appRemote.getState(getAccessToken)
      return state
        ? { isPlaying: state.isPlaying, positionMs: state.positionMs, durationMs: state.durationMs, platformId: state.platformId }
        : { isPlaying: false, positionMs: 0, durationMs: null, platformId: null }
    },

    async play(platformId, positionMs) {
      await appRemote.play(getAccessToken, platformId, positionMs)
    },

    async pause() {
      await appRemote.pause(getAccessToken)
    },

    async seek(positionMs) {
      await appRemote.seek(getAccessToken, positionMs)
    },

    async search(query): Promise<AdapterTrackResult[]> {
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

    async enqueueUpcoming(platformIds) {
      // Sequential, not concurrent — App Remote's queue appends in call
      // order, same reasoning as the REST version this replaced. Best-
      // effort: one track failing shouldn't abort the rest.
      for (const platformId of platformIds) {
        await appRemote.queue(getAccessToken, platformId).catch(() => undefined)
      }
    },
  }
}
