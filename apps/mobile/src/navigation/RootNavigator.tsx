import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { PlatformPickerScreen } from '../screens/PlatformPickerScreen'
import { ConnectScreen } from '../screens/ConnectScreen'
import { RoomChooserScreen } from '../screens/RoomChooserScreen'
import { RoomViewScreen } from '../screens/RoomViewScreen'

// Mirrors apps/web/src/App.tsx's flow (platform choice -> login/device setup
// -> room chooser -> room view), as real navigation stack screens instead of
// the web app's conditional-render-in-one-component approach — more
// idiomatic for React Navigation, functionally the same flow.
export type RootStackParamList = {
  PlatformPicker: undefined
  Connect: undefined
  RoomChooser: undefined
  Room: undefined
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
      </Stack.Navigator>
    </NavigationContainer>
  )
}
