import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket as ServerSideSocket } from 'ws'

// Real sockets against a real (throwaway) WS server, not mocks — this is
// specifically to verify the reconnect-with-backoff logic in client.ts with
// real timing and real disconnect events, which a mocked connection can't
// exercise. RELAY_URL in client.ts is read from import.meta.env once at
// module load, so it has to be stubbed before each dynamic import.
const TEST_PORT = 18765

describe('connectRoom', () => {
  let server: WebSocketServer

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_RELAY_URL', `ws://127.0.0.1:${TEST_PORT}`)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it(
    'reconnects after the server drops the connection, and status goes back to connected',
    async () => {
      server = new WebSocketServer({ port: TEST_PORT })
      const serverSideSockets: ServerSideSocket[] = []
      server.on('connection', (ws) => serverSideSockets.push(ws))

      const { connectRoom } = await import('./client')
      const statuses: string[] = []

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out waiting for reconnect')), 8000)
        const conn = connectRoom('TESTROOM')

        conn.onStatusChange((status) => {
          statuses.push(status)
          const connectedCount = statuses.filter((s) => s === 'connected').length

          if (connectedCount === 1) {
            // First connection is up — kill it server-side to force a reconnect.
            serverSideSockets[0]?.close()
          } else if (connectedCount === 2) {
            clearTimeout(timeout)
            conn.close()
            resolve()
          }
        })
      })

      expect(statuses).toEqual(['connected', 'reconnecting', 'connected'])
    },
    10_000,
  )

  it('does not attempt to reconnect after the caller explicitly closes it', async () => {
    server = new WebSocketServer({ port: TEST_PORT })

    const { connectRoom } = await import('./client')
    const statuses: string[] = []

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 2000) // give it time to (not) reconnect
      const conn = connectRoom('TESTROOM')
      conn.onStatusChange((status) => {
        statuses.push(status)
        if (status === 'connected') conn.close()
        if (status === 'reconnecting') {
          clearTimeout(timeout)
          reject(new Error('should not attempt to reconnect after an explicit close()'))
        }
      })
    })

    expect(statuses).toEqual(['connected'])
  }, 5000)
})
