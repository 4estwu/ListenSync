import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Platform } from '@spotifyapple/shared'
import type { PlaybackAdapter } from '../platform/adapter'
import { createSpotifyAdapter } from '../platform/spotifyAdapter'
import { ensureFreshToken, type SpotifyToken } from '../spotify/auth'
import { getDevices, type SpotifyDevice } from '../spotify/player'

// Mirrors the top-level state apps/web/src/App.tsx holds directly (platform,
// auth status, adapter instance) — pulled into a context here instead so
// React Navigation screens can each read/update it without prop-drilling
// through route params.
//
// Apple Music has no entry here: it's handled entirely by launching the
// already-working web app in a Chrome Custom Tab (see AppleMusicScreen.tsx),
// which owns its own auth and sync state internally. `adapter` is therefore
// only ever populated for the native Spotify path.
//
// spotifyToken IS the "authed" signal (like apps/web — no separate boolean),
// and getSpotifyAccessToken/getSpotifyDeviceId are stable callbacks backed by
// refs (same pattern as App.tsx) so the adapter itself is created once, not
// recreated on every token refresh or device change.

interface SessionState {
  platform: Platform | null
  setPlatform: (platform: Platform | null) => void
  spotifyToken: SpotifyToken | null
  setSpotifyToken: (token: SpotifyToken | null) => void
  spotifyDevices: SpotifyDevice[]
  spotifyDeviceId: string | null
  setSpotifyDeviceId: (id: string | null) => void
  refreshSpotifyDevices: () => Promise<void>
  roomId: string | null
  setRoomId: (roomId: string | null) => void
  adapter: PlaybackAdapter | null
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [spotifyToken, setSpotifyToken] = useState<SpotifyToken | null>(null)
  const [spotifyDevices, setSpotifyDevices] = useState<SpotifyDevice[]>([])
  const [spotifyDeviceId, setSpotifyDeviceId] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)

  const spotifyTokenRef = useRef(spotifyToken)
  useEffect(() => {
    spotifyTokenRef.current = spotifyToken
  }, [spotifyToken])
  const spotifyDeviceIdRef = useRef(spotifyDeviceId)
  useEffect(() => {
    spotifyDeviceIdRef.current = spotifyDeviceId
  }, [spotifyDeviceId])

  const getSpotifyAccessToken = useCallback(async () => {
    if (!spotifyTokenRef.current) throw new Error('Not logged in to Spotify')
    // No silent refresh path here — see spotify/auth.ts's ensureFreshToken
    // doc comment: this native SDK's refresh needs a server-side proxy
    // holding the client secret, not implemented yet, so an expired token
    // just throws (surfaced as "log in again") rather than auto-renewing.
    return ensureFreshToken(spotifyTokenRef.current).accessToken
  }, [])
  const getSpotifyDeviceId = useCallback(() => {
    if (!spotifyDeviceIdRef.current) throw new Error('No Spotify device selected')
    return spotifyDeviceIdRef.current
  }, [])

  const refreshSpotifyDevices = useCallback(async () => {
    if (!spotifyTokenRef.current) return
    const list = await getDevices(await getSpotifyAccessToken())
    setSpotifyDevices(list)
    if (spotifyDeviceIdRef.current && list.some((d) => d.id === spotifyDeviceIdRef.current)) return
    const active = list.find((d) => d.is_active)
    setSpotifyDeviceId(active?.id ?? list[0]?.id ?? null)
  }, [getSpotifyAccessToken])

  const adapter = useMemo<PlaybackAdapter | null>(() => {
    if (platform === 'spotify' && spotifyToken) {
      return createSpotifyAdapter({ getAccessToken: getSpotifyAccessToken, getDeviceId: getSpotifyDeviceId })
    }
    return null
  }, [platform, spotifyToken, getSpotifyAccessToken, getSpotifyDeviceId])

  const value: SessionState = {
    platform,
    setPlatform,
    spotifyToken,
    setSpotifyToken,
    spotifyDevices,
    spotifyDeviceId,
    setSpotifyDeviceId,
    refreshSpotifyDevices,
    roomId,
    setRoomId,
    adapter,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within a SessionProvider')
  return ctx
}
