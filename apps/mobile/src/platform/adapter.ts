import type { Platform } from '@spotifyapple/shared'

// Same shape as apps/web/src/platform/adapter.ts's PlaybackAdapter —
// deliberately kept identical so useRoomSync (ported into
// ../sync/useRoomSync.ts) needs zero changes to work against either a
// browser-backed or native-SDK-backed implementation. Only what implements
// this interface differs between the two apps.

export interface AdapterTrackResult {
  title: string
  artist: string
  durationMs: number
  isrc?: string
  platformId: string
  artworkUrl?: string
}

export interface AdapterPlaybackState {
  isPlaying: boolean
  positionMs: number
  durationMs: number | null
  platformId: string | null
}

export class AdapterDeviceError extends Error {}

export interface PlaybackAdapter {
  platform: Platform
  getState(): Promise<AdapterPlaybackState | null>
  play(platformId?: string, positionMs?: number): Promise<void>
  pause(): Promise<void>
  seek(positionMs: number): Promise<void>
  search(query: string): Promise<AdapterTrackResult[]>
  resolveByIsrc(isrc: string): Promise<string | null>
  onDiagnostic?(cb: (message: string) => void): void
  enqueueUpcoming?(platformIds: string[]): Promise<void>
}
