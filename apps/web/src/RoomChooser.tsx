function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I, easier to read aloud
  const values = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(values, (v) => chars[v % chars.length]).join('')
}

interface RoomChooserProps {
  setRoomId: (id: string) => void
  joinCode: string
  setJoinCode: (code: string) => void
  disabled?: boolean
}

function RoomChooser({ setRoomId, joinCode, setJoinCode, disabled }: RoomChooserProps) {
  return (
    <section style={{ marginTop: 16 }}>
      <h2>Start or join a room</h2>
      <div>
        <button type="button" disabled={disabled} onClick={() => setRoomId(generateRoomCode())}>
          Create a room
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="room code" />
        <button type="button" disabled={disabled || !joinCode.trim()} onClick={() => setRoomId(joinCode.trim())}>
          Join
        </button>
      </div>
    </section>
  )
}

export default RoomChooser
