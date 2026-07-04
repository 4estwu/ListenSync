import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Platform } from '@spotifyapple/shared'
import type { PlaybackAdapter } from '../platform/adapter'
import { createSpotifyAdapter } from '../platform/spotifyAdapter'

// Mirrors the top-level state apps/web/src/App.tsx holds directly (platform,
// auth status, adapter instance) — pulled into a context here instead so
// React Navigation screens can each read/update it without prop-drilling
// through route params.
//
// Apple Music has no entry here: it's handled entirely by embedding the
// already-working web app in a WebView (see AppleMusicWebViewScreen.tsx),
// which owns its own auth and sync state internally. `adapter` is therefore
// only ever populated for the native Spotify path.

interface SessionState {
  platform: Platform | null
  setPlatform: (platform: Platform | null) => void
  isSpotifyAuthed: boolean
  setSpotifyAuthed: (authed: boolean) => void
  roomId: string | null
  setRoomId: (roomId: string | null) => void
  adapter: PlaybackAdapter | null
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [isSpotifyAuthed, setSpotifyAuthed] = useState(false)
  const [roomId, setRoomId] = useState<string | null>(null)

  const adapter = useMemo<PlaybackAdapter | null>(() => {
    if (platform === 'spotify' && isSpotifyAuthed) return createSpotifyAdapter()
    return null
  }, [platform, isSpotifyAuthed])

  const value: SessionState = {
    platform,
    setPlatform,
    isSpotifyAuthed,
    setSpotifyAuthed,
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
