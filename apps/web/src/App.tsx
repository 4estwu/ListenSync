import { useCallback, useEffect, useState } from 'react'
import {
  ensureFreshToken,
  getStoredToken,
  handleRedirectCallback,
  logout,
  redirectToAuthorize,
  type SpotifyToken,
} from './spotify/auth'
import {
  getDevices,
  getPlaybackState,
  pause,
  play,
  skipNext,
  type PlaybackState,
  type SpotifyDevice,
} from './spotify/player'
import './App.css'

const DEFAULT_TRACK_URI = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT' // Never Gonna Give You Up

function App() {
  const [token, setToken] = useState<SpotifyToken | null>(null)
  const [devices, setDevices] = useState<SpotifyDevice[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [trackUri, setTrackUri] = useState(DEFAULT_TRACK_URI)
  const [playback, setPlayback] = useState<PlaybackState | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const say = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 20))
  }, [])

  useEffect(() => {
    handleRedirectCallback()
      .then((exchanged) => {
        if (exchanged) {
          setToken(exchanged)
          say('Token exchange succeeded.')
          return
        }
        const stored = getStoredToken()
        if (stored) setToken(stored)
      })
      .catch((err: Error) => say(`Auth error: ${err.message}`))
  }, [say])

  const withFreshToken = useCallback(async (): Promise<SpotifyToken> => {
    if (!token) throw new Error('Not logged in')
    const fresh = await ensureFreshToken(token)
    if (fresh !== token) setToken(fresh)
    return fresh
  }, [token])

  const refreshDevices = useCallback(async () => {
    try {
      const { accessToken } = await withFreshToken()
      const list = await getDevices(accessToken)
      setDevices(list)
      const active = list.find((d) => d.is_active)
      if (active) setDeviceId(active.id)
      else if (list[0]) setDeviceId(list[0].id)
      say(`Found ${list.length} device(s).`)
    } catch (err) {
      say(`Device fetch error: ${(err as Error).message}`)
    }
  }, [withFreshToken, say])

  const refreshPlaybackState = useCallback(async () => {
    try {
      const { accessToken } = await withFreshToken()
      const state = await getPlaybackState(accessToken)
      setPlayback(state)
    } catch (err) {
      say(`Playback state error: ${(err as Error).message}`)
    }
  }, [withFreshToken, say])

  useEffect(() => {
    if (token) {
      refreshDevices()
      refreshPlaybackState()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const runAction = async (label: string, action: (accessToken: string) => Promise<void>) => {
    if (!deviceId) {
      say('No device selected — click "Refresh devices" and make sure Spotify is open somewhere.')
      return
    }
    setBusy(true)
    try {
      const { accessToken } = await withFreshToken()
      await action(accessToken)
      say(`${label} OK`)
      setTimeout(refreshPlaybackState, 500)
    } catch (err) {
      say(`${label} failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <section id="center">
        <h1>Spotify auth test</h1>
        <p>Authorization Code + PKCE, solo — no relay/sync involved.</p>
        <button type="button" onClick={() => void redirectToAuthorize()}>
          Log in with Spotify
        </button>
      </section>
    )
  }

  return (
    <section id="center" style={{ textAlign: 'left', maxWidth: 480, margin: '0 auto' }}>
      <h1>Spotify player test</h1>
      <p>
        Logged in.{' '}
        <button
          type="button"
          onClick={() => {
            logout()
            setToken(null)
          }}
        >
          Log out
        </button>
      </p>

      <div>
        <button type="button" onClick={() => void refreshDevices()}>
          Refresh devices
        </button>
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          <option value="">— select device —</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.type}){d.is_active ? ' — active' : ''}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        <input
          style={{ width: '100%' }}
          value={trackUri}
          onChange={(e) => setTrackUri(e.target.value)}
          placeholder="spotify:track:..."
        />
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button disabled={busy} type="button" onClick={() => runAction('Play', (t) => play(t, deviceId, trackUri))}>
          Play
        </button>
        <button disabled={busy} type="button" onClick={() => runAction('Pause', (t) => pause(t, deviceId))}>
          Pause
        </button>
        <button disabled={busy} type="button" onClick={() => runAction('Skip', (t) => skipNext(t, deviceId))}>
          Skip
        </button>
        <button disabled={busy} type="button" onClick={() => void refreshPlaybackState()}>
          Refresh state
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Current playback:</strong>
        <pre>
          {playback
            ? `${playback.is_playing ? 'playing' : 'paused'} — ${
                playback.item ? `${playback.item.name} by ${playback.item.artists.map((a) => a.name).join(', ')}` : 'no item'
              } on ${playback.device.name}`
            : 'nothing active'}
        </pre>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Log:</strong>
        <pre>{log.join('\n')}</pre>
      </div>
    </section>
  )
}

export default App
