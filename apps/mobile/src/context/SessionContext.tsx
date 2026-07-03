import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Platform } from '@spotifyapple/shared'
import type { PlaybackAdapter } from '../platform/adapter'
import { createSpotifyAdapter } from '../platform/spotifyAdapter'
import { createAppleMusicAdapter } from '../platform/appleMusicAdapter'

// Mirrors the top-level state apps/web/src/App.tsx holds directly (platform,
// auth status, adapter instance) — pulled into a context here instead so
// React Navigation screens can each read/update it without prop-drilling
// through route params. Auth state itself (isSpotifyAuthed/isAppleAuthed) is
// a placeholder boolean for now — real auth wiring depends on the
// unverified native SDK calls in platform/spotifyAdapter.ts and
// platform/appleMusicAdapter.ts (see their TODO(native) comments).

interface SessionState {
  platform: Platform | null
  setPlatform: (platform: Platform | null) => void
  isSpotifyAuthed: boolean
  setSpotifyAuthed: (authed: boolean) => void
  isAppleAuthed: boolean
  setAppleAuthed: (authed: boolean) => void
  roomId: string | null
  setRoomId: (roomId: string | null) => void
  adapter: PlaybackAdapter | null
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [isSpotifyAuthed, setSpotifyAuthed] = useState(false)
  const [isAppleAuthed, setAppleAuthed] = useState(false)
  const [roomId, setRoomId] = useState<string | null>(null)

  const adapter = useMemo<PlaybackAdapter | null>(() => {
    if (platform === 'spotify' && isSpotifyAuthed) return createSpotifyAdapter()
    if (platform === 'apple' && isAppleAuthed) return createAppleMusicAdapter()
    return null
  }, [platform, isSpotifyAuthed, isAppleAuthed])

  const value: SessionState = {
    platform,
    setPlatform,
    isSpotifyAuthed,
    setSpotifyAuthed,
    isAppleAuthed,
    setAppleAuthed,
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
