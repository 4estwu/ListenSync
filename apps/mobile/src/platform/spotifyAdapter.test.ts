import { afterEach, describe, expect, it, vi } from 'vitest'
import * as spotifyPlayer from '../spotify/player'
import { createSpotifyAdapter } from './spotifyAdapter'

// Partial port of apps/web/src/platform/adapter.test.ts's createSpotifyAdapter
// coverage (this file's logic is a verbatim port of that factory — see
// spotifyAdapter.ts). Basic coverage of the highest-value behaviors: state
// mapping, rate-limit backoff, and device-transfer skip logic — not a
// duplicate of every case already pinned down over there.

vi.mock('../spotify/player', async () => {
  const actual = await vi.importActual<typeof import('../spotify/player')>('../spotify/player')
  return {
    ...actual,
    getPlaybackState: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    searchTracks: vi.fn(),
    searchByIsrc: vi.fn(),
    addToQueue: vi.fn(),
  }
})

function makeDeps() {
  return { getAccessToken: vi.fn().mockResolvedValue('token123'), getDeviceId: vi.fn().mockReturnValue('device1') }
}

describe('createSpotifyAdapter getState', () => {
  afterEach(() => vi.clearAllMocks())

  it('maps a live Spotify PlaybackState to AdapterPlaybackState', async () => {
    vi.mocked(spotifyPlayer.getPlaybackState).mockResolvedValue({
      is_playing: true,
      progress_ms: 42_000,
      device: { id: 'device1', name: 'Test', type: 'Computer', is_active: true },
      item: {
        uri: 'spotify:track:abc',
        name: 'Song',
        artists: [{ name: 'Artist' }],
        album: { name: 'Album', images: [] },
        duration_ms: 200_000,
      },
    })

    const adapter = createSpotifyAdapter(makeDeps())
    const state = await adapter.getState()

    expect(state).toEqual({ isPlaying: true, positionMs: 42_000, durationMs: 200_000, platformId: 'spotify:track:abc' })
  })

  it('maps a 204 (null from getPlaybackState) to an explicit "nothing loaded" object, not null', async () => {
    vi.mocked(spotifyPlayer.getPlaybackState).mockResolvedValue(null)

    const adapter = createSpotifyAdapter(makeDeps())
    const state = await adapter.getState()

    expect(state).toEqual({ isPlaying: false, positionMs: 0, durationMs: null, platformId: null })
  })
})

describe('createSpotifyAdapter rate-limit backoff', () => {
  afterEach(() => vi.clearAllMocks())

  it('a 429 from any call (not just getState) blocks subsequent calls without hitting the network again', async () => {
    vi.mocked(spotifyPlayer.play).mockRejectedValueOnce(new spotifyPlayer.SpotifyRateLimitError(60_000))

    const adapter = createSpotifyAdapter(makeDeps())
    await expect(adapter.play('spotify:track:abc', 0)).rejects.toThrow()

    vi.mocked(spotifyPlayer.getPlaybackState).mockResolvedValue(null)
    await adapter.getState()

    expect(spotifyPlayer.getPlaybackState).not.toHaveBeenCalled()
  })
})

describe('createSpotifyAdapter device-active tracking', () => {
  afterEach(() => vi.clearAllMocks())

  it('play() forces a transfer when the device has never been confirmed active (fresh session)', async () => {
    vi.mocked(spotifyPlayer.play).mockResolvedValue(undefined)

    const adapter = createSpotifyAdapter(makeDeps())
    await adapter.play('spotify:track:abc', 0)

    expect(spotifyPlayer.play).toHaveBeenCalledWith('token123', 'device1', 'spotify:track:abc', 0, true)
  })

  it(
    "play()/seek() skip forcing a transfer once getState() has confirmed this device is already active — " +
      're-transferring an already-active device can interrupt in-flight playback',
    async () => {
      vi.mocked(spotifyPlayer.getPlaybackState).mockResolvedValue({
        is_playing: true,
        progress_ms: 1000,
        device: { id: 'device1', name: 'Test', type: 'Computer', is_active: true },
        item: { uri: 'spotify:track:abc', name: 'Song', artists: [], album: { name: '', images: [] }, duration_ms: 200_000 },
      })
      vi.mocked(spotifyPlayer.play).mockResolvedValue(undefined)
      vi.mocked(spotifyPlayer.seek).mockResolvedValue(undefined)

      const adapter = createSpotifyAdapter(makeDeps())
      await adapter.getState()
      await adapter.play(undefined, 5000)
      await adapter.seek(6000)

      expect(spotifyPlayer.play).toHaveBeenCalledWith('token123', 'device1', undefined, 5000, false)
      expect(spotifyPlayer.seek).toHaveBeenCalledWith('token123', 'device1', 6000, false)
    },
  )
})

describe('createSpotifyAdapter search', () => {
  afterEach(() => vi.clearAllMocks())

  it('maps Spotify search results, using the last (smallest — Spotify orders images largest-first) album image as thumbnail artwork', async () => {
    vi.mocked(spotifyPlayer.searchTracks).mockResolvedValue([
      {
        uri: 'spotify:track:abc',
        name: 'Song',
        artists: [{ name: 'A' }, { name: 'B' }],
        album: { name: 'Album', images: [{ url: 'large.jpg' }, { url: 'medium.jpg' }, { url: 'small.jpg' }] },
        duration_ms: 180_000,
        external_ids: { isrc: 'US1234567890' },
      },
    ])

    const adapter = createSpotifyAdapter(makeDeps())
    const results = await adapter.search('song')

    expect(results).toEqual([
      { title: 'Song', artist: 'A, B', durationMs: 180_000, isrc: 'US1234567890', platformId: 'spotify:track:abc', artworkUrl: 'small.jpg' },
    ])
  })
})

describe('createSpotifyAdapter enqueueUpcoming', () => {
  afterEach(() => vi.clearAllMocks())

  it('pushes each track to the native queue in order (sequential, not concurrent — Spotify appends in call order)', async () => {
    const calls: string[] = []
    vi.mocked(spotifyPlayer.addToQueue).mockImplementation(async (_token, _deviceId, uri) => {
      calls.push(uri)
    })

    const adapter = createSpotifyAdapter(makeDeps())
    await adapter.enqueueUpcoming?.(['spotify:track:1', 'spotify:track:2', 'spotify:track:3'])

    expect(calls).toEqual(['spotify:track:1', 'spotify:track:2', 'spotify:track:3'])
  })
})
