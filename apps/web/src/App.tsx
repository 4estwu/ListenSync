import { useEffect, useState } from 'react'
import {
  consumePendingRoom,
  getStoredToken,
  handleRedirectCallback,
  redirectToAuthorize,
  type SpotifyToken,
} from './spotify/auth'
import RoomView from './RoomView'
import './App.css'

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I, easier to read aloud
  const values = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(values, (v) => chars[v % chars.length]).join('')
}

function App() {
  const [token, setToken] = useState<SpotifyToken | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState('')

  const [pendingRoomFromUrl] = useState(() => new URLSearchParams(window.location.search).get('room'))

  useEffect(() => {
    handleRedirectCallback()
      .then((exchanged) => {
        if (exchanged) {
          setToken(exchanged)
          const pending = consumePendingRoom()
          if (pending) setRoomId(pending)
          return
        }
        const stored = getStoredToken()
        if (stored) setToken(stored)
      })
      .catch((err: Error) => setAuthError(err.message))
  }, [])

  // Already logged in (no OAuth redirect just happened) and opened a share link directly.
  useEffect(() => {
    if (token && pendingRoomFromUrl && !roomId) setRoomId(pendingRoomFromUrl)
  }, [token, pendingRoomFromUrl, roomId])

  if (!token) {
    return (
      <section id="center">
        <h1>{pendingRoomFromUrl ? "You've been invited to a listening room" : 'Synced listening'}</h1>
        {authError && <p style={{ color: 'tomato' }}>{authError}</p>}
        <button type="button" onClick={() => void redirectToAuthorize(pendingRoomFromUrl ?? undefined)}>
          {pendingRoomFromUrl ? 'Log in with Spotify to join' : 'Log in with Spotify'}
        </button>
      </section>
    )
  }

  if (!roomId) {
    return (
      <section id="center">
        <h1>Start or join a room</h1>
        <div>
          <button type="button" onClick={() => setRoomId(generateRoomCode())}>
            Create a room
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="room code" />
          <button type="button" onClick={() => setRoomId(joinCode.trim())} disabled={!joinCode.trim()}>
            Join
          </button>
        </div>
      </section>
    )
  }

  return <RoomView roomId={roomId} token={token} setToken={setToken} />
}

export default App
