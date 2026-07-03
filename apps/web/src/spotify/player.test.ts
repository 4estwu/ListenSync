import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { pause, play, seek, SpotifyDeviceError } from './player'

const TRANSFER_URL = 'https://api.spotify.com/v1/me/player'
const PLAY_URL = 'https://api.spotify.com/v1/me/player/play?device_id=device1'

describe('play', () => {
  let fetchMock: Mock

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(
    'transfers playback to the device before resuming in place (no track uri) — ' +
      'a device that lost active status can otherwise silently no-op on resume',
    async () => {
      await play('token', 'device1', undefined, 5000)

      const urls = fetchMock.mock.calls.map((call) => call[0] as string)
      expect(urls[0]).toBe(TRANSFER_URL)
      expect(urls[1]).toBe(PLAY_URL)
    },
  )

  it('transfers playback before starting a specific new track', async () => {
    await play('token', 'device1', 'spotify:track:xyz', 0)

    const urls = fetchMock.mock.calls.map((call) => call[0] as string)
    expect(urls[0]).toBe(TRANSFER_URL)
    expect(urls[1]).toBe(PLAY_URL)
  })

  it(
    'the transfer call targets the right device and explicitly asserts play:true — ' +
      'omitting it leaves Spotify\'s backend to "keep current state" (still paused, ' +
      'since we always transfer right before a resume), which can race with and revert ' +
      'the separate /play call a few seconds later',
    async () => {
      await play('token', 'device1', undefined, undefined)

      const transferCall = fetchMock.mock.calls[0]
      const body = JSON.parse((transferCall[1] as RequestInit).body as string) as { device_ids: string[]; play: boolean }
      expect(body).toEqual({ device_ids: ['device1'], play: true })
    },
  )

  it(
    'skips the transfer entirely when forceTransfer=false — re-transferring an already-active ' +
      'device can interrupt the Web Playback SDK mid-buffer, not just a harmless extra call',
    async () => {
      await play('token', 'device1', undefined, 5000, false)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(PLAY_URL)
    },
  )
})

describe('pause', () => {
  let fetchMock: Mock

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not transfer playback first (pausing an inactive device is a no-op either way)', async () => {
    await pause('token', 'device1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/me/player/pause')
  })
})

describe('seek', () => {
  let fetchMock: Mock

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(
    'transfers playback first by default — a device can drop active status sometime after a ' +
      'successful resume, and seeking a no-longer-active device is as silent a no-op as playing one',
    async () => {
      await seek('token', 'device1', 1000)

      const urls = fetchMock.mock.calls.map((call) => call[0] as string)
      expect(urls[0]).toBe(TRANSFER_URL)
      expect(urls[1]).toContain('/me/player/seek')
    },
  )

  it('skips the transfer when forceTransfer=false (the device was just confirmed active)', async () => {
    await seek('token', 'device1', 1000, false)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/me/player/seek')
  })

  it(
    'throws SpotifyDeviceError (not a generic Error) on a 404 — this is Spotify\'s shape for ' +
      "a device whose Connect session has actually ended, distinct from other failures so the UI can explain it",
    async () => {
      fetchMock.mockResolvedValue(new Response('{"error":{"status":404,"message":"Device not found"}}', { status: 404 }))
      await expect(seek('token', 'device1', 1000, false)).rejects.toBeInstanceOf(SpotifyDeviceError)
    },
  )
})
