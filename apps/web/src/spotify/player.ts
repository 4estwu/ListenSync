const API_BASE = 'https://api.spotify.com/v1'

export interface SpotifyDevice {
  id: string
  name: string
  type: string
  is_active: boolean
}

export interface PlaybackState {
  is_playing: boolean
  device: SpotifyDevice
  item: { name: string; artists: { name: string }[]; uri: string } | null
}

async function spotifyFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify API ${res.status} ${path}: ${await res.text()}`)
  }
  return res
}

export async function getDevices(accessToken: string): Promise<SpotifyDevice[]> {
  const res = await spotifyFetch(accessToken, '/me/player/devices')
  const data = (await res.json()) as { devices: SpotifyDevice[] }
  return data.devices
}

/** Returns null when nothing is currently active on the account (204 No Content). */
export async function getPlaybackState(accessToken: string): Promise<PlaybackState | null> {
  const res = await spotifyFetch(accessToken, '/me/player')
  if (res.status === 204) return null
  return (await res.json()) as PlaybackState
}

export async function play(accessToken: string, deviceId: string, trackUri?: string): Promise<void> {
  await spotifyFetch(accessToken, `/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: trackUri ? JSON.stringify({ uris: [trackUri] }) : undefined,
  })
}

export async function pause(accessToken: string, deviceId: string): Promise<void> {
  await spotifyFetch(accessToken, `/me/player/pause?device_id=${deviceId}`, { method: 'PUT' })
}

export async function skipNext(accessToken: string, deviceId: string): Promise<void> {
  await spotifyFetch(accessToken, `/me/player/next?device_id=${deviceId}`, { method: 'POST' })
}
