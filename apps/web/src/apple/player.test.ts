import { describe, expect, it, vi } from 'vitest'
import { play } from './player'

function makeMusicKit(overrides: Partial<MusicKit.MusicKitInstance> = {}): MusicKit.MusicKitInstance {
  return {
    isAuthorized: true,
    storefrontId: 'us',
    musicUserToken: 'token',
    isPlaying: false,
    currentPlaybackTime: 0,
    nowPlayingItem: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seekToTime: vi.fn().mockResolvedValue(undefined),
    api: { music: vi.fn() },
    authorize: vi.fn(),
    unauthorize: vi.fn(),
    setQueue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('play', () => {
  it('calls setQueue when nothing is loaded yet (a genuine track switch)', async () => {
    const music = makeMusicKit({ nowPlayingItem: null })

    await play(music, 'song-1', 0)

    expect(music.setQueue).toHaveBeenCalledWith({ song: 'song-1', startPlaying: true })
  })

  it(
    'does not re-call setQueue when the requested song is already loaded — regression: unconditionally ' +
      're-queuing an already-playing song destabilized MusicKit\'s nowPlayingItem, causing it to read null ' +
      'right after a successful switch and repeatedly re-trigger the same "switch" every few seconds, which ' +
      'is what actually produced the reported "track keeps looping" symptom (see useRoomSync\'s ' +
      'needsTrackSwitch, which calls this on every poll while platformId reads null)',
    async () => {
      const music = makeMusicKit({
        isPlaying: true,
        nowPlayingItem: { id: 'song-1', playbackDuration: 200 },
      })

      await play(music, 'song-1', 30_000)

      expect(music.setQueue).not.toHaveBeenCalled()
      expect(music.seekToTime).toHaveBeenCalledWith(30)
    },
  )

  it('calls play() (not setQueue) to resume when already-loaded audio is currently paused', async () => {
    const music = makeMusicKit({
      isPlaying: false,
      nowPlayingItem: { id: 'song-1', playbackDuration: 200 },
    })

    await play(music, 'song-1', undefined)

    expect(music.setQueue).not.toHaveBeenCalled()
    expect(music.play).toHaveBeenCalled()
  })

  it('calls setQueue when switching to a genuinely different song than what is currently loaded', async () => {
    const music = makeMusicKit({
      isPlaying: true,
      nowPlayingItem: { id: 'song-1', playbackDuration: 200 },
    })

    await play(music, 'song-2', 0)

    expect(music.setQueue).toHaveBeenCalledWith({ song: 'song-2', startPlaying: true })
  })

  it('plain resume-in-place (no catalogId) calls play() directly, same as before', async () => {
    const music = makeMusicKit({ isPlaying: false })

    await play(music, undefined, 5000)

    expect(music.setQueue).not.toHaveBeenCalled()
    expect(music.play).toHaveBeenCalled()
    expect(music.seekToTime).toHaveBeenCalledWith(5)
  })
})
