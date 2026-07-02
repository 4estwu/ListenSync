import type { Track } from '@spotifyapple/shared'
import type { PlaybackAdapter } from '../platform/adapter'

/**
 * Resolves a shared queue Track to this adapter's own platform id: uses
 * `platformIds[adapter.platform]` directly if the adder was on this platform,
 * otherwise looks it up by ISRC, falling back to a plain title/artist search
 * (first hit — deliberately simple, not scored/fuzzy-matched) when ISRC is
 * unavailable. Results are memoized in `cache` so repeat polling ticks for the
 * same track don't re-query.
 */
export async function resolveTrackUri(
  adapter: PlaybackAdapter,
  track: Track,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const own = track.platformIds[adapter.platform]
  if (own) return own

  const cacheKey = track.isrc ?? `${track.title}|${track.artist}`
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null

  let resolved: string | null = null
  if (track.isrc) {
    resolved = await adapter.resolveByIsrc(track.isrc)
  }
  if (!resolved) {
    const results = await adapter.search(`${track.title} ${track.artist}`)
    resolved = results[0]?.platformId ?? null
  }

  cache.set(cacheKey, resolved)
  return resolved
}
