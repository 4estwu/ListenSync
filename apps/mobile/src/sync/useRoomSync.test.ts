import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { QueueItem, RelayEvent, RoomState, Track } from '@spotifyapple/shared'
import { connectRoom, type RelayConnection } from '../relay/client'
import { AdapterDeviceError, type AdapterPlaybackState, type PlaybackAdapter } from '../platform/adapter'
import { useRoomSync, type RoomSync } from './useRoomSync'

// Partial port of apps/web/src/sync/useRoomSync.test.ts (this file is a
// verbatim port of that hook, minus expo-crypto instead of the browser's
// global crypto.randomUUID()). Covers the highest-value behaviors rather
// than the web version's full regression suite — basic coverage for now,
// not a duplicate of every case already pinned down over there.
//
// Uses react-test-renderer instead of @testing-library/react + react-dom:
// apps/web pins react-dom@19 (hoisted to the workspace root by npm) while
// apps/mobile pins react@18.3.1 (react-native's peer requirement) — mixing
// those in one render tree crashes with a dual-React-instance error.
// react-test-renderer has no such conflict (no react-dom involved at all)
// and is the standard way to test hooks in a React Native codebase.

vi.mock('../relay/client', () => ({
  connectRoom: vi.fn(),
}))

vi.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid',
}))

function renderHook(callback: () => RoomSync) {
  const result = { current: undefined as unknown as RoomSync }
  function TestComponent() {
    result.current = callback()
    return null
  }
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(createElement(TestComponent))
  })
  return { result, unmount: () => act(() => renderer.unmount()) }
}

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

  it('seekTo sends playback:resume (preserving isPlaying=true) when currently playing, and clamps negative positions to 0 when paused', async () => {
    const adapter = createFakeAdapter()
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)

    const { result } = renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

    await act(async () => {
      fake.emit({ type: 'hello', clientId: 'me', isHost: true, state: makeState({ isPlaying: true }) })
    })
    act(() => result.current.seekTo(42_000))
    expect(fake.conn.send).toHaveBeenCalledWith({ type: 'playback:resume', positionMs: 42_000 })

    await act(async () => {
      fake.emit({ type: 'hello', clientId: 'me', isHost: true, state: makeState({ isPlaying: false }) })
    })
    act(() => result.current.seekTo(-5000))
    expect(fake.conn.send).toHaveBeenCalledWith({ type: 'playback:pause', positionMs: 0 })
  })

  it('addToQueue sends a queue:add event with a generated id (via expo-crypto, mocked here)', async () => {
    const adapter = createFakeAdapter()
    const fake = createFakeConnection()
    vi.mocked(connectRoom).mockReturnValue(fake.conn)

    const { result } = renderHook(() => useRoomSync({ roomId: 'ROOM1', adapter, onLog: vi.fn() }))

    await act(async () => {
      fake.emit({ type: 'hello', clientId: 'me', isHost: true, state: makeState() })
    })

    const track = makeTrack()
    act(() => result.current.addToQueue(track, 'me'))

    expect(fake.conn.send).toHaveBeenCalledWith({
      type: 'queue:add',
      item: { id: 'test-uuid', track, addedBy: 'me' },
    })
  })
})
