export interface AppleTrackSummary {
  id: string
  name: string
  artist: string
  durationMs: number
  isrc?: string
  artworkUrl?: string
}

export interface ApplePlaybackState {
  isPlaying: boolean
  positionMs: number
  durationMs: number | null
  catalogId: string | null
}

interface CatalogSong {
  id: string
  attributes: {
    name: string
    artistName: string
    durationInMillis: number
    isrc?: string
    artwork?: { url: string }
  }
}

function toSummary(song: CatalogSong): AppleTrackSummary {
  return {
    id: song.id,
    name: song.attributes.name,
    artist: song.attributes.artistName,
    durationMs: song.attributes.durationInMillis,
    isrc: song.attributes.isrc,
    artworkUrl: song.attributes.artwork?.url.replace('{w}x{h}', '64x64'),
  }
}

export async function searchTracks(music: MusicKit.MusicKitInstance, query: string, limit = 10): Promise<AppleTrackSummary[]> {
  const res = await music.api.music<{ results: { songs?: { data: CatalogSong[] } } }>(
    `/v1/catalog/${music.storefrontId}/search`,
    { term: query, types: 'songs', limit },
  )
  return (res.data.results.songs?.data ?? []).map(toSummary)
}

export async function lookupByIsrc(music: MusicKit.MusicKitInstance, isrc: string): Promise<AppleTrackSummary | null> {
  const res = await music.api.music<{ data: CatalogSong[] }>(`/v1/catalog/${music.storefrontId}/songs`, {
    'filter[isrc]': isrc,
  })
  const song = res.data.data[0]
  return song ? toSummary(song) : null
}

/**
 * Only calls setQueue() when catalogId is actually different from what's
 * already loaded — re-queuing a song that's already playing turned out to be
 * actively destabilizing, not just redundant: nowPlayingItem going briefly
 * null right after setQueue is apparently normal MusicKit JS behavior (an
 * async internal settling window), but useRoomSync's needsTrackSwitch reads
 * that null and, believing nothing is loaded, calls play() again — which
 * re-queues the SAME song, restarting that settling window before it
 * finished, so nowPlayingItem never gets the chance to actually settle. That
 * repeating cycle (visible as "switched to X, was playing nothing" every
 * ~3-4s in the log, bounded by useRoomSync's correction cooldown) is what
 * read to the user as the track looping — this was the cause, not a symptom.
 */
export async function play(music: MusicKit.MusicKitInstance, catalogId?: string, positionMs?: number): Promise<void> {
  if (catalogId && music.nowPlayingItem?.id !== catalogId) {
    await music.setQueue({ song: catalogId, startPlaying: true })
  } else if (!music.isPlaying) {
    await music.play()
  }
  if (positionMs !== undefined) await music.seekToTime(positionMs / 1000)
}

export async function pause(music: MusicKit.MusicKitInstance): Promise<void> {
  await music.pause()
}

export async function seek(music: MusicKit.MusicKitInstance, positionMs: number): Promise<void> {
  await music.seekToTime(positionMs / 1000)
}

export function getPlaybackState(music: MusicKit.MusicKitInstance): ApplePlaybackState {
  const item = music.nowPlayingItem
  return {
    isPlaying: music.isPlaying,
    positionMs: music.currentPlaybackTime * 1000,
    durationMs: item ? item.playbackDuration * 1000 : null,
    catalogId: item?.id ?? null,
  }
}
