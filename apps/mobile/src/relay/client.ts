import type { RelayEvent } from '@spotifyapple/shared'

// React Native ships a global WebSocket implementation with the same API as
// the browser's — this file is a near-verbatim port of
// apps/web/src/relay/client.ts, only the env var access differs (Expo's
// EXPO_PUBLIC_ prefix instead of Vite's VITE_). No native module needed here,
// unlike the platform adapters — this is real, working code, not a stub.
const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL ?? 'ws://127.0.0.1:8787'
const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 15_000

export type ConnectionStatus = 'connected' | 'reconnecting'

export interface RelayConnection {
  send(event: RelayEvent): void
  onMessage(cb: (event: RelayEvent) => void): void
  /**
   * Fires when the underlying socket drops (fires 'reconnecting', a retry is
   * already scheduled) and when it comes back ('connected'). A reconnect gets
   * a brand-new clientId from the relay — if this client was the room's
   * position-reporter, the relay promotes another connected client
   * immediately (or this one again, next time it reconnects, if the room was
   * otherwise empty) — see apps/relay/src/index.ts's close handler.
   */
  onStatusChange(cb: (status: ConnectionStatus) => void): void
  close(): void
}

export function connectRoom(roomId: string): RelayConnection {
  let socket: WebSocket | null = null
  let messageHandler: ((event: RelayEvent) => void) | null = null
  let statusHandler: ((status: ConnectionStatus) => void) | null = null
  let closedByCaller = false
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const open = () => {
    socket = new WebSocket(`${RELAY_URL}?room=${encodeURIComponent(roomId)}`)

    socket.addEventListener('open', () => {
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS
      statusHandler?.('connected')
    })
    socket.addEventListener('message', (e) => {
      messageHandler?.(JSON.parse(e.data as string) as RelayEvent)
    })
    socket.addEventListener('close', () => {
      if (closedByCaller) return
      statusHandler?.('reconnecting')
      reconnectTimer = setTimeout(open, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
    })
  }
  open()

  return {
    send(event) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
    },
    onMessage(cb) {
      messageHandler = cb
    },
    onStatusChange(cb) {
      statusHandler = cb
    },
    close() {
      closedByCaller = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    },
  }
}
