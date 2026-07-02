import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueueItem, RelayEvent, RoomState, Track } from '@spotifyapple/shared'
import { connectRoom, type RelayConnection } from '../relay/client'
import type { PlaybackAdapter } from '../platform/adapter'
import { resolveTrackUri } from './resolveTrack'

const POLL_INTERVAL_MS = 1000
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
    roomStateRef.current = roomState
  }, [roomState])
  useEffect(() => {
    isHostRef.current = isHost
  }, [isHost])

  useEffect(() => {
    const conn = connectRoom(roomId)
    connRef.current = conn
    conn.onMessage((event: RelayEvent) => {
      if (event.type === 'hello') {
        setClientId(event.clientId)
        setIsHost(event.isHost)
        setRoomState(event.state)
      } else if (event.type === 'room:sync') {
        setRoomState(event.state)
      }
    })
    return () => {
      conn.close()
      connRef.current = null
    }
  }, [roomId])

  useEffect(() => {
    const tick = async () => {
      const state = roomStateRef.current
      const conn = connRef.current
      if (!state || !conn) return

      const playback = await adapter.getState().catch((err: Error) => {
        onLog(`Sync: playback poll error — ${err.message}`)
        return null
      })
      // A failed poll gives us no reliable data to reconcile or report against —
      // acting on it (e.g. treating a missing response as "not playing") is how
      // you get spurious corrections. Wait for the next tick instead.
      if (!playback) return

      lastKnownPositionRef.current = playback.positionMs

      const current = state.currentIndex >= 0 ? state.queue[state.currentIndex] : null
      const expectedUri = current ? await resolveTrackUri(adapter, current.track, resolvedUriCacheRef.current) : null
      const expectedPositionMs = state.isPlaying
        ? state.positionMs + (Date.now() - state.updatedAt)
        : state.positionMs

      // Reconcile own playback against the canonical room state. Runs for every
      // client, regardless of platform or reporter status. Corrections tend to
      // make the underlying player report transiently stale state for a moment
      // afterwards, so the cooldown gates the whole reconciliation, not just the
      // drift branch — otherwise every correction's own aftershock looks like a
      // fresh mismatch on the very next tick, producing a once-a-second
      // correct/stutter/correct loop.
      if (current && !expectedUri) {
        // resolveTrackUri came back empty — nothing plays for this client until
        // it does, but the "Now playing" panel still reflects canonical state
        // (it just reads state.queue directly), so without this it looks like
        // a mystery silent failure rather than a failed cross-platform match.
        if (lastUnresolvedItemIdRef.current !== current.id) {
          onLog(`Sync: couldn't find "${current.track.title}" by ${current.track.artist} on ${adapter.platform} (no ISRC/search match)`)
          lastUnresolvedItemIdRef.current = current.id
        }
      }

      const withinCooldown = Date.now() - lastCorrectionAtRef.current < CORRECTION_COOLDOWN_MS
      if (expectedUri && !withinCooldown) {
        try {
          if (playback.platformId !== expectedUri) {
            await adapter.play(expectedUri, expectedPositionMs)
            onLog(`Sync: switched to "${current!.track.title}"`)
            lastCorrectionAtRef.current = Date.now()
          } else if (playback.isPlaying !== state.isPlaying) {
            if (state.isPlaying) await adapter.play(undefined, expectedPositionMs)
            else await adapter.pause()
            onLog(`Sync: corrected ${state.isPlaying ? 'resume' : 'pause'}`)
            lastCorrectionAtRef.current = Date.now()
          } else if (state.isPlaying) {
            const drift = Math.abs(playback.positionMs - expectedPositionMs)
            if (drift > DRIFT_THRESHOLD_MS) {
              await adapter.seek(expectedPositionMs)
              onLog(`Sync: corrected drift of ${Math.round(drift)}ms`)
              lastCorrectionAtRef.current = Date.now()
            }
          }
        } catch (err) {
          onLog(`Sync: correction failed — ${(err as Error).message}`)
        }
      }

      // Reporter-only: report ground-truth position, and auto-advance the shared
      // queue when this client's own track finishes. Only once room playback has
      // actually been started (currentIndex >= 0) — otherwise leftover playback
      // from before joining the room would spuriously trigger an advance.
      if (isHostRef.current && state.currentIndex >= 0 && playback.durationMs != null) {
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
    }

    const handle = setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => clearInterval(handle)
  }, [roomId, adapter, onLog])

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
