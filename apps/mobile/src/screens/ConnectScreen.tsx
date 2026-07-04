import { useState } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useSession } from '../context/SessionContext'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { styles } from './styles'

type Props = NativeStackScreenProps<RootStackParamList, 'Connect'>

/**
 * Spotify-only now — Apple Music is handled by AppleMusicWebViewScreen
 * instead, which never routes through here. The actual Spotify SDK call is
 * UNVERIFIED (see platform/spotifyAdapter.ts's doc comments). This screen's
 * job is just the flow shell: trigger auth, show a loading/error state, and
 * move on once the adapter reports success.
 */
export function ConnectScreen({ navigation }: Props) {
  const { setSpotifyAuthed } = useSession()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    try {
      // TODO(native): SpotifySdk.authenticate({ clientID, redirectURL, scopes }),
      // then setSpotifyAuthed(true) and navigation.navigate('RoomChooser').
      // Placeholder — this screen exists so the navigation flow and error
      // handling shell are in place before that call is wired up.
      throw new Error('Spotify auth not yet implemented — see ConnectScreen.tsx TODO(native)')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const label = 'Log in with Spotify'

  return (
    <View style={styles.centerScreen}>
      <Text style={styles.title}>Synced listening</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
      <TouchableOpacity style={styles.primaryButton} onPress={() => void handleConnect()} disabled={connecting}>
        {connecting ? <ActivityIndicator color="#16171d" /> : <Text style={styles.primaryButtonText}>{label}</Text>}
      </TouchableOpacity>
    </View>
  )
}
