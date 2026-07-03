import type { AdapterPlaybackState, AdapterTrackResult, PlaybackAdapter } from './adapter'

/**
 * UNVERIFIED — written from @lomray/react-native-apple-music's documented
 * API surface, not runtime-tested. Real constraint worth repeating here:
 * MusicKit does not work in the iOS Simulator at all — this can only be
 * tested on an actual device with an Apple Music subscription. iOS only for
 * now; see MOBILE_V2_PLAN.md's platform matrix for why Android Apple Music
 * is a separate, later phase (Apple's official Android MusicKit SDK exists,
 * but no maintained React Native wrapper does).
 */
export function createAppleMusicAdapter(): PlaybackAdapter {
  return {
    platform: 'apple',

    async getState(): Promise<AdapterPlaybackState | null> {
      // TODO(native): AppleMusic.getPlaybackState() or equivalent.
      throw new Error('createAppleMusicAdapter.getState: not yet implemented — see TODO(native) comments in this file')
    },

    async play(_platformId?: string, _positionMs?: number): Promise<void> {
      // TODO(native): AppleMusic.play({ catalogId, positionMs }) or equivalent.
      throw new Error('createAppleMusicAdapter.play: not yet implemented')
    },

    async pause(): Promise<void> {
      // TODO(native): AppleMusic.pause() or equivalent.
      throw new Error('createAppleMusicAdapter.pause: not yet implemented')
    },

    async seek(_positionMs: number): Promise<void> {
      // TODO(native): AppleMusic.seek(positionMs) or equivalent.
      throw new Error('createAppleMusicAdapter.seek: not yet implemented')
    },

    async search(_query: string): Promise<AdapterTrackResult[]> {
      // TODO(native): catalog search via the library's search method, or
      // fall back to the same Apple Music API HTTP call apps/web's
      // apple/player.ts already makes with a developer token from the relay.
      throw new Error('createAppleMusicAdapter.search: not yet implemented')
    },

    async resolveByIsrc(_isrc: string): Promise<string | null> {
      throw new Error('createAppleMusicAdapter.resolveByIsrc: not yet implemented')
    },

    // No enqueueUpcoming — deliberately omitted (optional on the interface).
    // Whether MusicKit's native library exposes an equivalent native queue
    // is unconfirmed; until verified, leave this adapter without it rather
    // than guess at an API that might not exist. Same honest gap as Apple
    // Music has on the web app today.
  }
}
