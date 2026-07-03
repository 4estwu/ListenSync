// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { QueueItem, RelayEvent, RoomState, Track } from '@spotifyapple/shared'
import { connectRoom, type RelayConnection } from '../relay/client'
import type { AdapterPlaybackState, PlaybackAdapter } from '../platform/adapter'
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
})
