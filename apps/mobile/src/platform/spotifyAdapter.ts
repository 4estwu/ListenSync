import type { AdapterPlaybackState, AdapterTrackResult, PlaybackAdapter } from './adapter'

/**
 * UNVERIFIED — written from @wwdrew/expo-spotify-sdk's documented API
 * surface, not runtime-tested (no device/simulator available in this
 * environment). Every SpotifySdk.* call below needs checking against the
 * actual installed package's exports before trusting it; treat method names
 * as "this is the shape to expect," not confirmed fact. Real device testing
 * against a Spotify Premium account is required before this can be trusted.
 *
 * Architecturally this replaces apps/web's REST-polling Spotify adapter
 * (getPlaybackState/play/pause/seek over fetch()) with the native App Remote
 * SDK's connection — the actual point of going native: App Remote has a real
 * connect/disconnect/reconnect lifecycle instead of our own 429 handling and
 * "is this device still there" polling logic. Once wired up for real, most
 * of apps/web's spotify/player.ts's rate-limit/backoff machinery likely
 * isn't needed here — App Remote doesn't have the same per-app REST rate
 * limit apps/web works around, since it isn't hitting the same REST API.
 */
export function createSpotifyAdapter(): PlaybackAdapter {
  return {
    platform: 'spotify',

    async getState(): Promise<AdapterPlaybackState | null> {
      // TODO(native): SpotifySdk.getPlayerState() or equivalent — confirm
      // exact export name/shape once the package is actually installed and
      // its types are inspectable.
      throw new Error('createSpotifyAdapter.getState: not yet implemented — see TODO(native) comments in this file')
    },

    async play(_platformId?: string, _positionMs?: number): Promise<void> {
      // TODO(native): SpotifySdk.play({ uri, positionMs }) or equivalent.
      throw new Error('createSpotifyAdapter.play: not yet implemented')
    },

    async pause(): Promise<void> {
      // TODO(native): SpotifySdk.pause() or equivalent.
      throw new Error('createSpotifyAdapter.pause: not yet implemented')
    },

    async seek(_positionMs: number): Promise<void> {
      // TODO(native): SpotifySdk.seek(positionMs) or equivalent.
      throw new Error('createSpotifyAdapter.seek: not yet implemented')
    },

    async search(_query: string): Promise<AdapterTrackResult[]> {
      // TODO(native): App Remote's SDK is primarily playback control, not
      // catalog search — this likely still needs to go over the regular
      // Spotify Web API (same /search endpoint apps/web's spotify/player.ts
      // already calls), using a token from the SDK's auth flow. Not an App
      // Remote call.
      throw new Error('createSpotifyAdapter.search: not yet implemented')
    },

    async resolveByIsrc(_isrc: string): Promise<string | null> {
      // TODO(native): same Web API /search?q=isrc:... approach as apps/web's
      // searchByIsrc, not an App Remote call.
      throw new Error('createSpotifyAdapter.resolveByIsrc: not yet implemented')
    },

    async enqueueUpcoming(_platformIds: string[]): Promise<void> {
      // TODO(native): mirrors apps/web's enqueueUpcoming (see
      // apps/web/src/platform/adapter.ts) — pushes upcoming tracks into
      // Spotify's own native queue so playback can keep advancing if this
      // app is backgrounded. Same /me/player/queue Web API call, or an App
      // Remote equivalent if one exists — needs checking.
      throw new Error('createSpotifyAdapter.enqueueUpcoming: not yet implemented')
    },
  }
}
