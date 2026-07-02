import type { RelayEvent } from '@spotifyapple/shared'

const RELAY_URL = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? 'ws://127.0.0.1:8787'

export interface RelayConnection {
  send(event: RelayEvent): void
  onMessage(cb: (event: RelayEvent) => void): void
  close(): void
}

export function connectRoom(roomId: string): RelayConnection {
  // TODO: reconnect with backoff — a dropped WS connection currently just goes
  // silent, the client won't notice or recover.
  const socket = new WebSocket(`${RELAY_URL}?room=${encodeURIComponent(roomId)}`)

  return {
    send(event) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
    },
    onMessage(cb) {
      socket.addEventListener('message', (e) => cb(JSON.parse(e.data as string) as RelayEvent))
    },
    close() {
      socket.close()
    },
  }
}
