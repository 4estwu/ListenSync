import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Platform } from '@spotifyapple/shared'
import type { PlaybackAdapter } from '../platform/adapter'
import { createSpotifyAdapter } from '../platform/spotifyAdapter'
import { ensureFreshToken, type SpotifyToken } from '../spotify/auth'

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
// spotifyToken IS the "authed" signal (like apps/web — no separate boolean).
// No device concept here (unlike the pre-App-Remote version — see git
// history): App Remote controls the Spotify app running on this same
// device directly, over IPC, so there's nothing to list or pick.
// getSpotifyAccessToken is a stable callback backed by a ref (same pattern
// as App.tsx) so the adapter itself is created once, not recreated on every
// token refresh.

interface SessionState {
  platform: Platform | null
  setPlatform: (platform: Platform | null) => void
  spotifyToken: SpotifyToken | null
  setSpotifyToken: (token: SpotifyToken | null) => void
  roomId: string | null
  setRoomId: (roomId: string | null) => void
  adapter: PlaybackAdapter | null
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [spotifyToken, setSpotifyTokenState] = useState<SpotifyToken | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)

  const spotifyTokenRef = useRef(spotifyToken)
  const setSpotifyToken = useCallback((token: SpotifyToken | null) => {
    spotifyTokenRef.current = token
    setSpotifyTokenState(token)
  }, [])

  const getSpotifyAccessToken = useCallback(async () => {
    if (!spotifyTokenRef.current) throw new Error('Not logged in to Spotify')
    // No silent refresh path here — see spotify/auth.ts's ensureFreshToken
    // doc comment: this native SDK's refresh needs a server-side proxy
    // holding the client secret, not implemented yet, so an expired token
    // just throws (surfaced as "log in again") rather than auto-renewing.
    return ensureFreshToken(spotifyTokenRef.current).accessToken
  }, [])

  const adapter = useMemo<PlaybackAdapter | null>(() => {
    if (platform === 'spotify' && spotifyToken) {
      return createSpotifyAdapter({ getAccessToken: getSpotifyAccessToken })
    }
    return null
  }, [platform, spotifyToken, getSpotifyAccessToken])

  const value: SessionState = {
    platform,
    setPlatform,
    spotifyToken,
    setSpotifyToken,
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
