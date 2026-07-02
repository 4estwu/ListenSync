import { describe, expect, it, vi } from 'vitest'
import type { Track } from '@spotifyapple/shared'
import type { AdapterTrackResult, PlaybackAdapter } from '../platform/adapter'
import { resolveTrackUri } from './resolveTrack'

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    title: 'Some Song',
    artist: 'Some Artist',
    durationMs: 200_000,
    platformIds: {},
    ...overrides,
  }
}

function makeSearchResult(platformId: string): AdapterTrackResult {
  return { title: 'Some Song', artist: 'Some Artist', durationMs: 200_000, platformId }
}

function makeFakeAdapter(overrides: Partial<PlaybackAdapter> = {}): PlaybackAdapter {
  return {
    platform: 'apple',
    getState: vi.fn().mockResolvedValue(null),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    resolveByIsrc: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

describe('resolveTrackUri', () => {
  it("uses the track's own platform id directly, without any network calls, when the adder was on this platform", async () => {
    const adapter = makeFakeAdapter({ platform: 'apple' })
    const track = makeTrack({ platformIds: { apple: 'apple-id-123' } })

    const result = await resolveTrackUri(adapter, track, new Map())

    expect(result).toBe('apple-id-123')
    expect(adapter.resolveByIsrc).not.toHaveBeenCalled()
    expect(adapter.search).not.toHaveBeenCalled()
  })

  it('resolves via ISRC when the track has no id for this platform', async () => {
    const adapter = makeFakeAdapter({ resolveByIsrc: vi.fn().mockResolvedValue('resolved-via-isrc') })
    const track = makeTrack({ isrc: 'US1234567890', platformIds: { spotify: 'spotify-id' } })

    const result = await resolveTrackUri(adapter, track, new Map())

    expect(result).toBe('resolved-via-isrc')
    expect(adapter.resolveByIsrc).toHaveBeenCalledWith('US1234567890')
    expect(adapter.search).not.toHaveBeenCalled()
  })

  it('falls back to a title/artist search when ISRC lookup comes up empty', async () => {
    const adapter = makeFakeAdapter({
      resolveByIsrc: vi.fn().mockResolvedValue(null),
      search: vi.fn().mockResolvedValue([makeSearchResult('found-via-search')]),
    })
    const track = makeTrack({ isrc: 'US1234567890' })

    const result = await resolveTrackUri(adapter, track, new Map())

    expect(result).toBe('found-via-search')
    expect(adapter.search).toHaveBeenCalledWith('Some Song Some Artist')
  })

  it('falls straight to search when the track has no ISRC at all', async () => {
    const adapter = makeFakeAdapter({ search: vi.fn().mockResolvedValue([makeSearchResult('found-via-search')]) })
    const track = makeTrack({ isrc: undefined })

    const result = await resolveTrackUri(adapter, track, new Map())

    expect(result).toBe('found-via-search')
    expect(adapter.resolveByIsrc).not.toHaveBeenCalled()
  })

  it('returns null when neither ISRC lookup nor search finds anything', async () => {
    const adapter = makeFakeAdapter()
    const track = makeTrack({ isrc: 'US1234567890' })

    const result = await resolveTrackUri(adapter, track, new Map())

    expect(result).toBeNull()
  })

  it('caches a resolved id and does not re-query on a second call for the same track', async () => {
    const resolveByIsrc = vi.fn().mockResolvedValue('resolved-once')
    const adapter = makeFakeAdapter({ resolveByIsrc })
    const track = makeTrack({ isrc: 'US1234567890' })
    const cache = new Map<string, string | null>()

    await resolveTrackUri(adapter, track, cache)
    const second = await resolveTrackUri(adapter, track, cache)

    expect(second).toBe('resolved-once')
    expect(resolveByIsrc).toHaveBeenCalledTimes(1)
  })

  it('also caches a failed resolution, so a track that keeps coming up empty stops being re-queried every tick', async () => {
    const search = vi.fn().mockResolvedValue([])
    const adapter = makeFakeAdapter({ search })
    const track = makeTrack({ isrc: undefined, title: 'Unmatchable', artist: 'Nobody' })
    const cache = new Map<string, string | null>()

    await resolveTrackUri(adapter, track, cache)
    await resolveTrackUri(adapter, track, cache)

    expect(search).toHaveBeenCalledTimes(1)
  })
})
