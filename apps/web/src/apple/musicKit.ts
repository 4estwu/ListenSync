const RELAY_WS_URL = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? 'ws://127.0.0.1:8787'
const DEVELOPER_TOKEN_URL = `${RELAY_WS_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')}/apple-developer-token`
const MUSICKIT_SCRIPT_SRC = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'

function loadMusicKitScript(): Promise<void> {
  if (window.MusicKit) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = MUSICKIT_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load MusicKit JS from Apple's CDN"))
    document.head.appendChild(script)
  })
}

let configurePromise: Promise<MusicKit.MusicKitInstance> | null = null

/** Lazily loads the MusicKit script + configures it with a developer token from the relay. Idempotent. */
export function getMusicKit(): Promise<MusicKit.MusicKitInstance> {
  if (!configurePromise) {
    configurePromise = (async () => {
      await loadMusicKitScript()
      const res = await fetch(DEVELOPER_TOKEN_URL)
      if (!res.ok) throw new Error(`Failed to fetch Apple developer token: ${res.status} ${await res.text()}`)
      const { token } = (await res.json()) as { token: string }
      return MusicKit.configure({ developerToken: token, app: { name: 'Synced Listening', build: '1.0.0' } })
    })()
  }
  return configurePromise
}

/** Opens the Apple ID sign-in flow (no redirect — resolves in place) and returns the music user token. */
export async function authorizeAppleMusic(): Promise<string> {
  const music = await getMusicKit()
  return music.authorize()
}
