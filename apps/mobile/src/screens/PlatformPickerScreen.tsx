import { Text, TouchableOpacity, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useSession } from '../context/SessionContext'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { styles } from './styles'

type Props = NativeStackScreenProps<RootStackParamList, 'PlatformPicker'>

export function PlatformPickerScreen({ navigation }: Props) {
  const { setPlatform } = useSession()

  const choose = (platform: 'spotify' | 'apple') => {
    setPlatform(platform)
    // Apple Music skips the native Connect/RoomChooser/Room stack entirely —
    // it's handled inside a WebView embedding the deployed web app instead
    // (see AppleMusicWebViewScreen.tsx for why).
    navigation.navigate(platform === 'apple' ? 'AppleWebView' : 'Connect')
  }

  return (
    <View style={styles.centerScreen}>
      <Text style={styles.title}>Synced listening</Text>
      <Text style={styles.subtitle}>Pick the platform you'll use to listen — your account, your playback.</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.primaryButton} onPress={() => choose('spotify')}>
          <Text style={styles.primaryButtonText}>Continue with Spotify</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={() => choose('apple')}>
          <Text style={styles.primaryButtonText}>Continue with Apple Music</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
