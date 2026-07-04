import { WebView } from 'react-native-webview'
import { View } from 'react-native'
import { styles } from './styles'

// Apple Music's native MusicKit framework needs the "App Services"-tier
// `com.apple.developer.musickit` entitlement, and EAS Build's (and even
// plain Xcode's) automatic provisioning profile generation has a confirmed,
// unresolved gap in supporting it — see MOBILE_V2_PLAN.md. Rather than fight
// that, this screen just embeds the already-working, already-deployed web
// app's MusicKit JS flow in a WebView: same login, same room chooser, same
// room view, same sync engine, all running exactly as it does in a mobile
// browser today — no native module, no entitlement, works identically on
// iOS and Android.
const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'http://127.0.0.1:8888'

export function AppleMusicWebViewScreen() {
  return (
    <View style={styles.screen}>
      <WebView source={{ uri: WEB_APP_URL }} style={styles.screen} />
    </View>
  )
}
