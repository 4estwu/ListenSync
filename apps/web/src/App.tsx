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
  addToQueue,
  getDevices,
  getPlaybackState,
  getQueue,
  pause,
  play,
  searchTracks,
  skipNext,
  type PlaybackState,
  type QueueState,
  type SpotifyDevice,
  type SpotifyTrackSummary,
} from './spotify/player'
import './App.css'

function trackLabel(track: SpotifyTrackSummary | null): string {
  if (!track) return 'no item'
  return `${track.name} — ${track.artists.map((a) => a.name).join(', ')}`
}

function App() {
  const [token, setToken] = useState<SpotifyToken | null>(null)
  const [devices, setDevices] = useState<SpotifyDevice[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [playback, setPlayback] = useState<PlaybackState | null>(null)
  const [queue, setQueue] = useState<QueueState | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SpotifyTrackSummary[]>([])
  const [searching, setSearching] = useState(false)

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

  const refreshQueue = useCallback(async () => {
    try {
      const { accessToken } = await withFreshToken()
      setQueue(await getQueue(accessToken))
    } catch (err) {
      say(`Queue fetch error: ${(err as Error).message}`)
    }
  }, [withFreshToken, say])

  useEffect(() => {
    if (token) {
      refreshDevices()
      refreshPlaybackState()
      refreshQueue()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Debounced search — fires 300ms after typing stops.
  useEffect(() => {
    if (!token || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    const handle = setTimeout(async () => {
      setSearching(true)
      try {
        const { accessToken } = await withFreshToken()
        setSearchResults(await searchTracks(accessToken, searchQuery))
      } catch (err) {
        say(`Search error: ${(err as Error).message}`)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [searchQuery, token, withFreshToken, say])

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
      setTimeout(() => {
        refreshPlaybackState()
        refreshQueue()
      }, 500)
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
    <section id="center" style={{ textAlign: 'left', maxWidth: 560, margin: '0 auto' }}>
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

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button disabled={busy} type="button" onClick={() => runAction('Pause', (t) => pause(t, deviceId))}>
          Pause
        </button>
        <button disabled={busy} type="button" onClick={() => runAction('Skip', (t) => skipNext(t, deviceId))}>
          Skip
        </button>
        <button
          disabled={busy}
          type="button"
          onClick={() => {
            void refreshPlaybackState()
            void refreshQueue()
          }}
        >
          Refresh state
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Current playback:</strong>
        <pre>
          {playback
            ? `${playback.is_playing ? 'playing' : 'paused'} — ${trackLabel(playback.item)} on ${playback.device.name}`
            : 'nothing active'}
        </pre>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Search tracks</strong>
        <input
          style={{ width: '100%', marginTop: 4 }}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by title, artist..."
        />
        {searching && <p>Searching…</p>}
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 8 }}>
          {searchResults.map((track) => (
            <li
              key={track.uri}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #333' }}
            >
              {track.album.images.at(-1) && (
                <img src={track.album.images.at(-1)!.url} alt="" width={32} height={32} />
              )}
              <span style={{ flex: 1 }}>{trackLabel(track)}</span>
              <button
                disabled={busy}
                type="button"
                onClick={() => runAction(`Play "${track.name}"`, (t) => play(t, deviceId, track.uri))}
              >
                Play
              </button>
              <button
                disabled={busy}
                type="button"
                onClick={() => runAction(`Queue "${track.name}"`, (t) => addToQueue(t, deviceId, track.uri))}
              >
                + Queue
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Up next (Spotify's device queue):</strong>
        <ol>
          {queue?.queue.map((track, i) => (
            <li key={`${track.uri}-${i}`}>{trackLabel(track)}</li>
          ))}
        </ol>
        {queue && queue.queue.length === 0 && <p>Queue is empty.</p>}
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Log:</strong>
        <pre>{log.join('\n')}</pre>
      </div>
    </section>
  )
}

export default App
