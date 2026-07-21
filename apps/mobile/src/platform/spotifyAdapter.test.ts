import { afterEach, describe, expect, it, vi } from 'vitest'
import * as appRemote from '../spotify/appRemotePlayer'
import * as spotifyPlayer from '../spotify/player'
import { createSpotifyAdapter } from './spotifyAdapter'

// Rewritten 2026-07-20 for the App Remote adapter (see spotifyAdapter.ts) —
// playback now goes through spotify/appRemotePlayer.ts instead of REST, so
// there's no device/rate-limit-backoff logic left in this file to cover
// (appRemotePlayer.ts's own connection-error mapping is the analogous
// behavior, not tested here — mocked out entirely below). What's left to
// cover: getState's null-mapping, that play/pause/seek/enqueueUpcoming
// delegate to the right appRemotePlayer functions, and search's mapping
// (unchanged from the REST version).

vi.mock('../spotify/appRemotePlayer', () => ({
  getState: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  queue: vi.fn(),
}))

vi.mock('../spotify/player', async () => {
  const actual = await vi.importActual<typeof import('../spotify/player')>('../spotify/player')
  return {
    ...actual,
    searchTracks: vi.fn(),
    searchByIsrc: vi.fn(),
  }
})

function makeDeps() {
  return { getAccessToken: vi.fn().mockResolvedValue('token123') }
}

describe('createSpotifyAdapter getState', () => {
  afterEach(() => vi.clearAllMocks())

  it('maps a live App Remote state to AdapterPlaybackState', async () => {
    vi.mocked(appRemote.getState).mockResolvedValue({
      isPlaying: true,
      positionMs: 42_000,
      durationMs: 200_000,
      platformId: 'spotify:track:abc',
    })

    const adapter = createSpotifyAdapter(makeDeps())
    const state = await adapter.getState()

    expect(state).toEqual({ isPlaying: true, positionMs: 42_000, durationMs: 200_000, platformId: 'spotify:track:abc' })
  })

  it('maps null (nothing loaded in Spotify) to an explicit "nothing loaded" object, not null', async () => {
    vi.mocked(appRemote.getState).mockResolvedValue(null)

    const adapter = createSpotifyAdapter(makeDeps())
    const state = await adapter.getState()

    expect(state).toEqual({ isPlaying: false, positionMs: 0, durationMs: null, platformId: null })
  })
})

describe('createSpotifyAdapter playback delegation', () => {
  afterEach(() => vi.clearAllMocks())

  it('play() passes the access-token getter, track URI, and position through to appRemotePlayer', async () => {
    vi.mocked(appRemote.play).mockResolvedValue(undefined)
    const deps = makeDeps()

    const adapter = createSpotifyAdapter(deps)
    await adapter.play('spotify:track:abc', 5000)

    expect(appRemote.play).toHaveBeenCalledWith(deps.getAccessToken, 'spotify:track:abc', 5000)
  })

  it('pause() and seek() delegate to appRemotePlayer', async () => {
    vi.mocked(appRemote.pause).mockResolvedValue(undefined)
    vi.mocked(appRemote.seek).mockResolvedValue(undefined)
    const deps = makeDeps()

    const adapter = createSpotifyAdapter(deps)
    await adapter.pause()
    await adapter.seek(6000)

    expect(appRemote.pause).toHaveBeenCalledWith(deps.getAccessToken)
    expect(appRemote.seek).toHaveBeenCalledWith(deps.getAccessToken, 6000)
  })
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

  it('pushes each track to the queue in order (sequential, not concurrent — App Remote appends in call order)', async () => {
    const calls: string[] = []
    vi.mocked(appRemote.queue).mockImplementation(async (_getAccessToken, uri) => {
      calls.push(uri)
    })

    const adapter = createSpotifyAdapter(makeDeps())
    await adapter.enqueueUpcoming?.(['spotify:track:1', 'spotify:track:2', 'spotify:track:3'])

    expect(calls).toEqual(['spotify:track:1', 'spotify:track:2', 'spotify:track:3'])
  })

  it('one track failing does not abort the rest', async () => {
    const calls: string[] = []
    vi.mocked(appRemote.queue).mockImplementation(async (_getAccessToken, uri) => {
      if (uri === 'spotify:track:2') throw new Error('boom')
      calls.push(uri)
    })

    const adapter = createSpotifyAdapter(makeDeps())
    await adapter.enqueueUpcoming?.(['spotify:track:1', 'spotify:track:2', 'spotify:track:3'])

    expect(calls).toEqual(['spotify:track:1', 'spotify:track:3'])
  })
})
