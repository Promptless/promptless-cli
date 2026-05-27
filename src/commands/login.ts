import { spawn } from 'node:child_process'
import {
  constants as cryptoConstants,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
} from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createInterface } from 'node:readline'
import type { Interface as ReadlineInterface } from 'node:readline'

import { APP_BASE_URL, AuthError, whoami } from '../lib/api'
import { loadConfigFile, resolveConfigFilePath, saveConfigFile } from '../lib/config'

// Protocol version baked into the auth URL. The web app and backend must
// recognize this string and use the matching encryption scheme. v1 is:
//   - RSA-OAEP with SHA-256
//   - 2048-bit RSA modulus
//   - Public key on the wire: base64url(SPKI DER)
//   - Ciphertext on the wire: base64url(RSA-OAEP output)
const KEY_TYPE = 'v1' as const
const RSA_MODULUS_BITS = 2048

const CALLBACK_PATH = '/auth/callback'

const HELP = `promptless login — authenticate the CLI with Promptless

usage:
  promptless login [options]

options:
  --no-browser    Don't open a browser automatically; just print the URL
  -h, --help      Show this help

description:
  Generates a one-time RSA-OAEP keypair in memory, opens
  ${APP_BASE_URL}/cli/auth in your browser, and waits for the Promptless
  web app to deliver a newly created API key (encrypted with the public
  key) via a JSON POST to a temporary local HTTP server. The decrypted
  key is then saved to your config file.

  If the browser cannot reach the local HTTP server (e.g. you're SSH'd
  into a remote box and the browser is on your laptop), the auth page
  also displays the encrypted code as text — paste it into this
  terminal at the prompt and press Enter.

config file location (resolved in order):
  $PROMPTLESS_CLI_DEVELOPER_CONFIG_FILE  (if set)
  $XDG_CONFIG_HOME/promptless/env        (if XDG_CONFIG_HOME is set)
  ~/.config/promptless/env               (default)
`

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

// The origin of the configured app base URL (e.g. "https://app.gopromptless.ai").
// Only requests with this exact `Origin` header are accepted by the callback.
function expectedOrigin(): string {
  const u = new URL(APP_BASE_URL)
  return `${u.protocol}//${u.host}`
}

function openInBrowser(url: string): void {
  let cmd: string
  let args: string[]
  if (process.platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {
    // If the launcher isn't available we just leave the printed URL for the user.
  }
}

function applyCors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
}

async function readJsonBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += b.length
    if (total > maxBytes) throw new Error('request body exceeds 64 KiB')
    chunks.push(b)
  }
  if (chunks.length === 0) throw new Error('empty body')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

type CallbackResult = { ok: true; apiKey: string } | { ok: false; error: string }

interface WaitOptions {
  port: number
  expectedState: string
  privateKey: KeyObject
  timeoutMs: number
  server: ReturnType<typeof createServer>
}

