import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useSession } from '../context/SessionContext'
import { authenticate } from '../spotify/auth'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { styles } from './styles'

type Props = NativeStackScreenProps<RootStackParamList, 'Connect'>

/**
 * Spotify-only now — Apple Music is handled by AppleMusicWebViewScreen
 * instead, which never routes through here.
 *
 * UNVERIFIED: authenticate()'s native SSO handshake (spotify/auth.ts) has not
 * been exercised on a device. Everything else here — device listing/
 * selection — is a straight port of apps/web's already-tested logic
 * (App.tsx's refreshDevices), just without an in-tab Web Playback SDK device
 * to prefer (this app has no equivalent — see spotify/player.ts), so an
 * external Spotify Connect device (e.g. the phone's own separately-installed
 * Spotify app, already playing something) is required before continuing.
 */
export function ConnectScreen({ navigation }: Props) {
  const { setSpotifyToken, spotifyToken, spotifyDevices, spotifyDeviceId, setSpotifyDeviceId, refreshSpotifyDevices } = useSession()
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const token = await authenticate()
      setSpotifyToken(token)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const handleRefreshDevices = async () => {
    setRefreshing(true)
    setError(null)
    try {
      await refreshSpotifyDevices()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  // Auto-refresh once right after login, and again on a slow poll while
  // waiting — matches apps/web's App.tsx (a device becoming active, e.g. the
  // user opening Spotify on their phone per the prompt below, should show up
  // without a manual tap).
  useEffect(() => {
    if (!spotifyToken) return
    void refreshSpotifyDevices()
    const handle = setInterval(() => void refreshSpotifyDevices(), 4000)
    return () => clearInterval(handle)
  }, [spotifyToken, refreshSpotifyDevices])

  if (!spotifyToken) {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.title}>Synced listening</Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <TouchableOpacity style={styles.primaryButton} onPress={() => void handleConnect()} disabled={connecting}>
          {connecting ? <ActivityIndicator color="#16171d" /> : <Text style={styles.primaryButtonText}>Log in with Spotify</Text>}
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={[styles.centerScreen, { alignItems: 'stretch' }]}>
      <Text style={styles.title}>Choose a device</Text>
      <Text style={styles.subtitle}>
        Open Spotify on the device you want to play from (a phone, speaker, or desktop) and start playing something once — Spotify
        Connect only surfaces devices that have already checked in.
      </Text>
      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.card}>
        {spotifyDevices.length === 0 && <Text style={styles.subtitle}>No devices found yet.</Text>}
        {spotifyDevices.map((d) => (
          <TouchableOpacity key={d.id} style={styles.queueRow} onPress={() => setSpotifyDeviceId(d.id)}>
            <Text style={[styles.queueRowText, d.id === spotifyDeviceId && styles.queueRowTextCurrent]}>
              {d.name} {d.is_active ? '(active)' : ''}
            </Text>
            {d.id === spotifyDeviceId && <Text style={styles.queueRowTextCurrent}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => void handleRefreshDevices()} disabled={refreshing}>
          {refreshing ? <ActivityIndicator color="#f3f4f6" /> : <Text style={styles.secondaryButtonText}>Refresh devices</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, !spotifyDeviceId && styles.buttonDisabled]}
          disabled={!spotifyDeviceId}
          onPress={() => navigation.navigate('RoomChooser')}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
