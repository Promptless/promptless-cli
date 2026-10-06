import {
  constants as cryptoConstants,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
} from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createInterface } from 'node:readline'
import type { Interface as ReadlineInterface } from 'node:readline'

import { APP_BASE_URL } from '../api'

// Loopback login: the CLI generates a one-time keypair, opens
// `${APP_BASE_URL}/cli/auth`, and receives a new API key encrypted to the
// public key, either as a JSON POST to a 127.0.0.1 server or as a code the
// user pastes into the terminal.

// Protocol version baked into the auth URL. The web app and backend must
// recognize this string and use the matching encryption scheme. v1 is:
//   - RSA-OAEP with SHA-256
//   - 2048-bit RSA modulus
//   - Public key on the wire: base64url(SPKI DER)
//   - Ciphertext on the wire: base64url(RSA-OAEP output)
export const KEY_TYPE = 'v1' as const
const RSA_MODULUS_BITS = 2048

export const CALLBACK_PATH = '/auth/callback'

const MAX_BODY_BYTES = 64 * 1024

export type CallbackResult = { ok: true; apiKey: string } | { ok: false; error: string }

export interface LoopbackLoginOptions {
  /** Milliseconds to wait for a callback or pasted code before failing. */
  timeoutMs: number
  /** Read pasted codes from stdin, one per line. Only meaningful when stdin is a TTY. */
  readPastedCode: boolean
  /** Called when a pasted line does not decrypt; the login keeps waiting. */
  onInvalidPaste?: () => void
  /** Tells the auth page which flow started the login (for example `setup`). */
  intent?: string
  /** Defaults to `APP_BASE_URL`. The callback accepts only this origin. */
  appBaseUrl?: string
}

export interface LoopbackLogin {
  /** The `/cli/auth` URL to open in the browser. */
  authUrl: string
  /**
   * Settles once, with the first callback, valid pasted code, failure, or
   * timeout. The local server and the stdin reader are closed before it
   * settles, so a prompt can take stdin afterwards.
   */
  result: Promise<CallbackResult>
  /** Try a code the user pasted. Returns true when it decrypted and settled the login. */
  submitCode: (code: string) => boolean
}

function base64UrlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64UrlDecode(input: string): Buffer {
  let s = input.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4 !== 0) s += '='
  return Buffer.from(s, 'base64')
}

interface KeyMaterial {
  publicKeyB64u: string
  privateKey: KeyObject
}

function generateKeypair(): KeyMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: RSA_MODULUS_BITS,
  })
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
  return { publicKeyB64u: base64UrlEncode(publicKeyDer), privateKey }
}

function decryptApiKey(ciphertextB64u: string, privateKey: KeyObject): string {
  const ciphertext = base64UrlDecode(ciphertextB64u)
  const plaintext = privateDecrypt(
    {
      key: privateKey,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    ciphertext,
  )
  return plaintext.toString('utf8')
}

interface AuthUrlParams {
  appBaseUrl: string
  publicKeyB64u: string
  redirectUri: string
  state: string
  intent?: string
}

export function buildAuthUrl(params: AuthUrlParams): string {
  const authUrl = new URL(`${params.appBaseUrl}/cli/auth`)
  authUrl.searchParams.set('public_key', params.publicKeyB64u)
  authUrl.searchParams.set('key_type', KEY_TYPE)
  authUrl.searchParams.set('redirect_uri', params.redirectUri)
  authUrl.searchParams.set('state', params.state)
  if (params.intent) authUrl.searchParams.set('intent', params.intent)
  return authUrl.toString()
}

// The origin of the app base URL (e.g. "https://app.gopromptless.ai").
// Only requests with this exact `Origin` header are accepted by the callback.
function originOf(appBaseUrl: string): string {
  const u = new URL(appBaseUrl)
  return `${u.protocol}//${u.host}`
}

function applyCors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += b.length
    if (total > MAX_BODY_BYTES) throw new Error('request body exceeds 64 KiB')
    chunks.push(b)
  }
  if (chunks.length === 0) throw new Error('empty body')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('failed to bind local HTTP server')
  }
  return address.port
}

