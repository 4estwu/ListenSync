import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueueItem, RelayEvent, RoomState, Track } from '@spotifyapple/shared'
import { connectRoom, type RelayConnection } from '../relay/client'
import { AdapterDeviceError, type AdapterPlaybackState, type PlaybackAdapter } from '../platform/adapter'
import { resolveTrackUri } from './resolveTrack'

const SLOW_POLL_MS = 3000 // steady-state mid-track — drift accumulates slowly, no need to check often
const FAST_POLL_MS = 500 // near a track boundary — auto-advance timing and start-up need more precision
const BOUNDARY_WINDOW_MS = 5000 // within this many ms of a track's start or end counts as "near a boundary"
// Was 1500 — a real, consistent ~1350ms lag on a joining client sat just
// under that threshold and was permanently judged "close enough," never
// getting corrected. A joining client's *first* play() always transfers
// (deviceConfirmedActive starts false), and that extra network round trip
// before the device even starts is a real, mostly-unavoidable source of a
// few hundred ms to ~1s of initial lag — tightening this so the drift
// correction actually closes that gap afterward, instead of quietly
// tolerating it forever.
const DRIFT_THRESHOLD_MS = 400
const CORRECTION_COOLDOWN_MS = 3000
const TRACK_END_EPSILON_MS = 800
const INITIAL_LATENCY_ESTIMATE_MS = 250 // seed guess before any real measurement exists
const LATENCY_EMA_WEIGHT = 0.3 // how much each new measurement moves the rolling estimate
// Cap on how many upcoming tracks get mirrored into the platform's own
// native queue per track switch (see mirrorUpcomingQueue) — each one is a
// separate API call, and the goal is resilience against this tab dying, not
// exhaustively replicating a long queue.
const MAX_QUEUE_MIRROR = 10

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
  /** Set when this client's own device rejected a call as gone (see AdapterDeviceError); cleared automatically once a poll succeeds again. */
  deviceError: string | null
  addToQueue: (track: Track, addedBy: string) => void
  removeFromQueue: (itemId: string) => void
  gotoIndex: (index: number) => void
  skipNext: () => void
  pause: () => void
  resume: () => void
  seekTo: (positionMs: number) => void
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
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)

  const connRef = useRef<RelayConnection | null>(null)
  const roomStateRef = useRef<RoomState | null>(null)
  const isHostRef = useRef(false)
  const lastKnownPositionRef = useRef(0)
  const lastCorrectionAtRef = useRef(0)
  // Guards the reporter's auto-advance send against its own not-yet-confirmed
  // previous goto: the poll loop re-checks "did the track end?" against
  // roomStateRef.current, which doesn't update until this goto's room:sync
  // echo comes back over the WS round trip — without this, a tick firing
  // before that echo arrives sees the same stale "ended" state and resends
  // the same goto. The relay now ignores a redundant same-index goto too
  // (defense in depth), but suppressing the resend here also avoids the
  // pointless extra network chatter.
  const autoAdvancePendingRef = useRef(false)
  const resolvedUriCacheRef = useRef(new Map<string, string | null>())
  const lastUnresolvedItemIdRef = useRef<string | null>(null)
  // Rolling estimate of how long a play()/seek() call takes from decision to
  // Spotify accepting it — real time keeps moving during that round trip, so
  // a correction that targets "where playback should be right now" is
  // already stale by the time it takes effect. Without compensating for
  // this, every correction undercorrects by roughly its own latency,
  // converging to a steady-state lag approximately equal to that latency
  // instead of actually closing the gap.
  const latencyEstimateMsRef = useRef(INITIAL_LATENCY_ESTIMATE_MS)

  // Derived (not a one-time flag from the initial "hello") so that server-side
  // reporter failover — the relay promoting a different client after the
  // previous reporter disconnects — takes effect here automatically the next
  // time roomState arrives with a new hostId, with no dedicated event type
  // needed.
  const isHost = roomState !== null && clientId !== null && roomState.hostId === clientId
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

  // Best-effort, fire-and-forget: pushes the next few queued tracks into this
  // platform's own native queue (currently Spotify only — see
  // enqueueUpcoming's doc comment) right after switching to a new current
  // track, so playback that's already underway can keep advancing on its own
  // even if this tab gets backgrounded/killed before the rest would
  // otherwise play. Never throws — a resolution or API failure here shouldn't
  // affect the actual sync correction it's piggybacking on.
  const mirrorUpcomingQueue = useCallback(
    async (state: RoomState) => {
      if (!adapter.enqueueUpcoming) return
      const upcoming = state.queue.slice(state.currentIndex + 1, state.currentIndex + 1 + MAX_QUEUE_MIRROR)
      if (upcoming.length === 0) return
      const uris: string[] = []
      for (const item of upcoming) {
        const uri = await resolveTrackUri(adapter, item.track, resolvedUriCacheRef.current).catch(() => null)
        if (uri) uris.push(uri)
      }
      if (uris.length === 0) return
      await adapter.enqueueUpcoming(uris).catch((err: Error) => onLog(`Sync: queue mirror failed — ${err.message}`))
    },
    [adapter, onLog],
  )
  // Referenced from the WS "hello" handler below so a fresh connection (first
  // join, or reconnecting after this tab was backgrounded/killed) re-mirrors
  // the queue immediately — the previous mirror only fired on a track
  // *switch*, so a reconnect landing mid-track (no switch to trigger it)
  // would otherwise leave whatever mirroring had happened before this tab
  // went away as the only copy, possibly already stale or gone if the
  // Spotify app's own session also reset in the meantime.
  const mirrorUpcomingQueueRef = useRef(mirrorUpcomingQueue)
  useEffect(() => {
    mirrorUpcomingQueueRef.current = mirrorUpcomingQueue
  }, [mirrorUpcomingQueue])

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
    async (
      state: RoomState,
      opts?: { skipCooldown?: boolean },
    ): Promise<{ playback: AdapterPlaybackState | null; expectedUri: string | null }> => {
      const playback = await adapter.getState().catch((err: Error) => {
        onLog(`Sync: playback poll error — ${err.message}`)
        if (err instanceof AdapterDeviceError) setDeviceError(err.message)
        return null
      })
      if (!playback) return { playback: null, expectedUri: null }
      // A successful poll means this client's device is responding again —
      // clear any earlier device-lost banner rather than leaving it stuck
      // showing after the underlying problem has already resolved itself.
      setDeviceError(null)
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
        return { playback, expectedUri: null }
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

          // Predictive compensation: expectedPositionMs is "where playback
          // should be right now," but real time keeps moving during the
          // round trip to Spotify, so by the time this call actually takes
          // effect that target is already stale by roughly the call's own
          // latency. Without this, every correction undercorrects by about
          // its own latency and converges to a steady-state lag instead of
          // actually closing the gap. Only meaningful when the target is
          // actively playing — a pause has nothing to compensate for.
          const predictedPositionMs = state.isPlaying ? expectedPositionMs + latencyEstimateMsRef.current : expectedPositionMs
          const callStartedAt = Date.now()

          try {
            if (needsTrackSwitch) {
              await adapter.play(expectedUri, predictedPositionMs)
              onLog(
                `Sync: switched to "${current!.track.title}" (was playing ${playback.platformId ?? 'nothing'}, ` +
                  `latency est. ${Math.round(latencyEstimateMsRef.current)}ms)`,
              )
              void mirrorUpcomingQueue(state)
            } else if (needsPlayPauseFix) {
              if (state.isPlaying) await adapter.play(undefined, predictedPositionMs)
              else await adapter.pause()
              onLog(
                `Sync: corrected ${state.isPlaying ? 'resume' : 'pause'} ` +
                  `(device reported isPlaying=${playback.isPlaying} at ${Math.round(playback.positionMs)}ms)`,
              )
            } else {
              await adapter.seek(predictedPositionMs)
              onLog(
                `Sync: corrected drift of ${Math.round(drift)}ms ` +
                  `(device at ${Math.round(playback.positionMs)}ms, targeting ${Math.round(predictedPositionMs)}ms, ` +
                  `latency est. ${Math.round(latencyEstimateMsRef.current)}ms)`,
              )
            }

            // Refine the estimate from this call's actual round trip — only
            // when we applied compensation (a pause() call's timing isn't a
            // play/seek round trip and isn't representative). Clamped so a
            // single outlier (e.g. a slow retry) can't swing it wildly.
            if (state.isPlaying) {
              const elapsed = Date.now() - callStartedAt
              const blended = latencyEstimateMsRef.current * (1 - LATENCY_EMA_WEIGHT) + elapsed * LATENCY_EMA_WEIGHT
              latencyEstimateMsRef.current = Math.min(2000, Math.max(50, blended))
            }
          } catch (err) {
            onLog(`Sync: correction failed — ${(err as Error).message}`)
            if (err instanceof AdapterDeviceError) setDeviceError((err as Error).message)
          }
        }
      }

      return { playback, expectedUri }
    },
    [adapter, onLog, mirrorUpcomingQueue],
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
        setRoomState(event.state)
        roomStateRef.current = event.state
        void reconcileRef.current(event.state, { skipCooldown: true })
        void mirrorUpcomingQueueRef.current(event.state)
      } else if (event.type === 'room:sync') {
        const prev = roomStateRef.current
        setRoomState(event.state)
        roomStateRef.current = event.state
        // Only react instantly to an actual transition (goto/pause/resume).
        // Routine playback:report broadcasts only touch positionMs and land
        // constantly — reacting to those too would defeat the point of
        // slowing the periodic poll down.
        const isTransition = !prev || prev.currentIndex !== event.state.currentIndex || prev.isPlaying !== event.state.isPlaying
        if (isTransition) {
          autoAdvancePendingRef.current = false
          void reconcileRef.current(event.state, { skipCooldown: true })
        }
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
        const { playback, expectedUri } = await reconcile(state)

        // Reporter-only: report ground-truth position, and auto-advance the
        // shared queue when this client's own track finishes. Only once room
        // playback has actually started (currentIndex >= 0), AND only when
        // playback.platformId actually matches the track that's canonically
        // supposed to be current — a rate-limited getState() can return
        // *cached data from a previous track* (see the adapter's backoff
        // handling), and trusting a stale duration/position pairing for a
        // track-end check caused a real bug: a just-switched-to track got
        // paused seconds in because the leftover position/duration from the
        // *previous* track (which happened to be near its own end) looked
        // like "track ended" for the new one.
        if (
          isHostRef.current &&
          !autoAdvancePendingRef.current &&
          state.currentIndex >= 0 &&
          playback?.durationMs != null &&
          expectedUri &&
          playback.platformId === expectedUri
        ) {
          const trackEnded = playback.durationMs > 0 && playback.positionMs >= playback.durationMs - TRACK_END_EPSILON_MS
          if (trackEnded) {
            autoAdvancePendingRef.current = true
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

  const removeFromQueue = useCallback((itemId: string) => {
    connRef.current?.send({ type: 'queue:remove', itemId })
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

  // Reuses playback:pause/playback:resume rather than a dedicated seek event
  // — both already carry a positionMs and apply it via setPosition regardless
  // of whether isPlaying is actually changing, so sending the current
  // isPlaying state back with a new position works as a general seek with no
  // protocol changes needed. Powers both the progress bar (click-to-seek) and
  // the ±15s rewind/forward buttons.
  const seekTo = useCallback((positionMs: number) => {
    const state = roomStateRef.current
    if (!state) return
    const clamped = Math.max(0, positionMs)
    connRef.current?.send({ type: state.isPlaying ? 'playback:resume' : 'playback:pause', positionMs: clamped })
  }, [])

  return { clientId, isHost, roomState, deviceError, addToQueue, removeFromQueue, gotoIndex, skipNext, pause, resume, seekTo }
}
