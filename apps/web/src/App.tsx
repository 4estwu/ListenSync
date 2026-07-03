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

// Resuming exactly where you left off — same platform, same room — on a
// fresh app open (not just a same-tab reload) is the point of these: a phone
// browser tab getting killed in the background and reopened later should
// feel like unlocking a native app, not starting over from the platform
// picker every time.
const LAST_PLATFORM_KEY = 'listensync_last_platform'
const LAST_ROOM_KEY = 'listensync_last_room'

function isPlatform(value: string | null): value is Platform {
  return value === 'spotify' || value === 'apple'
}

function App() {
  const [platform, setPlatformState] = useState<Platform | null>(() => {
    const stored = localStorage.getItem(LAST_PLATFORM_KEY)
    return isPlatform(stored) ? stored : null
  })
  const setPlatform = useCallback((next: Platform) => {
    localStorage.setItem(LAST_PLATFORM_KEY, next)
    setPlatformState(next)
  }, [])
  const [roomId, setRoomId] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [pendingRoomFromUrl] = useState(() => new URLSearchParams(window.location.search).get('room'))
  // Fallback rejoin target when there's no share-link room in the URL — the
  // room this same browser last had open.
  const [pendingRoomFromStorage] = useState(() => (pendingRoomFromUrl ? null : localStorage.getItem(LAST_ROOM_KEY)))
  const rejoinTarget = pendingRoomFromUrl ?? pendingRoomFromStorage

  useEffect(() => {
    if (roomId) localStorage.setItem(LAST_ROOM_KEY, roomId)
  }, [roomId])

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

  // Set only by the device <select>'s onChange (an explicit user action) —
  // once true, auto-selection logic below backs off entirely rather than
  // overriding a choice the user actually made.
  const userPickedDeviceRef = useRef(false)

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
      if (userPickedDeviceRef.current) return
      // Prefer this tab's own Web Playback SDK device over any external one:
      // it needs no pre-existing Spotify session anywhere else, which is the
      // whole point — someone should be able to open this page, log in, and
      // just start playing, the same as Apple Music already does in-tab.
      // Falls back to an external device only when the SDK device isn't
      // known yet (still loading, or unavailable — see the effect below).
      if (webPlaybackDeviceIdRef.current) {
        setDeviceId(webPlaybackDeviceIdRef.current)
        return
      }
      const active = list.find((d) => d.is_active)
      if (active) setDeviceId(active.id)
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
  // in-browser playback — this is what lets someone join with nothing but a
  // browser tab, no separate Spotify app/session required. Claims the
  // default outright once ready (upgrading over whatever refreshDevices
  // auto-selected first, since SDK script loading is slower than the
  // devices API call), unless the user already explicitly picked something
  // via the dropdown. (Earlier this deliberately deferred to any external
  // device instead, based on a since-corrected diagnosis that blamed the SDK
  // itself for what was actually a missing OAuth scope — the SDK is reliable
  // now that that's fixed.) Soft-fails otherwise: if it doesn't work (e.g.
  // non-Premium account, or any mobile browser — Spotify restricts the SDK
  // to desktop), external-device selection still works exactly as before.
  useEffect(() => {
    if (platform !== 'spotify' || !spotifyToken) return
    connectWebPlaybackDevice(getSpotifyAccessToken)
      .then((id) => {
        setWebPlaybackDeviceId(id)
        if (!userPickedDeviceRef.current) setDeviceId(id)
      })
      .catch((err: Error) => setWebPlaybackError(err.message))
  }, [platform, spotifyToken, getSpotifyAccessToken])

  // Auto-refresh the device list while on the picker screen so a device that
  // becomes active (e.g. this tab's own SDK device finishing setup, or the
  // user opening Spotify on their phone per the prompt below) shows up
  // without a manual click.
  useEffect(() => {
    if (platform !== 'spotify' || !spotifyToken || roomId) return
    const handle = setInterval(() => void refreshDevices(), 4000)
    return () => clearInterval(handle)
  }, [platform, spotifyToken, roomId, refreshDevices])

  // --- Apple Music ---
  const [musicKitInstance, setMusicKitInstance] = useState<MusicKit.MusicKitInstance | null>(null)
  const [appleAuthorizing, setAppleAuthorizing] = useState(false)
  const [appleAuthError, setAppleAuthError] = useState<string | null>(null)

  const appleAdapter = useMemo(() => (musicKitInstance ? createAppleAdapter(musicKitInstance) : null), [musicKitInstance])

  // MusicKit JS persists its own music-user-token across page loads (its own
  // localStorage, not something this app manages) — so reopening the app
  // with platform already set to 'apple' can skip straight past the login
  // screen if that token's still valid, instead of requiring authorize()
  // (a user-facing sign-in prompt) again every time.
  useEffect(() => {
    if (platform !== 'apple' || musicKitInstance) return
    getMusicKit()
      .then((music) => {
        if (music.isAuthorized) setMusicKitInstance(music)
      })
      .catch((err: Error) => setAppleAuthError(err.message))
  }, [platform, musicKitInstance])

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
    if (roomId || !rejoinTarget) return
    if (platform === 'spotify' && spotifyToken && deviceId) setRoomId(rejoinTarget)
    if (platform === 'apple' && musicKitInstance) setRoomId(rejoinTarget)
  }, [platform, spotifyToken, deviceId, musicKitInstance, roomId, rejoinTarget])

  const inviteHeading = pendingRoomFromUrl ? "You've been invited to a listening room" : 'Synced listening'

  if (!platform) {
    return (
      <section id="center">
        <h1>{inviteHeading}</h1>
        <p>Pick the platform you'll use to listen — your account, your playback.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button type="button" className="primary" onClick={() => setPlatform('spotify')}>
            Continue with Spotify
          </button>
          <button type="button" className="primary" onClick={() => setPlatform('apple')}>
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
          <button type="button" className="primary" onClick={() => void redirectToAuthorize(pendingRoomFromUrl ?? undefined)}>
            {pendingRoomFromUrl ? 'Log in with Spotify to join' : 'Log in with Spotify'}
          </button>
        </section>
      )
    }

    if (!roomId) {
      return (
        <section id="center">
          <h1>Pick a playback device</h1>
          <p style={{ opacity: 0.75, maxWidth: 420, textAlign: 'center' }}>
            This browser tab will be used automatically once it's ready — no separate Spotify session needed.
            On mobile, Spotify doesn't allow that, so pick a device below instead: open Spotify there and
            start playing anything (even paused) so it shows up here.
          </p>
          <a className="button-link" href="spotify:" target="_blank" rel="noreferrer">
            Open Spotify app
          </a>
          {spotifyAuthError && <p style={{ color: 'tomato' }}>{spotifyAuthError}</p>}
          <button type="button" onClick={() => void refreshDevices()}>
            Refresh devices
          </button>
          <select
            value={deviceId}
            onChange={(e) => {
              userPickedDeviceRef.current = true
              setDeviceId(e.target.value)
            }}
          >
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
              Setting up this tab as a device… if that fails (e.g. no Premium), open Spotify elsewhere — it'll
              show up here automatically.
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
        <button type="button" className="primary" onClick={() => void handleAppleLogin()} disabled={appleAuthorizing}>
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
