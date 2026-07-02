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

    class Player {
      constructor(options: PlayerInit)
      connect(): Promise<boolean>
      disconnect(): void
      addListener(event: 'ready' | 'not_ready', callback: (data: { device_id: string }) => void): void
      addListener(
        event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
        callback: (data: WebPlaybackError) => void,
      ): void
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
