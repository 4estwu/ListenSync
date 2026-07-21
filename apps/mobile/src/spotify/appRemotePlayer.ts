import { AppRemote, AppRemoteError, Player, PlayerError, SpotifyURI } from '@wwdrew/expo-spotify-sdk'
import { AdapterDeviceError } from '../platform/adapter'

// Backs platform/spotifyAdapter.ts's play/pause/seek/getState/enqueueUpcoming
// via App Remote instead of Spotify Web API REST calls — the whole point
// being that App Remote controls the Spotify app already running on THIS
// device directly (over IPC), so there's no separate "active external
// device" concept at all: no device list, no transfer-before-play, no
// device_id threaded through every call. That was the actual UX problem App
// Remote was brought in to fix (see MOBILE_V2_PLAN.md's App Remote section)
// — the REST path this replaces needed the user to already have Spotify
// open and playing something *elsewhere* before this app could do anything.
//
// Android-specific (per @wwdrew/expo-spotify-sdk's own docs): AppRemote.connect()
// takes an accessToken for API parity with iOS, but the Android App Remote
// SDK actually uses whatever session the Spotify app itself cached from the
// most recent Auth.authenticate() — so a fresh, valid token from that call
// is what actually matters, not literally passing it through here.

/** Ensures an App Remote connection exists before running fn — connect() is a documented no-op when already connected. */
async function withConnection<T>(getAccessToken: () => Promise<string>, fn: () => Promise<T>): Promise<T> {
  try {
    if (!AppRemote.isConnected()) {
      await AppRemote.connect(await getAccessToken())
    }
    return await fn()
  } catch (err) {
    if (err instanceof AppRemoteError || err instanceof PlayerError) {
      if (err.code === 'NOT_CONNECTED' || err.code === 'CONNECTION_LOST' || err.code === 'CONNECTION_FAILED') {
        throw new AdapterDeviceError(err.message)
      }
    }
    throw err
  }
}

export interface AppRemoteState {
  isPlaying: boolean
  positionMs: number
  durationMs: number
  platformId: string
}

export async function getState(getAccessToken: () => Promise<string>): Promise<AppRemoteState | null> {
  return withConnection(getAccessToken, async () => {
    const state = await Player.getPlayerState().catch((err) => {
      // Spotify has nothing loaded at all (fresh connect, nothing ever
      // played) — App Remote doesn't have a clean "empty" response, it just
      // throws. Anything else (PREMIUM_REQUIRED, connection errors) should
      // still propagate.
      if (err instanceof PlayerError && err.code === 'UNKNOWN') return null
      throw err
    })
    if (!state) return null
    return {
      isPlaying: !state.isPaused,
      positionMs: state.playbackPosition,
      durationMs: state.track.duration,
      platformId: state.track.uri,
    }
  })
}

export async function play(getAccessToken: () => Promise<string>, trackUri?: string, positionMs?: number): Promise<void> {
  await withConnection(getAccessToken, async () => {
    if (trackUri) {
      await Player.play(SpotifyURI.unsafe(trackUri))
    } else {
      await Player.resume()
    }
    if (positionMs !== undefined) await Player.seekTo(positionMs)
  })
}

export async function pause(getAccessToken: () => Promise<string>): Promise<void> {
  await withConnection(getAccessToken, () => Player.pause())
}

export async function seek(getAccessToken: () => Promise<string>, positionMs: number): Promise<void> {
  await withConnection(getAccessToken, () => Player.seekTo(positionMs))
}

export async function skipNext(getAccessToken: () => Promise<string>): Promise<void> {
  await withConnection(getAccessToken, () => Player.skipNext())
}

/** Best-effort, matching the REST version's semantics — one track failing shouldn't abort the rest. */
export async function queue(getAccessToken: () => Promise<string>, trackUri: string): Promise<void> {
  await withConnection(getAccessToken, () => Player.queue(SpotifyURI.unsafe(trackUri)))
}
