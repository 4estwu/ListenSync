import { useState } from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useSession } from '../context/SessionContext'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { styles } from './styles'

// Port of apps/web/src/RoomChooser.tsx's code generator — same alphabet
// (no ambiguous 0/O/1/I), swapped crypto.getRandomValues() for expo-crypto's
// getRandomBytes() (same reasoning as useRoomSync's randomUUID swap).
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const values = Crypto.getRandomBytes(6)
  return Array.from(values, (v) => chars[v % chars.length]).join('')
}

type Props = NativeStackScreenProps<RootStackParamList, 'RoomChooser'>

export function RoomChooserScreen({ navigation }: Props) {
  const { setRoomId } = useSession()
  const [joinCode, setJoinCode] = useState('')

  const enterRoom = (id: string) => {
    setRoomId(id)
    navigation.navigate('Room')
  }

  return (
    <View style={styles.centerScreen}>
      <Text style={styles.title}>Start or join a room</Text>
      <TouchableOpacity style={styles.primaryButton} onPress={() => enterRoom(generateRoomCode())}>
        <Text style={styles.primaryButtonText}>Create a room</Text>
      </TouchableOpacity>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={joinCode}
          onChangeText={(text) => setJoinCode(text.toUpperCase())}
          placeholder="room code"
          placeholderTextColor="#6b6375"
          autoCapitalize="characters"
        />
        <TouchableOpacity
          style={[styles.secondaryButton, !joinCode.trim() && styles.buttonDisabled]}
          onPress={() => enterRoom(joinCode.trim())}
          disabled={!joinCode.trim()}
        >
          <Text style={styles.secondaryButtonText}>Join</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