async function waitForCallback(opts: WaitOptions): Promise<CallbackResult> {
  const { port, expectedState, privateKey, timeoutMs, server } = opts
  const origin = expectedOrigin()

  return new Promise<CallbackResult>((resolve) => {
    let settled = false
    let rl: ReadlineInterface | null = null
    let timer: ReturnType<typeof setTimeout>

    const finish = (result: CallbackResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rl?.close()
      resolve(result)
    }

    timer = setTimeout(() => {
      finish({
        ok: false,
        error: `timed out waiting for browser callback or pasted code (${timeoutMs}ms)`,
      })
    }, timeoutMs)

    if (process.stdin.isTTY) {
      rl = createInterface({ input: process.stdin })
      rl.on('line', (line) => {
        if (settled) return
        const trimmed = line.trim()
        if (!trimmed) return
        try {
          const apiKey = decryptApiKey(trimmed, privateKey)
          finish({ ok: true, apiKey })
        } catch {
          process.stderr.write(
            "promptless login: that code didn't decrypt — paste the full code, or wait for the browser callback.\n",
          )
        }
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

      let payload: Record<string, unknown>
      try {
        const raw = await readJsonBody(req)
        if (typeof raw !== 'object' || raw === null) throw new Error('body is not a JSON object')
        payload = raw as Record<string, unknown>
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        applyCors(res, origin)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_body', detail: msg }))
        finish({ ok: false, error: `bad callback body: ${msg}` })
        return
      }

      const encryptedKey = payload.encrypted_key
      const receivedState = payload.state
      const receivedKeyType = payload.key_type

      if (receivedKeyType !== KEY_TYPE) {
        applyCors(res, origin)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'unsupported_key_type', expected: KEY_TYPE }))
        finish({
          ok: false,
          error: `web app returned key_type='${String(receivedKeyType)}' but CLI expected '${KEY_TYPE}'`,
        })
        return
      }

      if (typeof receivedState !== 'string' || receivedState !== expectedState) {
        applyCors(res, origin)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'state_mismatch' }))
        finish({ ok: false, error: 'state parameter mismatch — possible CSRF or stale callback' })
        return
      }

      if (typeof encryptedKey !== 'string' || encryptedKey.length === 0) {
        applyCors(res, origin)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'missing_encrypted_key' }))
        finish({ ok: false, error: 'callback body missing encrypted_key' })
        return
      }

      let apiKey: string
      try {
        apiKey = decryptApiKey(encryptedKey, privateKey)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        applyCors(res, origin)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'decrypt_failed', detail: msg }))
        finish({ ok: false, error: `failed to decrypt API key: ${msg}` })
        return
      }

      applyCors(res, origin)
      res.writeHead(204)
      res.end()
      finish({ ok: true, apiKey })
    })
  })
}

async function _run(argv: string[]): Promise<void> {
  let shouldOpenBrowser = true
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP)
      process.exit(0)
    } else if (arg === '--no-browser') {
      shouldOpenBrowser = false
    } else {
      process.stderr.write(`promptless login: unknown option ${arg}\n`)
      process.exit(2)
    }
  }

  const { publicKeyB64u, privateKey } = generateKeypair()
  const state = base64UrlEncode(randomBytes(16))

  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    process.stderr.write('promptless login: failed to bind local HTTP server\n')
    process.exit(1)
  }
  const port = address.port
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`

  const authUrl = new URL(`${APP_BASE_URL}/cli/auth`)
  authUrl.searchParams.set('public_key', publicKeyB64u)
  authUrl.searchParams.set('key_type', KEY_TYPE)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)

  if (shouldOpenBrowser) {
    process.stderr.write(
      `Attempting to open your default browser.\nIf the browser does not open, open the following URL:\n\n${authUrl.toString()}\n\n`,
    )
    openInBrowser(authUrl.toString())
  } else {
    process.stderr.write(`Open the following URL:\n\n${authUrl.toString()}\n\n`)
  }

  process.stderr.write(
    `Waiting for the browser to deliver your API key...\n\nIf the browser can't reach this terminal (e.g. SSH or remote shell), the auth\npage will show a verification code — paste it here and press Enter:\n\n`,
  )

  const result = await waitForCallback({
    port,
    expectedState: state,
    privateKey,
    timeoutMs: 5 * 60 * 1000,
    server,
  })

  server.close()

  if (!result.ok) {
    process.stderr.write(`promptless login: ${result.error}\n`)
    process.exit(1)
  }

  const existing = loadConfigFile()
  existing.PROMPTLESS_CLI_API_SECRET = result.apiKey
  saveConfigFile(existing)
  process.stderr.write(`\nSaved API key to ${resolveConfigFilePath()}\n`)

  try {
    const me = await whoami(result.apiKey)
    process.stderr.write(`Logged in as ${me.email}${me.name ? ` (${me.name})` : ''}\n`)
  } catch (err) {
    const msg = err instanceof AuthError || err instanceof Error ? err.message : String(err)
    process.stderr.write(`Saved key, but verification call failed: ${msg}\n`)
  }

  process.exit(0)
}

export function runLogin(argv: string[]): never {
  void _run(argv).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`promptless login: ${msg}\n`)
    process.exit(1)
  })
  return undefined as never
}
