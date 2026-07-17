import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { PlatformPickerScreen } from '../screens/PlatformPickerScreen'
import { ConnectScreen } from '../screens/ConnectScreen'
import { RoomChooserScreen } from '../screens/RoomChooserScreen'
import { RoomViewScreen } from '../screens/RoomViewScreen'
import { AppleMusicScreen } from '../screens/AppleMusicScreen'

// Mirrors apps/web/src/App.tsx's flow (platform choice -> login/device setup
// -> room chooser -> room view), as real navigation stack screens instead of
// the web app's conditional-render-in-one-component approach — more
// idiomatic for React Navigation, functionally the same flow.
//
// Apple Music is the one branch that doesn't follow this stack: choosing it
// on PlatformPicker jumps to AppleMusic, which launches the deployed web
// app in a Chrome Custom Tab (via expo-web-browser) rather than using
// Connect/RoomChooser/Room natively — see AppleMusicScreen.tsx for why (not
// an embedded WebView; MusicKit JS's popup-based auth needs a real browser
// window.opener relationship an embedded WebView can't provide).
export type RootStackParamList = {
  PlatformPicker: undefined
  Connect: undefined
  RoomChooser: undefined
  Room: undefined
  AppleMusic: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#16171d' }, headerTintColor: '#f3f4f6' }}>
        <Stack.Screen name="PlatformPicker" component={PlatformPickerScreen} options={{ title: 'Synced listening' }} />
        <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Log in' }} />
        <Stack.Screen name="RoomChooser" component={RoomChooserScreen} options={{ title: 'Start or join' }} />
        <Stack.Screen name="Room" component={RoomViewScreen} options={{ title: 'Room' }} />
        <Stack.Screen name="AppleMusic" component={AppleMusicScreen} options={{ title: 'Apple Music' }} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