/**
 * Start a loopback login: bind the callback server on a free 127.0.0.1 port,
 * build the auth URL, and begin waiting for the encrypted key.
 *
 * @throws Error when the local server cannot bind.
 */
export async function startLoopbackLogin(opts: LoopbackLoginOptions): Promise<LoopbackLogin> {
  const appBaseUrl = opts.appBaseUrl ?? APP_BASE_URL
  const origin = originOf(appBaseUrl)
  const { publicKeyB64u, privateKey } = generateKeypair()
  const expectedState = base64UrlEncode(randomBytes(16))

  const server = createServer()
  const port = await listenOnLoopback(server)
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`
  const authUrl = buildAuthUrl({
    appBaseUrl,
    publicKeyB64u,
    redirectUri,
    state: expectedState,
    intent: opts.intent,
  })

  let settled = false
  let rl: ReadlineInterface | null = null
  let resolveResult: (result: CallbackResult) => void = () => {}
  const result = new Promise<CallbackResult>((resolve) => {
    resolveResult = resolve
  })

  const finish = (outcome: CallbackResult): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    rl?.close()
    server.close()
    resolveResult(outcome)
  }

  const timer = setTimeout(() => {
    finish({
      ok: false,
      error: `timed out waiting for browser callback or pasted code (${opts.timeoutMs}ms)`,
    })
  }, opts.timeoutMs)

  const submitCode = (code: string): boolean => {
    if (settled) return false
    try {
      finish({ ok: true, apiKey: decryptApiKey(code.trim(), privateKey) })
      return true
    } catch {
      return false
    }
  }

  if (opts.readPastedCode) {
    rl = createInterface({ input: process.stdin })
    rl.on('line', (line) => {
      if (settled || !line.trim()) return
      if (!submitCode(line)) opts.onInvalidPaste?.()
    })
  }

  server.on('request', async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const requestOrigin = req.headers.origin

    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }

    // Strict CORS: only the configured app origin is allowed.
    if (!requestOrigin || requestOrigin !== origin) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'forbidden_origin', expected: origin }))
      return
    }

    if (req.method === 'OPTIONS') {
      applyCors(res, origin)
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Max-Age', '60')
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method !== 'POST') {
      applyCors(res, origin)
      res.writeHead(405, { Allow: 'POST, OPTIONS' })
      res.end()
      return
    }

    const reject = (body: Record<string, string>, error: string): void => {
      applyCors(res, origin)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
      finish({ ok: false, error })
    }

    let payload: Record<string, unknown>
    try {
      const raw = await readJsonBody(req)
      if (typeof raw !== 'object' || raw === null) throw new Error('body is not a JSON object')
      payload = raw as Record<string, unknown>
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      reject({ error: 'invalid_body', detail: msg }, `bad callback body: ${msg}`)
      return
    }

    const encryptedKey = payload.encrypted_key
    const receivedState = payload.state
    const receivedKeyType = payload.key_type

    if (receivedKeyType !== KEY_TYPE) {
      reject(
        { error: 'unsupported_key_type', expected: KEY_TYPE },
        `web app returned key_type='${String(receivedKeyType)}' but CLI expected '${KEY_TYPE}'`,
      )
      return
    }

    if (typeof receivedState !== 'string' || receivedState !== expectedState) {
      reject({ error: 'state_mismatch' }, 'state parameter mismatch — possible CSRF or stale callback')
      return
    }

    if (typeof encryptedKey !== 'string' || encryptedKey.length === 0) {
      reject({ error: 'missing_encrypted_key' }, 'callback body missing encrypted_key')
      return
    }

    let apiKey: string
    try {
      apiKey = decryptApiKey(encryptedKey, privateKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      reject({ error: 'decrypt_failed', detail: msg }, `failed to decrypt API key: ${msg}`)
      return
    }

    applyCors(res, origin)
    res.writeHead(204)
    res.end()
    finish({ ok: true, apiKey })
  })

  return { authUrl, result, submitCode }
}
