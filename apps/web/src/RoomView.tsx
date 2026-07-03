import { useCallback, useEffect, useRef, useState } from 'react'
import type { Track } from '@spotifyapple/shared'
import type { AdapterTrackResult, PlaybackAdapter } from './platform/adapter'
import { useRoomSync } from './sync/useRoomSync'

const SEEK_STEP_MS = 15_000

function toSharedTrack(adapter: PlaybackAdapter, result: AdapterTrackResult): Track {
  return {
    title: result.title,
    artist: result.artist,
    durationMs: result.durationMs,
    isrc: result.isrc,
    platformIds: { [adapter.platform]: result.platformId },
  }
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

interface RoomViewProps {
  roomId: string
  adapter: PlaybackAdapter
  /** Leaves this room but stays logged in on the same platform/account — returns to the room chooser. */
  onLeaveRoom?: () => void
  /** Signs out entirely and returns to the very first platform-choice screen. */
  onSwitchPlatform?: () => void
}

function RoomView({ roomId, adapter, onLeaveRoom, onSwitchPlatform }: RoomViewProps) {
  const [log, setLog] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AdapterTrackResult[]>([])
  const [searching, setSearching] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const say = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 30))
  }, [])

  const { clientId, roomState, deviceError, addToQueue, removeFromQueue, gotoIndex, skipNext, pause, resume, seekTo } = useRoomSync({
    roomId,
    adapter,
    onLog: say,
  })

  // Re-render periodically so the progress bar/time actually animate between
  // syncs, instead of only jumping on the next real correction. Only runs
  // while playing — the displayed position is static otherwise.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!roomState?.isPlaying) return
    const handle = setInterval(() => forceTick((t) => t + 1), 250)
    return () => clearInterval(handle)
  }, [roomState?.isPlaying])

  const progressBarRef = useRef<HTMLDivElement>(null)

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

  // Canonical position (roomState.positionMs) is a snapshot as of updatedAt —
  // interpolated forward by elapsed real time while playing, same math the
  // sync engine itself uses, and clamped to the track's duration so it never
  // visibly overshoots at the very end.
  const displayedPositionMs =
    current && roomState
      ? Math.min(
          current.track.durationMs,
          roomState.isPlaying ? roomState.positionMs + (Date.now() - roomState.updatedAt) : roomState.positionMs,
        )
      : 0

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!current || !progressBarRef.current) return
    const rect = progressBarRef.current.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    seekTo(fraction * current.track.durationMs)
  }

  const seekBy = (deltaMs: number) => {
    if (!current) return
    seekTo(Math.min(current.track.durationMs, Math.max(0, displayedPositionMs + deltaMs)))
  }

  return (
    <section className="room-view">
      <header className="room-header">
        <div>
          <h1>Room {roomId}</h1>
          <p className="muted">
            Everyone here can search, queue, play, pause, and skip.
            {clientId && <code className="client-badge">{clientId.slice(0, 8)}</code>}
          </p>
        </div>
        <div className="controls-row">
          <button type="button" className="primary" onClick={copyShareLink}>
            {linkCopied ? 'Copied!' : 'Copy share link'}
          </button>
          {onLeaveRoom && (
            <button type="button" onClick={onLeaveRoom}>
              Leave room
            </button>
          )}
          {onSwitchPlatform && (
            <button type="button" className="icon-button" onClick={onSwitchPlatform}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {deviceError && (
        <div className="banner banner-error">
          Lost connection to your playback device — its session ended, so it won't respond until you reopen
          the app on that device and start playing something to reactivate it. This will recover
          automatically once it does.
        </div>
      )}

      <div className="card now-playing">
        <span className="section-label">Now playing</span>
        <div className="now-playing-track">
          {current ? (
            <>
              <strong>{current.track.title}</strong>
              <span className="muted"> — {current.track.artist}</span>
              <span className={`status-pill ${roomState?.isPlaying ? 'status-playing' : 'status-paused'}`}>
                {roomState?.isPlaying ? 'Playing' : 'Paused'}
              </span>
            </>
          ) : (
            <span className="muted">Nothing yet — add a track below and press play.</span>
          )}
        </div>
        {current && (
          <div className="progress-section">
            <div className="progress-bar" ref={progressBarRef} onClick={handleProgressBarClick}>
              <div className="progress-fill" style={{ width: `${(displayedPositionMs / current.track.durationMs) * 100}%` }} />
            </div>
            <div className="progress-times">
              <span>{formatTime(displayedPositionMs)}</span>
              <span>{formatTime(current.track.durationMs)}</span>
            </div>
          </div>
        )}
        <div className="controls-row">
          <button type="button" onClick={() => seekBy(-SEEK_STEP_MS)} disabled={!current} aria-label="Rewind 15 seconds">
            ⟲ 15s
          </button>
          <button type="button" className="primary" onClick={roomState?.isPlaying ? pause : resume} disabled={!current}>
            {roomState?.isPlaying ? 'Pause' : 'Resume'}
          </button>
          <button type="button" onClick={() => seekBy(SEEK_STEP_MS)} disabled={!current} aria-label="Forward 15 seconds">
            15s ⟳
          </button>
          <button type="button" onClick={skipNext} disabled={!roomState || roomState.currentIndex + 1 >= roomState.queue.length}>
            Skip
          </button>
        </div>
      </div>

      <div className="card">
        <span className="section-label">Search ({adapter.platform === 'spotify' ? 'Spotify' : 'Apple Music'} catalog)</span>
        <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by title, artist..." />
        {searching && <p className="muted">Searching…</p>}
        <ul className="track-list">
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

      <div className="card">
        <span className="section-label">Queue</span>
        <ol className="track-list queue-list">
          {roomState?.queue.map((item, i) => (
            <li key={item.id} className={i === roomState.currentIndex ? 'queue-row current' : 'queue-row'}>
              <span>
                {item.track.title} — {item.track.artist}
              </span>
              <div className="queue-row-actions">
                {i !== roomState.currentIndex && (
                  <button type="button" onClick={() => gotoIndex(i)}>
                    Play
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove "${item.track.title}" from queue`}
                  onClick={() => {
                    removeFromQueue(item.id)
                    say(`Removed "${item.track.title}" from the queue`)
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
        {roomState && roomState.queue.length === 0 && <p className="muted">Queue is empty — search above to add something.</p>}
      </div>

      <details className="log-panel">
        <summary>Activity log</summary>
        <pre>{log.join('\n')}</pre>
      </details>
    </section>
  )
}

export default RoomView
