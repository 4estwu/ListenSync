import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { styles } from './styles'

// Was an embedded react-native-webview <WebView>. Switched (2026-07-17) to
// Chrome Custom Tabs via expo-web-browser after a real, reproduced bug:
// MusicKit JS's authorize() opens a popup and completes ONLY via a genuine
// window.opener.postMessage() handshake (confirmed by reading MusicKit JS's
// actual source — no redirect/fallback path exists at all). An embedded
// WebView cannot preserve that relationship: react-native-webview's
// onOpenWindow (confirmed by reading its native Android/iOS source) only
// ever surfaces the popup's target URL as a string — the popup itself gets
// discarded, so postMessage back to the "opener" has nowhere to arrive,
// and the flow hangs forever right after the user taps Allow.
//
// Custom Tabs sidesteps this entirely by running the actual Chrome engine
// (not a stripped-down native WebView component) — window.open() popups
// opened from a page loaded in Custom Tabs get real window.opener support,
// the same as any normal browser tab, which is exactly why this already
// works for the deployed web app's regular mobile-browser users. Trade-off:
// this is a full-screen browser session now, not an embedded native screen
// — the whole login/room/sync/playback experience happens inside the tab,
// and closing it returns here.
const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'http://127.0.0.1:8888'

type Props = NativeStackScreenProps<RootStackParamList, 'AppleMusic'>

export function AppleMusicScreen({ navigation }: Props) {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    WebBrowser.openBrowserAsync(WEB_APP_URL)
      .then(() => {
        // Fires once the user closes the Custom Tab (back gesture, swipe
        // away, etc.) — return to the platform picker rather than leaving
        // this screen stranded with nothing to do.
        if (!cancelled) navigation.navigate('PlatformPicker')
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [navigation])

  return (
    <View style={styles.centerScreen}>
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <ActivityIndicator color="#c084fc" />
      )}
    </View>
  )
}
