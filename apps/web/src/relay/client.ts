import type { RelayEvent } from '@spotifyapple/shared'

const RELAY_URL = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? 'ws://127.0.0.1:8787'
const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 15_000

export type ConnectionStatus = 'connected' | 'reconnecting'

export interface RelayConnection {
  /** Returns false without throwing if the socket isn't open right now (e.g. mid-reconnect) — the event is simply not sent, not queued. */
  send(event: RelayEvent): boolean
  onMessage(cb: (event: RelayEvent) => void): void
  /**
   * Fires when the underlying socket drops (fires 'reconnecting', a retry is
   * already scheduled) and when it comes back ('connected'). Note that a
   * reconnect gets a brand-new clientId from the relay — if this client was
   * the room's position-reporter, it won't be after reconnecting (relay-side
   * reporter failover isn't implemented yet; see the TODO in apps/relay).
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
      if (socket?.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(event))
      return true
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
