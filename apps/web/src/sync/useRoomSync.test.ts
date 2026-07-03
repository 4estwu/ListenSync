// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { QueueItem, RelayEvent, RoomState, Track } from '@spotifyapple/shared'
import { connectRoom, type RelayConnection } from '../relay/client'
import { AdapterDeviceError, type AdapterPlaybackState, type PlaybackAdapter } from '../platform/adapter'
import { useRoomSync } from './useRoomSync'

vi.mock('../relay/client', () => ({
  connectRoom: vi.fn(),
}))

function makeTrack(overrides: Partial<Track> = {}): Track {
  return { title: 'Song', artist: 'Artist', durationMs: 200_000, platformIds: { spotify: 'spotify:track:abc' }, ...overrides }
}

function makeQueueItem(id: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return { id, track: makeTrack(), addedBy: 'someone', ...overrides }
}

function makeState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: 'ROOM1',
    hostId: 'me',
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    positionMs: 0,
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makePlaybackState(overrides: Partial<AdapterPlaybackState> = {}): AdapterPlaybackState {
  return { isPlaying: false, positionMs: 0, durationMs: null, platformId: null, ...overrides }
}

function createFakeAdapter(overrides: Partial<PlaybackAdapter> = {}): PlaybackAdapter {
  return {
    platform: 'spotify',
    getState: vi.fn().mockResolvedValue(makePlaybackState()),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    resolveByIsrc: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

function createFakeConnection() {
  let messageHandler: ((event: RelayEvent) => void) | null = null
  const conn: RelayConnection = {
    send: vi.fn(),
    onMessage: vi.fn((cb) => {
      messageHandler = cb
    }),
    onStatusChange: vi.fn(),
    close: vi.fn(),
  }
  return {
    conn,
    emit: (event: RelayEvent) => messageHandler?.(event),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useRoomSync', () => {
  it('reacts immediately to an explicit transition (goto) rather than waiting for the next scheduled poll', async () => {
    const adapter = createFakeAdapter()
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)

    renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

    await act(async () => {
      fake.emit({ type: 'hello', clientId: 'me', isHost: true, state: makeState() })
    })
    // hello itself triggers a reconcile, but currentIndex is -1 (empty queue) so no play() call.
    expect(adapter.play).not.toHaveBeenCalled()

    const playingState = makeState({ currentIndex: 0, isPlaying: true, positionMs: 0, queue: [makeQueueItem('a')] })
    await act(async () => {
      fake.emit({ type: 'room:sync', state: playingState })
    })

    // No fake-timer advancement at all — if this only happened via the poll
    // loop it wouldn't have run yet, so a call here proves it was event-driven.
    expect(adapter.play).toHaveBeenCalledWith('spotify:track:abc', expect.any(Number))
  })

  it('does not trigger an immediate reconcile for a routine playback:report broadcast (position-only, no transition)', async () => {
    const adapter = createFakeAdapter()
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)

    renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

    const playing = makeState({ currentIndex: 0, isPlaying: true, positionMs: 0, queue: [makeQueueItem('a')] })
    await act(async () => {
      fake.emit({ type: 'hello', clientId: 'me', isHost: true, state: playing })
    })
    const callsAfterHello = (adapter.getState as Mock).mock.calls.length

    // A report only bumps positionMs/updatedAt — currentIndex/isPlaying unchanged.
    const reported = { ...playing, positionMs: 5000, updatedAt: Date.now() }
    await act(async () => {
      fake.emit({ type: 'room:sync', state: reported })
    })

    expect((adapter.getState as Mock).mock.calls.length).toBe(callsAfterHello)
  })

  it('keeps polling indefinitely even when every adapter call fails (regression: an uncaught rejection used to permanently kill the self-scheduling poll loop after the first failure)', async () => {
    const adapter = createFakeAdapter({ getState: vi.fn().mockRejectedValue(new Error('simulated rate limit')) })
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)
    const onLog = vi.fn()

    renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog }))

    await act(async () => {
      fake.emit({
        type: 'hello',
        clientId: 'me',
        isHost: true,
        state: makeState({ currentIndex: 0, isPlaying: true, queue: [makeQueueItem('a')] }),
      })
    })
    const callsAfterHello = (adapter.getState as Mock).mock.calls.length
    expect(callsAfterHello).toBeGreaterThan(0)

    // Advance through several steady-state poll intervals (3s each).
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
    }

    expect((adapter.getState as Mock).mock.calls.length).toBeGreaterThan(callsAfterHello + 2)
  })

  it('keeps polling even when track resolution fails repeatedly (cross-platform search/ISRC lookup throwing)', async () => {
    const adapter = createFakeAdapter({
      platform: 'apple',
      resolveByIsrc: vi.fn().mockRejectedValue(new Error('simulated search failure')),
      search: vi.fn().mockRejectedValue(new Error('simulated search failure')),
    })
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)

    renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

    // Track only has a Spotify id and an ISRC — this (Apple) adapter has to resolve it.
    const track = makeTrack({ isrc: 'US1234567890', platformIds: { spotify: 'spotify:track:abc' } })
    await act(async () => {
      fake.emit({
        type: 'hello',
        clientId: 'me',
        isHost: true,
        state: makeState({ currentIndex: 0, isPlaying: true, queue: [makeQueueItem('a', { track })] }),
      })
    })
    const callsAfterHello = (adapter.getState as Mock).mock.calls.length

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
    }

    expect((adapter.getState as Mock).mock.calls.length).toBeGreaterThan(callsAfterHello + 1)
    expect(adapter.play).not.toHaveBeenCalled() // never resolved, so never told to play anything
  })

  it('does not issue a second correction for the same mismatch within the cooldown window', async () => {
    const adapter = createFakeAdapter({
      getState: vi.fn().mockResolvedValue(makePlaybackState({ platformId: 'spotify:track:different' })),
    })
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)

    renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

    await act(async () => {
      fake.emit({
        type: 'hello',
        clientId: 'me',
        isHost: true,
        state: makeState({ currentIndex: 0, isPlaying: true, queue: [makeQueueItem('a')] }),
      })
    })
    expect(adapter.play).toHaveBeenCalledTimes(1)

    // Well within the 3s cooldown — same mismatch is still true, but no second attempt yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(adapter.play).toHaveBeenCalledTimes(1)
  })

  it(
    "reporter does not auto-advance/pause based on getState() data for a different track than the one " +
      'canonically current (regression: a rate-limited poll returning stale cached data from the ' +
      'previous track — which happened to be near its own end — caused the newly-switched-to track ' +
      'to get paused seconds after it started)',
    async () => {
      // platformId deliberately does not match the queued track's URI
      // (spotify:track:abc), simulating stale/mismatched getState() data,
      // while positionMs/durationMs alone would look like "track ended" if
      // naively trusted.
      const adapter = createFakeAdapter({
        getState: vi
          .fn()
          .mockResolvedValue(makePlaybackState({ isPlaying: true, positionMs: 199_500, durationMs: 200_000, platformId: 'spotify:track:STALE' })),
      })
      const fake = createFakeConnection()
      vi.mocked(connectRoom).mockReturnValue(fake.conn)

      renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

      await act(async () => {
        fake.emit({
          type: 'hello',
          clientId: 'me',
          isHost: true,
          state: makeState({ currentIndex: 0, isPlaying: true, queue: [makeQueueItem('a')] }),
        })
      })

      // Let the periodic poll (which drives the reporter block) run.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      const sentTypes = (fake.conn.send as Mock).mock.calls.map((call) => (call[0] as RelayEvent).type)
      expect(sentTypes).not.toContain('playback:pause')
      expect(sentTypes).not.toContain('playback:goto')
    },
  )

  it(
    'surfaces deviceError when the adapter reports a lost device, and clears it once a poll succeeds again ' +
      "(regression: this failure used to be buried in the scrolling log with no visible recoverable state)",
    async () => {
      const getState = vi.fn().mockRejectedValueOnce(new AdapterDeviceError('Spotify lost this device'))
      getState.mockResolvedValue(makePlaybackState())
      const adapter = createFakeAdapter({ getState })
      const fake = createFakeConnection()
      vi.mocked(connectRoom).mockReturnValue(fake.conn)

      const { result } = renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

      await act(async () => {
        fake.emit({
          type: 'hello',
          clientId: 'me',
          isHost: true,
          state: makeState({ currentIndex: 0, isPlaying: true, queue: [makeQueueItem('a')] }),
        })
      })
      expect(result.current.deviceError).toBe('Spotify lost this device')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(result.current.deviceError).toBeNull()
    },
  )

  it(
    'mirrors the next few upcoming tracks into the platform queue right after a track switch ' +
      "(resilience against this tab dying before they'd otherwise play — see enqueueUpcoming)",
    async () => {
      const enqueueUpcoming = vi.fn().mockResolvedValue(undefined)
      const adapter = createFakeAdapter({ enqueueUpcoming })
      const fake = createFakeConnection()
      vi.mocked(connectRoom).mockReturnValue(fake.conn)

      renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

      const queue = [
        makeQueueItem('a', { track: makeTrack({ platformIds: { spotify: 'spotify:track:a' } }) }),
        makeQueueItem('b', { track: makeTrack({ platformIds: { spotify: 'spotify:track:b' } }) }),
        makeQueueItem('c', { track: makeTrack({ platformIds: { spotify: 'spotify:track:c' } }) }),
      ]
      await act(async () => {
        fake.emit({ type: 'hello', clientId: 'me', isHost: true, state: makeState({ currentIndex: 0, isPlaying: true, queue }) })
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(enqueueUpcoming).toHaveBeenCalledWith(['spotify:track:b', 'spotify:track:c'])
    },
  )

  it('does not call enqueueUpcoming for an adapter that does not implement it (Apple has no equivalent native queue)', async () => {
    const adapter = createFakeAdapter({ platform: 'apple', enqueueUpcoming: undefined })
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)

    renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

    const queue = [
      makeQueueItem('a', { track: makeTrack({ platformIds: { apple: 'apple:track:a' } }) }),
      makeQueueItem('b', { track: makeTrack({ platformIds: { apple: 'apple:track:b' } }) }),
    ]
    await act(async () => {
      fake.emit({ type: 'hello', clientId: 'me', isHost: true, state: makeState({ currentIndex: 0, isPlaying: true, queue }) })
      await vi.advanceTimersByTimeAsync(0)
    })

    // The track switch itself still needs to succeed — enqueueUpcoming being
    // undefined just means mirroring is skipped, not a crash for everything else.
    expect(adapter.play).toHaveBeenCalledWith('apple:track:a', expect.any(Number))
  })

  it(
    're-mirrors the queue on every fresh "hello" (reconnect), not just on a track switch — a reconnect ' +
      "landing mid-track has no switch to trigger it otherwise, leaving a possibly-stale mirror as the only copy",
    async () => {
      const enqueueUpcoming = vi.fn().mockResolvedValue(undefined)
      // Device already on the right track (matches expectedUri from the
      // start) so reconcile()'s own track-switch path — which separately
      // triggers a mirror — doesn't fire here; isolates this test to just
      // the "hello" handler's own mirror call.
      const adapter = createFakeAdapter({
        enqueueUpcoming,
        getState: vi.fn().mockResolvedValue(makePlaybackState({ isPlaying: true, platformId: 'spotify:track:a' })),
      })
      const fake = createFakeConnection()
      vi.mocked(connectRoom).mockReturnValue(fake.conn)

      renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

      const queue = [
        makeQueueItem('a', { track: makeTrack({ platformIds: { spotify: 'spotify:track:a' } }) }),
        makeQueueItem('b', { track: makeTrack({ platformIds: { spotify: 'spotify:track:b' } }) }),
      ]
      const state = makeState({ currentIndex: 0, isPlaying: true, queue })

      await act(async () => {
        fake.emit({ type: 'hello', clientId: 'me', isHost: true, state })
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(enqueueUpcoming).toHaveBeenCalledTimes(1)

      // Simulates this tab reconnecting (e.g. after being backgrounded) — a
      // second "hello" for the same still-in-progress track, no index change.
      await act(async () => {
        fake.emit({ type: 'hello', clientId: 'me-2', isHost: true, state })
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(enqueueUpcoming).toHaveBeenCalledTimes(2)
    },
  )

  it('seekTo sends playback:resume (preserving isPlaying=true) when currently playing', async () => {
    const adapter = createFakeAdapter()
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)

    const { result } = renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

    await act(async () => {
      fake.emit({ type: 'hello', clientId: 'me', isHost: true, state: makeState({ isPlaying: true }) })
    })
    act(() => result.current.seekTo(42_000))

    expect(fake.conn.send).toHaveBeenCalledWith({ type: 'playback:resume', positionMs: 42_000 })
  })

  it('seekTo sends playback:pause (preserving isPlaying=false) when currently paused, and clamps negative positions to 0', async () => {
    const adapter = createFakeAdapter()
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)

    const { result } = renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

    await act(async () => {
      fake.emit({ type: 'hello', clientId: 'me', isHost: true, state: makeState({ isPlaying: false }) })
    })
    act(() => result.current.seekTo(-5000))

    expect(fake.conn.send).toHaveBeenCalledWith({ type: 'playback:pause', positionMs: 0 })
  })
})
