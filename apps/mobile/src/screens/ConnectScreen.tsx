import { useState } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import { AppRemote } from '@wwdrew/expo-spotify-sdk'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useSession } from '../context/SessionContext'
import { authenticate, isSpotifyAppAvailable } from '../spotify/auth'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { styles } from './styles'

type Props = NativeStackScreenProps<RootStackParamList, 'Connect'>

/**
 * Spotify-only now — Apple Music is handled by AppleMusicScreen instead,
 * which never routes through here.
 *
 * Rewritten 2026-07-20 for App Remote (@wwdrew/expo-spotify-sdk v1.0.0+ —
 * see spotify/auth.ts's comment): no more device-picker step. App Remote
 * connects directly to the Spotify app running on this same device over
 * IPC, so there's no external Connect device to list or wait for — this
 * was the actual point of bringing App Remote in (see
 * MOBILE_V2_PLAN.md), replacing the old "open Spotify elsewhere and press
 * play first" requirement with a straight login -> connect -> room flow.
 *
 * App Remote does require the Spotify app to be installed (not just any
 * external device, like the old REST path accepted) — isSpotifyAppAvailable()
 * gates the login button on that up front instead of failing later with a
 * confusing connect error.
 */
export function ConnectScreen({ navigation }: Props) {
  const { setSpotifyToken } = useSession()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spotifyInstalled = isSpotifyAppAvailable()

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const token = await authenticate()
      setSpotifyToken(token)
      // Android: the token here is accepted for API parity but the actual
      // App Remote handshake uses the session the Spotify app just cached
      // from authenticate() above (see appRemotePlayer.ts's top comment).
      await AppRemote.connect(token.accessToken)
      navigation.navigate('RoomChooser')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <View style={styles.centerScreen}>
      <Text style={styles.title}>Synced listening</Text>
      {!spotifyInstalled && (
        <Text style={styles.errorText}>Install the Spotify app to continue — App Remote controls it directly on this device.</Text>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}
      <TouchableOpacity
        style={[styles.primaryButton, !spotifyInstalled && styles.buttonDisabled]}
        onPress={() => void handleConnect()}
        disabled={connecting || !spotifyInstalled}
      >
        {connecting ? <ActivityIndicator color="#16171d" /> : <Text style={styles.primaryButtonText}>Log in with Spotify</Text>}
      </TouchableOpacity>
    </View>
  )
}
