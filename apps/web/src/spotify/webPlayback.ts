export {}

// Minimal surface of the Spotify Web Playback SDK actually used here. CDN-loaded
// as a global (like MusicKit), not an npm package.
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void
    Spotify?: typeof Spotify
  }

  namespace Spotify {
    interface PlayerInit {
      name: string
      getOAuthToken: (callback: (token: string) => void) => void
      volume?: number
    }

    interface WebPlaybackError {
      message: string
    }

    interface WebPlaybackState {
      paused: boolean
      /** ms */
      position: number
      /** ms */
      duration: number
      /** True while the SDK is buffering/loading — the direct signal for a stall, distinct from is_playing lagging behind reality. */
      loading: boolean
    }

    class Player {
      constructor(options: PlayerInit)
      connect(): Promise<boolean>
      disconnect(): void
      addListener(event: 'ready' | 'not_ready', callback: (data: { device_id: string }) => void): void
      addListener(
        event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
        callback: (data: WebPlaybackError) => void,
      ): void
      addListener(event: 'player_state_changed', callback: (state: WebPlaybackState | null) => void): void
    }
  }
}

const SDK_SCRIPT_SRC = 'https://sdk.scdn.co/spotify-player.js'

function loadSdkScript(): Promise<void> {
  if (window.Spotify) return Promise.resolve()
  return new Promise((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    const script = document.createElement('script')
    script.src = SDK_SCRIPT_SRC
    script.async = true
    document.head.appendChild(script)
  })
}

let connectPromise: Promise<string> | null = null
let cachedPlayer: Spotify.Player | null = null
let diagnosticsSubscribed = false

/**
 * Registers an in-browser Spotify Connect device (this tab) and resolves with
 * its device_id once ready — from there it's just another device to the
 * existing play/pause/seek/transferPlayback functions, same as an external
 * one. Idempotent; requires Spotify Premium (same requirement Connect device
 * control already has).
 */
export function connectWebPlaybackDevice(getAccessToken: () => Promise<string>): Promise<string> {
  if (!connectPromise) {
    connectPromise = (async () => {
      await loadSdkScript()
      const player = new Spotify.Player({
        name: 'Synced Listening (this tab)',
        getOAuthToken: (callback) => {
          void getAccessToken().then(callback)
        },
        volume: 0.5,
      })
      cachedPlayer = player

      const deviceId = await new Promise<string>((resolve, reject) => {
        player.addListener('ready', ({ device_id }) => resolve(device_id))
        player.addListener('initialization_error', ({ message }) => reject(new Error(`Spotify player init error: ${message}`)))
        player.addListener('authentication_error', ({ message }) => reject(new Error(`Spotify auth error: ${message}`)))
        player.addListener('account_error', ({ message }) => reject(new Error(`Spotify account error (Premium required): ${message}`)))
        void player.connect()
      })

      return deviceId
    })()
  }
  return connectPromise
}

/**
 * Surfaces the SDK's own diagnostic events for logging — these are direct
 * signals from this tab's local player, not inferred from REST polling, and
 * were previously completely unwired: `not_ready` (device went unavailable),
 * `playback_error` (the SDK's own pipeline errored), and `loading` from
 * `player_state_changed` (a genuine buffering stall, vs. is_playing simply
 * lagging reality). Only meaningful when this client is actually using the
 * in-tab Web Playback SDK device rather than an external one; a no-op if the
 * SDK was never connected. Idempotent — attaching listeners a second time
 * would fire every event twice (this is exactly what happened when the
 * calling effect had no cleanup and ran twice under React StrictMode's
 * dev-mode double-invoke).
 */
export function subscribeToPlaybackDiagnostics(onEvent: (message: string) => void): void {
  const player = cachedPlayer
  if (!player || diagnosticsSubscribed) return
  diagnosticsSubscribed = true

  player.addListener('not_ready', ({ device_id }) => {
    onEvent(`Spotify SDK: this device went not-ready (${device_id.slice(0, 8)}…) — the tab's local player reports itself unavailable`)
  })
  player.addListener('playback_error', ({ message }) => {
    onEvent(`Spotify SDK playback error: ${message}`)
  })

  let lastLoading: boolean | null = null
  player.addListener('player_state_changed', (state) => {
    if (!state) {
      onEvent('Spotify SDK: player_state_changed fired with no state (nothing loaded)')
      return
    }
    if (state.loading !== lastLoading) {
      lastLoading = state.loading
      onEvent(
        `Spotify SDK: ${state.loading ? 'buffering started' : 'buffering ended'} (paused=${state.paused}, position=${Math.round(state.position)}ms)`,
      )
    }
  })
}
