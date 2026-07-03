import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SessionProvider } from './src/context/SessionContext'
import { RootNavigator } from './src/navigation/RootNavigator'

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  )
}
