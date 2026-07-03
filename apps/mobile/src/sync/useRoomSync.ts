import { useCallback, useEffect, useRef, useState } from 'react'
import * as Crypto from 'expo-crypto'
import type { QueueItem, RelayEvent, RoomState, Track } from '@spotifyapple/shared'
import { connectRoom, type RelayConnection } from '../relay/client'
import { AdapterDeviceError, type AdapterPlaybackState, type PlaybackAdapter } from '../platform/adapter'
import { resolveTrackUri } from './resolveTrack'

// Port of apps/web/src/sync/useRoomSync.ts. The sync engine itself is plain
// TypeScript + React hooks operating only on the PlaybackAdapter and
// RelayConnection interfaces — nothing here is DOM/browser-specific, so this
// is a straight port, not a rewrite. Two real differences from the web
// version:
//   1. crypto.randomUUID() -> expo-crypto's Crypto.randomUUID() — the
//      browser global isn't reliably available in React Native's JS engine
//      (Hermes), Expo ships its own module for this.
//   2. No import.meta.env — moved into relay/client.ts's own env var access.
//
// NOT YET extracted into packages/shared to be imported by both apps instead
// of duplicated like this — see MOBILE_V2_PLAN.md's "Open Questions". This
// duplication is intentional for now: extracting shared logic is a real
// refactor of already-working, well-tested web app code, and doing that
// blind (unreviewed, while unattended) risked more than it was worth.
// Keeping the two copies in sync by hand until that extraction happens is a
// known cost of this choice, not an oversight.

const SLOW_POLL_MS = 3000
const FAST_POLL_MS = 500
const BOUNDARY_WINDOW_MS = 5000
const DRIFT_THRESHOLD_MS = 400
const CORRECTION_COOLDOWN_MS = 3000
const TRACK_END_EPSILON_MS = 800
const INITIAL_LATENCY_ESTIMATE_MS = 250
const LATENCY_EMA_WEIGHT = 0.3
const MAX_QUEUE_MIRROR = 10

interface UseRoomSyncArgs {
  roomId: string
  adapter: PlaybackAdapter
  onLog: (line: string) => void
}

export interface RoomSync {
  clientId: string | null
  isHost: boolean
  roomState: RoomState | null
  deviceError: string | null
  addToQueue: (track: Track, addedBy: string) => void
  removeFromQueue: (itemId: string) => void
  gotoIndex: (index: number) => void
  skipNext: () => void
  pause: () => void
  resume: () => void
  seekTo: (positionMs: number) => void
}

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
  const autoAdvancePendingRef = useRef(false)
  const resolvedUriCacheRef = useRef(new Map<string, string | null>())
  const lastUnresolvedItemIdRef = useRef<string | null>(null)
  const latencyEstimateMsRef = useRef(INITIAL_LATENCY_ESTIMATE_MS)

  const isHost = roomState !== null && clientId !== null && roomState.hostId === clientId
  useEffect(() => {
    isHostRef.current = isHost
  }, [isHost])

  useEffect(() => {
    adapter.onDiagnostic?.((message) => onLog(message))
  }, [adapter, onLog])

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
  const mirrorUpcomingQueueRef = useRef(mirrorUpcomingQueue)
  useEffect(() => {
    mirrorUpcomingQueueRef.current = mirrorUpcomingQueue
  }, [mirrorUpcomingQueue])

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
          lastCorrectionAtRef.current = Date.now()
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

      try {
        const { playback, expectedUri } = await reconcile(state)

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

    scheduleNext(SLOW_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timeoutHandle)
    }
  }, [roomId, reconcile])

  const addToQueue = useCallback((track: Track, addedBy: string) => {
    const item: QueueItem = { id: Crypto.randomUUID(), track, addedBy }
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

  const seekTo = useCallback((positionMs: number) => {
    const state = roomStateRef.current
    if (!state) return
    const clamped = Math.max(0, positionMs)
    connRef.current?.send({ type: state.isPlaying ? 'playback:resume' : 'playback:pause', positionMs: clamped })
  }, [])

  return { clientId, isHost, roomState, deviceError, addToQueue, removeFromQueue, gotoIndex, skipNext, pause, resume, seekTo }
}
