import { useCallback, useEffect, useRef, useState } from 'react'
import type { Track } from '@spotifyapple/shared'
import { ensureFreshToken, type SpotifyToken } from './spotify/auth'
import {
  getDevices,
  searchTracks,
  type SpotifyDevice,
  type SpotifyTrackSummary,
} from './spotify/player'
import { useRoomSync } from './sync/useRoomSync'

function toSharedTrack(t: SpotifyTrackSummary): Track {
  return {
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    durationMs: t.duration_ms,
    platformIds: { spotify: t.uri },
    // TODO: populate platformIds.apple / isrc once Apple Music search exists
  }
}

interface RoomViewProps {
  roomId: string
  token: SpotifyToken
  setToken: (token: SpotifyToken) => void
}

function RoomView({ roomId, token, setToken }: RoomViewProps) {
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])

  const getToken = useCallback(async () => {
    const fresh = await ensureFreshToken(tokenRef.current)
    if (fresh !== tokenRef.current) {
      tokenRef.current = fresh
      setToken(fresh)
    }
    return fresh
  }, [setToken])

  const [devices, setDevices] = useState<SpotifyDevice[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SpotifyTrackSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const say = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 30))
  }, [])

  const { clientId, roomState, addToQueue, gotoIndex, skipNext, pause, resume } = useRoomSync({
    roomId,
    deviceId,
    getToken,
    onLog: say,
  })

  const refreshDevices = useCallback(async () => {
    try {
      const t = await getToken()
      const list = await getDevices(t.accessToken)
      setDevices(list)
      const active = list.find((d) => d.is_active)
      if (active) setDeviceId(active.id)
      else if (list[0]) setDeviceId(list[0].id)
      say(`Found ${list.length} device(s).`)
    } catch (err) {
      say(`Device fetch error: ${(err as Error).message}`)
    }
  }, [getToken, say])

  useEffect(() => {
    void refreshDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    const handle = setTimeout(async () => {
      setSearching(true)
      try {
        const t = await getToken()
        setSearchResults(await searchTracks(t.accessToken, searchQuery))
      } catch (err) {
        say(`Search error: ${(err as Error).message}`)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [searchQuery, getToken, say])

  const shareLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`

  const copyShareLink = () => {
    navigator.clipboard
      .writeText(shareLink)
      .then(() => {
        setLinkCopied(true)
        setTimeout(() => setLinkCopied(false), 2000)
      })
      .catch((err: Error) => say(`Clipboard error: ${err.message}`))
  }

  const current = roomState && roomState.currentIndex >= 0 ? roomState.queue[roomState.currentIndex] : null

  return (
    <section id="center" style={{ textAlign: 'left', maxWidth: 560, margin: '0 auto' }}>
      <h1>Listening room {roomId}</h1>
      <p>
        Everyone here can search, queue, play, pause, and skip — it's a shared session.{' '}
        {clientId && <code style={{ opacity: 0.6 }}>{clientId.slice(0, 8)}</code>}
      </p>

      <div>
        <button type="button" onClick={copyShareLink}>
          {linkCopied ? 'Copied!' : 'Copy share link'}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
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
        {devices.length === 0 && (
          <p style={{ opacity: 0.7 }}>
            No devices found — open Spotify on a phone/desktop app first (it needs to have been active recently),
            then click "Refresh devices".
          </p>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Now playing:</strong>
        <pre>
          {current
            ? `${roomState?.isPlaying ? 'playing' : 'paused'} — ${current.track.title} by ${current.track.artist}`
            : 'nothing yet — add a track and start playback'}
        </pre>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={roomState?.isPlaying ? pause : resume} disabled={!current}>
            {roomState?.isPlaying ? 'Pause' : 'Resume'}
          </button>
          <button type="button" onClick={skipNext} disabled={!roomState || roomState.currentIndex + 1 >= roomState.queue.length}>
            Skip
          </button>
        </div>
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
              {track.album.images.at(-1) && <img src={track.album.images.at(-1)!.url} alt="" width={32} height={32} />}
              <span style={{ flex: 1 }}>
                {track.name} — {track.artists.map((a) => a.name).join(', ')}
              </span>
              <button
                type="button"
                onClick={() => {
                  addToQueue(toSharedTrack(track), clientId ?? 'unknown')
                  say(`Added "${track.name}" to the queue`)
                }}
              >
                + Queue
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Queue:</strong>
        <ol>
          {roomState?.queue.map((item, i) => (
            <li key={item.id} style={{ fontWeight: i === roomState.currentIndex ? 'bold' : 'normal' }}>
              {item.track.title} — {item.track.artist}{' '}
              {i !== roomState.currentIndex && (
                <button type="button" onClick={() => gotoIndex(i)}>
                  Play
                </button>
              )}
            </li>
          ))}
        </ol>
        {roomState && roomState.queue.length === 0 && <p>Queue is empty — search above to add something.</p>}
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Log:</strong>
        <pre>{log.join('\n')}</pre>
      </div>
    </section>
  )
}

export default RoomView
