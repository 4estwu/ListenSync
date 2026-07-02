const CODE_VERIFIER_KEY = 'spotify_code_verifier'

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomVerifier(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values, (v) => chars[v % chars.length]).join('')
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomVerifier(64)
  const challenge = base64UrlEncode(await sha256(verifier))
  return { verifier, challenge }
}

export function storeCodeVerifier(verifier: string): void {
  sessionStorage.setItem(CODE_VERIFIER_KEY, verifier)
}

export function consumeCodeVerifier(): string | null {
  const verifier = sessionStorage.getItem(CODE_VERIFIER_KEY)
  sessionStorage.removeItem(CODE_VERIFIER_KEY)
  return verifier
}
