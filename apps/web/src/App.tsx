import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Platform } from '@spotifyapple/shared'
import {
  consumePendingRoom,
  ensureFreshToken,
  getStoredToken,
  handleRedirectCallback,
  redirectToAuthorize,
  type SpotifyToken,
} from './spotify/auth'
import { getDevices, type SpotifyDevice } from './spotify/player'
import { connectWebPlaybackDevice } from './spotify/webPlayback'
import { authorizeAppleMusic, getMusicKit } from './apple/musicKit'
import { createAppleAdapter, createSpotifyAdapter } from './platform/adapter'
import RoomChooser from './RoomChooser'
import RoomView from './RoomView'
import './App.css'

function App() {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [pendingRoomFromUrl] = useState(() => new URLSearchParams(window.location.search).get('room'))

  // --- Spotify ---
  const [spotifyToken, setSpotifyToken] = useState<SpotifyToken | null>(null)
  const [spotifyAuthError, setSpotifyAuthError] = useState<string | null>(null)
  const [webPlaybackError, setWebPlaybackError] = useState<string | null>(null)
  const [devices, setDevices] = useState<SpotifyDevice[]>([])
  const [deviceId, setDeviceId] = useState('')

  const spotifyTokenRef = useRef(spotifyToken)
  useEffect(() => {
    spotifyTokenRef.current = spotifyToken
  }, [spotifyToken])
  const deviceIdRef = useRef(deviceId)
  useEffect(() => {
    deviceIdRef.current = deviceId
  }, [deviceId])

  // Tracked via ref (not just state) so refreshDevices below can read the
  // latest value without needing it in its own dependency array.
  const [webPlaybackDeviceId, setWebPlaybackDeviceId] = useState<string | null>(null)
  const webPlaybackDeviceIdRef = useRef(webPlaybackDeviceId)
  useEffect(() => {
    webPlaybackDeviceIdRef.current = webPlaybackDeviceId
  }, [webPlaybackDeviceId])

  const getSpotifyAccessToken = useCallback(async () => {
    if (!spotifyTokenRef.current) throw new Error('Not logged in to Spotify')
    const fresh = await ensureFreshToken(spotifyTokenRef.current)
    if (fresh !== spotifyTokenRef.current) {
      spotifyTokenRef.current = fresh
      setSpotifyToken(fresh)
    }
    return fresh.accessToken
  }, [])
  const getDeviceId = useCallback(() => deviceIdRef.current, [])

  const spotifyAdapter = useMemo(
    () => createSpotifyAdapter({ getAccessToken: getSpotifyAccessToken, getDeviceId }),
    [getSpotifyAccessToken, getDeviceId],
  )

  const refreshDevices = useCallback(async () => {
    try {
      const accessToken = await getSpotifyAccessToken()
      const list = await getDevices(accessToken)
      setSpotifyAuthError(null)
      setDevices(list)
      // Prefer an external device over the Web Playback SDK one (it'll show
      // up in this same list once connected) — see the note by
      // connectWebPlaybackDevice below on why it shouldn't win by default.
      const externalDevices = list.filter((d) => d.id !== webPlaybackDeviceIdRef.current)
      const active = externalDevices.find((d) => d.is_active) ?? list.find((d) => d.is_active)
      if (active) setDeviceId(active.id)
      else if (externalDevices[0]) setDeviceId(externalDevices[0].id)
      else if (list[0]) setDeviceId(list[0].id)
    } catch (err) {
      setSpotifyAuthError((err as Error).message)
    }
  }, [getSpotifyAccessToken])

  useEffect(() => {
    handleRedirectCallback()
      .then((exchanged) => {
        if (exchanged) {
          setPlatform('spotify')
          setSpotifyToken(exchanged)
          const pending = consumePendingRoom()
          if (pending) setRoomId(pending)
          return
        }
        const stored = getStoredToken()
        if (stored) setSpotifyToken(stored)
      })
      .catch((err: Error) => setSpotifyAuthError(err.message))
  }, [])

  useEffect(() => {
    if (platform === 'spotify' && spotifyToken) void refreshDevices()
  }, [platform, spotifyToken, refreshDevices])

  // Registers this tab itself as a playable device, matching Apple Music's
  // in-browser playback — stays available in the picker below, but does NOT
  // override an external device as the default. It used to always win the
  // race and become the default device; confirmed in testing that the Web
  // Playback SDK can be genuinely unreliable in a given browser environment
  // (DRM/codec issues outside this app's control — an external device with
  // the exact same reconciliation logic played back perfectly), so silently
  // defaulting to it regressed a working setup into a broken one. Only
  // becomes the default if no external device is found at all. Soft-fails
  // otherwise: if it doesn't work (e.g. non-Premium account), external-device
  // selection still works exactly as before.
  useEffect(() => {
    if (platform !== 'spotify' || !spotifyToken) return
    connectWebPlaybackDevice(getSpotifyAccessToken)
      .then((id) => {
        setWebPlaybackDeviceId(id)
        setDeviceId((prev) => prev || id)
      })
      .catch((err: Error) => setWebPlaybackError(err.message))
  }, [platform, spotifyToken, getSpotifyAccessToken])

  // --- Apple Music ---
  const [musicKitInstance, setMusicKitInstance] = useState<MusicKit.MusicKitInstance | null>(null)
  const [appleAuthorizing, setAppleAuthorizing] = useState(false)
  const [appleAuthError, setAppleAuthError] = useState<string | null>(null)

  const appleAdapter = useMemo(() => (musicKitInstance ? createAppleAdapter(musicKitInstance) : null), [musicKitInstance])

  const handleAppleLogin = async () => {
    setAppleAuthorizing(true)
    setAppleAuthError(null)
    try {
      await authorizeAppleMusic()
      setMusicKitInstance(await getMusicKit())
    } catch (err) {
      setAppleAuthError((err as Error).message)
    } finally {
      setAppleAuthorizing(false)
    }
  }

  // --- Room join (either platform) ---
  // For Spotify, wait until a device is picked too — otherwise playback has nothing to control.
  useEffect(() => {
    if (roomId || !pendingRoomFromUrl) return
    if (platform === 'spotify' && spotifyToken && deviceId) setRoomId(pendingRoomFromUrl)
    if (platform === 'apple' && musicKitInstance) setRoomId(pendingRoomFromUrl)
  }, [platform, spotifyToken, deviceId, musicKitInstance, roomId, pendingRoomFromUrl])

  const inviteHeading = pendingRoomFromUrl ? "You've been invited to a listening room" : 'Synced listening'

  if (!platform) {
    return (
      <section id="center">
        <h1>{inviteHeading}</h1>
        <p>Pick the platform you'll use to listen — your account, your playback.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button type="button" onClick={() => setPlatform('spotify')}>
            Continue with Spotify
          </button>
          <button type="button" onClick={() => setPlatform('apple')}>
            Continue with Apple Music
          </button>
        </div>
      </section>
    )
  }

  if (platform === 'spotify') {
    if (!spotifyToken) {
      return (
        <section id="center">
          <h1>{inviteHeading}</h1>
          {spotifyAuthError && <p style={{ color: 'tomato' }}>{spotifyAuthError}</p>}
          <button type="button" onClick={() => void redirectToAuthorize(pendingRoomFromUrl ?? undefined)}>
            {pendingRoomFromUrl ? 'Log in with Spotify to join' : 'Log in with Spotify'}
          </button>
        </section>
      )
    }

    if (!roomId) {
      return (
        <section id="center">
          <h1>Pick a playback device</h1>
          {spotifyAuthError && <p style={{ color: 'tomato' }}>{spotifyAuthError}</p>}
          <button type="button" onClick={() => void refreshDevices()}>
            Refresh devices
          </button>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">— select device —</option>
            {webPlaybackDeviceId && !devices.some((d) => d.id === webPlaybackDeviceId) && (
              <option value={webPlaybackDeviceId}>This browser tab</option>
            )}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id === webPlaybackDeviceId ? 'This browser tab' : `${d.name} (${d.type})`}
                {d.is_active ? ' — active' : ''}
              </option>
            ))}
          </select>
          {devices.length === 0 && !webPlaybackDeviceId && !spotifyAuthError && (
            <p style={{ opacity: 0.7 }}>
              No devices found — open Spotify on a phone/desktop app first, then click "Refresh devices".
            </p>
          )}
          {webPlaybackError && (
            <p style={{ opacity: 0.7 }}>
              In-browser playback unavailable ({webPlaybackError}) — pick an external device above instead.
            </p>
          )}
          <RoomChooser setRoomId={setRoomId} joinCode={joinCode} setJoinCode={setJoinCode} disabled={!deviceId} />
        </section>
      )
    }

    return <RoomView roomId={roomId} adapter={spotifyAdapter} />
  }

  // platform === 'apple'
  if (!musicKitInstance) {
    return (
      <section id="center">
        <h1>{inviteHeading}</h1>
        {appleAuthError && <p style={{ color: 'tomato' }}>{appleAuthError}</p>}
        <button type="button" onClick={() => void handleAppleLogin()} disabled={appleAuthorizing}>
          {appleAuthorizing ? 'Opening Apple Music sign-in…' : 'Log in with Apple Music'}
        </button>
      </section>
    )
  }

  if (!roomId) {
    return (
      <section id="center">
        <h1>Synced listening</h1>
        <RoomChooser setRoomId={setRoomId} joinCode={joinCode} setJoinCode={setJoinCode} />
      </section>
    )
  }

  return <RoomView roomId={roomId} adapter={appleAdapter!} />
}

export default App
