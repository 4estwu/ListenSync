export {}

// Minimal surface of MusicKit JS v3 actually used by this app. The SDK is
// CDN-loaded as a global (see musicKit.ts), not an npm package — third-party
// type packages for v3 are unreliable, so this stays hand-written and scoped.
declare global {
  interface Window {
    MusicKit?: typeof MusicKit
  }

  namespace MusicKit {
    interface Config {
      developerToken: string
      app: { name: string; build: string }
    }

    interface MediaItem {
      id: string
      /** Seconds, not ms — converted to ms at the adapter boundary. */
      playbackDuration: number
    }

    interface MusicKitInstance {
      isAuthorized: boolean
      storefrontId: string
      musicUserToken: string
      // Playback state/controls live directly on the instance, not under a
      // nested `.player` — that's a common assumption from other SDKs
      // (Spotify's Web Playback SDK does nest under `.player`) but MusicKit
      // JS doesn't.
      isPlaying: boolean
      /** Seconds, not ms. */
      currentPlaybackTime: number
      nowPlayingItem: MediaItem | null
      play(): Promise<void>
      pause(): Promise<void>
      seekToTime(time: number): Promise<void>
      api: {
        music<T = unknown>(path: string, params?: Record<string, unknown>): Promise<{ data: T }>
      }
      authorize(): Promise<string>
      setQueue(options: { song: string; startPlaying?: boolean }): Promise<unknown>
    }

    function configure(config: Config): Promise<MusicKitInstance>
    function getInstance(): MusicKitInstance
  }
}
