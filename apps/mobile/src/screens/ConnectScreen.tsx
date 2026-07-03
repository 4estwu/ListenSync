import { useState } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useSession } from '../context/SessionContext'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { styles } from './styles'

type Props = NativeStackScreenProps<RootStackParamList, 'Connect'>

/**
 * Handles both platforms' auth — the actual SDK calls are UNVERIFIED (see
 * platform/spotifyAdapter.ts and platform/appleMusicAdapter.ts's doc
 * comments). This screen's job is just the flow shell: trigger auth, show a
 * loading/error state, and move on once the adapter reports success.
 */
export function ConnectScreen({ navigation }: Props) {
  const { platform, setSpotifyAuthed, setAppleAuthed } = useSession()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    try {
      if (platform === 'spotify') {
        // TODO(native): SpotifySdk.authenticate({ clientID, redirectURL, scopes }).
        // Placeholder — this screen exists so the navigation flow and error
        // handling shell are in place before that call is wired up.
        throw new Error('Spotify auth not yet implemented — see ConnectScreen.tsx TODO(native)')
      } else if (platform === 'apple') {
        // TODO(native): AppleMusic.authorize() or equivalent.
        throw new Error('Apple Music auth not yet implemented — see ConnectScreen.tsx TODO(native)')
      }
      if (platform === 'spotify') setSpotifyAuthed(true)
      if (platform === 'apple') setAppleAuthed(true)
      navigation.navigate('RoomChooser')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const label = platform === 'spotify' ? 'Log in with Spotify' : 'Log in with Apple Music'

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
