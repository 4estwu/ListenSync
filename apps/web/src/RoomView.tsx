import { useCallback, useEffect, useState } from 'react'
import type { Track } from '@spotifyapple/shared'
import type { AdapterTrackResult, PlaybackAdapter } from './platform/adapter'
import { useRoomSync } from './sync/useRoomSync'

function toSharedTrack(adapter: PlaybackAdapter, result: AdapterTrackResult): Track {
  return {
    title: result.title,
    artist: result.artist,
    durationMs: result.durationMs,
    isrc: result.isrc,
    platformIds: { [adapter.platform]: result.platformId },
  }
}

interface RoomViewProps {
  roomId: string
  adapter: PlaybackAdapter
}

function RoomView({ roomId, adapter }: RoomViewProps) {
  const [log, setLog] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AdapterTrackResult[]>([])
  const [searching, setSearching] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const say = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 30))
  }, [])

  const { clientId, roomState, deviceError, addToQueue, gotoIndex, skipNext, pause, resume } = useRoomSync({
    roomId,
    adapter,
    onLog: say,
  })

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    const handle = setTimeout(async () => {
      setSearching(true)
      try {
        setSearchResults(await adapter.search(searchQuery))
      } catch (err) {
        say(`Search error: ${(err as Error).message}`)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [searchQuery, adapter, say])

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
    <section className="room-view">
      <h1>Listening room {roomId}</h1>
      <p>
        Everyone here can search, queue, play, pause, and skip — it's a shared session, mixing Spotify and Apple
        Music accounts.{' '}
        {clientId && <code style={{ opacity: 0.6 }}>{clientId.slice(0, 8)}</code>}
      </p>

      <div>
        <button type="button" onClick={copyShareLink}>
          {linkCopied ? 'Copied!' : 'Copy share link'}
        </button>
      </div>

      {deviceError && (
        <p style={{ color: 'tomato', marginTop: 16 }}>
          Lost connection to your playback device — its session ended, so it won't respond until you reopen
          the app on that device and start playing something to reactivate it. This will recover
          automatically once it does.
        </p>
      )}

      <div style={{ marginTop: 16 }}>
        <strong>Now playing:</strong>
        <pre>
          {current
            ? `${roomState?.isPlaying ? 'playing' : 'paused'} — ${current.track.title} by ${current.track.artist}`
            : 'nothing yet — add a track and start playback'}
        </pre>
        <div className="controls-row">
          <button type="button" onClick={roomState?.isPlaying ? pause : resume} disabled={!current}>
            {roomState?.isPlaying ? 'Pause' : 'Resume'}
          </button>
          <button type="button" onClick={skipNext} disabled={!roomState || roomState.currentIndex + 1 >= roomState.queue.length}>
            Skip
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Search tracks ({adapter.platform === 'spotify' ? 'Spotify' : 'Apple Music'} catalog)</strong>
        <input
          style={{ marginTop: 4 }}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by title, artist..."
        />
        {searching && <p>Searching…</p>}
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 8 }}>
          {searchResults.map((track) => (
            <li key={track.platformId} className="search-result-row">
              {track.artworkUrl && <img src={track.artworkUrl} alt="" width={32} height={32} />}
              <span>
                {track.title} — {track.artist}
              </span>
              <button
                type="button"
                onClick={() => {
                  addToQueue(toSharedTrack(adapter, track), clientId ?? 'unknown')
                  say(`Added "${track.title}" to the queue`)
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
