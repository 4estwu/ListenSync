import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueueItem, RelayEvent, RoomState, Track } from '@spotifyapple/shared'
import { connectRoom, type RelayConnection } from '../relay/client'
import type { AdapterPlaybackState, PlaybackAdapter } from '../platform/adapter'
import { resolveTrackUri } from './resolveTrack'

const SLOW_POLL_MS = 3000 // steady-state mid-track — drift accumulates slowly, no need to check often
const FAST_POLL_MS = 500 // near a track boundary — auto-advance timing and start-up need more precision
const BOUNDARY_WINDOW_MS = 5000 // within this many ms of a track's start or end counts as "near a boundary"
const DRIFT_THRESHOLD_MS = 1500
const CORRECTION_COOLDOWN_MS = 3000
const TRACK_END_EPSILON_MS = 800

interface UseRoomSyncArgs {
  roomId: string
  adapter: PlaybackAdapter
  onLog: (line: string) => void
}

export interface RoomSync {
  clientId: string | null
  /** Whether this client is the internal position-reporter — informational only, doesn't gate controls. */
  isHost: boolean
  roomState: RoomState | null
  addToQueue: (track: Track, addedBy: string) => void
  gotoIndex: (index: number) => void
  skipNext: () => void
  pause: () => void
  resume: () => void
}

/** Distance in ms to the current track's start or end, using only local canonical state — no API call needed to decide how urgently to poll. */
function nextPollDelay(state: RoomState): number {
  if (!state.isPlaying || state.currentIndex < 0) return SLOW_POLL_MS
  const current = state.queue[state.currentIndex]
  if (!current) return SLOW_POLL_MS

  const expectedPositionMs = state.positionMs + (Date.now() - state.updatedAt)
  const remainingMs = current.track.durationMs - expectedPositionMs
  const nearBoundary = expectedPositionMs < BOUNDARY_WINDOW_MS || remainingMs < BOUNDARY_WINDOW_MS
  return nearBoundary ? FAST_POLL_MS : SLOW_POLL_MS
}

export function useRoomSync({ roomId, adapter, onLog }: UseRoomSyncArgs): RoomSync {
  const [clientId, setClientId] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [roomState, setRoomState] = useState<RoomState | null>(null)

  const connRef = useRef<RelayConnection | null>(null)
  const roomStateRef = useRef<RoomState | null>(null)
  const isHostRef = useRef(false)
  const lastKnownPositionRef = useRef(0)
  const lastCorrectionAtRef = useRef(0)
  const resolvedUriCacheRef = useRef(new Map<string, string | null>())
  const lastUnresolvedItemIdRef = useRef<string | null>(null)

  useEffect(() => {
    isHostRef.current = isHost
  }, [isHost])

  // Platform-specific diagnostic events (local SDK errors, buffering stalls) —
  // optional, only meaningful for adapters that implement it (currently just
  // Spotify's in-tab Web Playback SDK device). Surfaces the SDK's own signals
  // instead of only ever inferring what happened from REST polling.
  useEffect(() => {
    adapter.onDiagnostic?.((message) => onLog(message))
  }, [adapter, onLog])

  /**
   * Polls this client's own playback once and reconciles it toward `state`.
   * Always polls (the caller may need the fresh reading regardless of whether
   * a correction happens, e.g. the reporter's auto-advance check) — only the
   * correction itself is skipped when `withinCooldown` and `skipCooldown`
   * isn't set. `skipCooldown` is for the immediate-event path: a freshly
   * arrived explicit goto/pause/resume is a trustworthy new command, not the
   * kind of aftershock-of-our-own-correction noise the cooldown guards
   * against for the periodic poll.
   */
  const reconcile = useCallback(
    async (state: RoomState, opts?: { skipCooldown?: boolean }): Promise<AdapterPlaybackState | null> => {
      const playback = await adapter.getState().catch((err: Error) => {
        onLog(`Sync: playback poll error — ${err.message}`)
        return null
      })
      if (!playback) return null
      lastKnownPositionRef.current = playback.positionMs

      const current = state.currentIndex >= 0 ? state.queue[state.currentIndex] : null
      const expectedUri = current
        ? await resolveTrackUri(adapter, current.track, resolvedUriCacheRef.current).catch((err: Error) => {
            onLog(`Sync: resolve error — ${err.message}`)
            return null
          })
        : null
      const expectedPositionMs = state.isPlaying
        ? state.positionMs + (Date.now() - state.updatedAt)
        : state.positionMs

      if (current && !expectedUri) {
        // resolveTrackUri came back empty — nothing plays for this client until
        // it does, but the "Now playing" panel still reflects canonical state
        // (it just reads state.queue directly), so without this it looks like
        // a mystery silent failure rather than a failed cross-platform match.
        if (lastUnresolvedItemIdRef.current !== current.id) {
          onLog(`Sync: couldn't find "${current.track.title}" by ${current.track.artist} on ${adapter.platform} (no ISRC/search match)`)
          lastUnresolvedItemIdRef.current = current.id
        }
        return playback
      }

      const withinCooldown = !opts?.skipCooldown && Date.now() - lastCorrectionAtRef.current < CORRECTION_COOLDOWN_MS
      if (expectedUri && !withinCooldown) {
        const needsTrackSwitch = playback.platformId !== expectedUri
        const needsPlayPauseFix = !needsTrackSwitch && playback.isPlaying !== state.isPlaying
        const drift = !needsTrackSwitch && !needsPlayPauseFix && state.isPlaying ? Math.abs(playback.positionMs - expectedPositionMs) : 0
        const needsDriftFix = drift > DRIFT_THRESHOLD_MS

        if (needsTrackSwitch || needsPlayPauseFix || needsDriftFix) {
          // Engage the cooldown before attempting, not after succeeding — a
          // *failed* correction (e.g. a 429) still needs to back off, or it
          // just retries every tick into an already-rate-limited API, which
          // extends the rate limit and produces a correction storm based on
          // increasingly stale data (this is what actually happened above).
          lastCorrectionAtRef.current = Date.now()
          try {
            if (needsTrackSwitch) {
              await adapter.play(expectedUri, expectedPositionMs)
              onLog(`Sync: switched to "${current!.track.title}" (was playing ${playback.platformId ?? 'nothing'})`)
            } else if (needsPlayPauseFix) {
              if (state.isPlaying) await adapter.play(undefined, expectedPositionMs)
              else await adapter.pause()
              onLog(
                `Sync: corrected ${state.isPlaying ? 'resume' : 'pause'} ` +
                  `(device reported isPlaying=${playback.isPlaying} at ${Math.round(playback.positionMs)}ms)`,
              )
            } else {
              await adapter.seek(expectedPositionMs)
              onLog(
                `Sync: corrected drift of ${Math.round(drift)}ms ` +
                  `(device at ${Math.round(playback.positionMs)}ms, expected ${Math.round(expectedPositionMs)}ms)`,
              )
            }
          } catch (err) {
            onLog(`Sync: correction failed — ${(err as Error).message}`)
          }
        }
      }

      return playback
    },
    [adapter, onLog],
  )

  // Referenced (not called directly) from the WS message handler below, so
  // that effect doesn't need `reconcile` in its own dependency array and
  // doesn't reconnect the socket whenever adapter/onLog identity changes.
  const reconcileRef = useRef(reconcile)
  useEffect(() => {
    reconcileRef.current = reconcile
  }, [reconcile])

  useEffect(() => {
    const conn = connectRoom(roomId)
    connRef.current = conn
    conn.onStatusChange((status) => {
      onLog(status === 'connected' ? 'Sync: connected to relay' : 'Sync: lost connection to relay, reconnecting…')
    })
    conn.onMessage((event: RelayEvent) => {
      if (event.type === 'hello') {
        setClientId(event.clientId)
        setIsHost(event.isHost)
        setRoomState(event.state)
        roomStateRef.current = event.state
        void reconcileRef.current(event.state, { skipCooldown: true })
      } else if (event.type === 'room:sync') {
        const prev = roomStateRef.current
        setRoomState(event.state)
        roomStateRef.current = event.state
        // Only react instantly to an actual transition (goto/pause/resume).
        // Routine playback:report broadcasts only touch positionMs and land
        // constantly — reacting to those too would defeat the point of
        // slowing the periodic poll down.
        const isTransition = !prev || prev.currentIndex !== event.state.currentIndex || prev.isPlaying !== event.state.isPlaying
        if (isTransition) void reconcileRef.current(event.state, { skipCooldown: true })
      }
    })
    return () => {
      conn.close()
      connRef.current = null
    }
  }, [roomId])

  // Adaptive periodic poll: drift correction and the reporter's auto-advance
  // check. Self-schedules via setTimeout rather than setInterval so the next
  // delay can depend on how close to a track boundary we currently are.
  useEffect(() => {
    let timeoutHandle: ReturnType<typeof setTimeout>
    let cancelled = false

    const scheduleNext = (delay: number) => {
      if (cancelled) return
      timeoutHandle = setTimeout(() => void tick(), delay)
    }

    const tick = async () => {
      const state = roomStateRef.current
      const conn = connRef.current
      if (!state || !conn) {
        scheduleNext(SLOW_POLL_MS)
        return
      }

      // Polling is self-scheduling (recursive setTimeout): scheduleNext() at
      // the end is what keeps it alive. An uncaught throw anywhere in here —
      // resolveTrackUri hitting a rate limit, an adapter call erroring in a
      // way reconcile() doesn't already catch, anything — would silently kill
      // the loop forever, since nothing after the throw would run. The
      // try/finally guarantees scheduling continues no matter what happens
      // above it.
      try {
        const playback = await reconcile(state)

        // Reporter-only: report ground-truth position, and auto-advance the
        // shared queue when this client's own track finishes. Only once room
        // playback has actually started (currentIndex >= 0) — otherwise
        // leftover playback from before joining the room would spuriously
        // trigger an advance.
        if (isHostRef.current && state.currentIndex >= 0 && playback?.durationMs != null) {
          const trackEnded = playback.durationMs > 0 && playback.positionMs >= playback.durationMs - TRACK_END_EPSILON_MS
          if (trackEnded) {
            const nextIndex = state.currentIndex + 1
            if (nextIndex < state.queue.length) {
              conn.send({ type: 'playback:goto', index: nextIndex })
            } else {
              conn.send({ type: 'playback:pause', positionMs: playback.positionMs })
            }
          } else {
            conn.send({ type: 'playback:report', positionMs: playback.positionMs })
          }
        }
      } catch (err) {
        onLog(`Sync: unexpected error — ${(err as Error).message}`)
      } finally {
        scheduleNext(nextPollDelay(state))
      }
    }

    scheduleNext(SLOW_POLL_MS) // the WS "hello"/room:sync handlers already cover the instant-reaction case
    return () => {
      cancelled = true
      clearTimeout(timeoutHandle)
    }
  }, [roomId, reconcile])

  // Every connected client can control playback — this is a shared session, not
  // a single-controller room. `isHost` is exposed for informational purposes
  // only (it's who's currently doing periodic position reporting internally),
  // it does NOT gate any of these actions.
  const addToQueue = useCallback((track: Track, addedBy: string) => {
    const item: QueueItem = { id: crypto.randomUUID(), track, addedBy }
    connRef.current?.send({ type: 'queue:add', item })
  }, [])

  const gotoIndex = useCallback((index: number) => {
    connRef.current?.send({ type: 'playback:goto', index })
  }, [])

  const skipNext = useCallback(() => {
    if (!roomState) return
    gotoIndex(roomState.currentIndex + 1)
  }, [roomState, gotoIndex])

  const pause = useCallback(() => {
    connRef.current?.send({ type: 'playback:pause', positionMs: lastKnownPositionRef.current })
  }, [])

  const resume = useCallback(() => {
    connRef.current?.send({ type: 'playback:resume', positionMs: lastKnownPositionRef.current })
  }, [])

  return { clientId, isHost, roomState, addToQueue, gotoIndex, skipNext, pause, resume }
}
