import assert from 'node:assert/strict'
import { constants as cryptoConstants, createPublicKey, publicEncrypt } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { describe, it } from 'node:test'

import { CALLBACK_PATH, KEY_TYPE, buildAuthUrl, buildSignUpUrl, startLoopbackLogin } from './loopback'
import type { LoopbackLogin } from './loopback'

const APP = 'https://app.example.test'

interface PostResult {
  status: number
  body: string
}

function post(url: string, body: string, origin: string | null, method = 'POST'): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (origin !== null) headers.Origin = origin
    const req = httpRequest(url, { method, headers }, (res) => {
      let text = ''
      res.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

function encryptFor(login: LoopbackLogin, plaintext: string): string {
  const publicKeyB64u = new URL(login.authUrl).searchParams.get('public_key') ?? ''
  const publicKey = createPublicKey({ key: Buffer.from(publicKeyB64u, 'base64url'), format: 'der', type: 'spki' })
  const ciphertext = publicEncrypt(
    { key: publicKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(plaintext, 'utf8'),
  )
  return ciphertext.toString('base64url')
}

function params(login: LoopbackLogin): { redirectUri: string; state: string } {
  const search = new URL(login.authUrl).searchParams
  return { redirectUri: search.get('redirect_uri') ?? '', state: search.get('state') ?? '' }
}

async function start(): Promise<LoopbackLogin> {
  return startLoopbackLogin({ appBaseUrl: APP, timeoutMs: 5_000, readPastedCode: false })
}

describe('buildAuthUrl', () => {
  const base = {
    appBaseUrl: APP,
    publicKeyB64u: 'pk',
    redirectUri: 'http://127.0.0.1:1234/auth/callback',
    state: 's',
  }

  it('omits intent by default', () => {
    const url = new URL(buildAuthUrl(base))
    assert.equal(url.origin + url.pathname, `${APP}/cli/auth`)
    assert.equal(url.searchParams.get('key_type'), KEY_TYPE)
    assert.equal(url.searchParams.has('intent'), false)
  })

  it('omits org_id by default and adds it when given', () => {
    assert.equal(new URL(buildAuthUrl(base)).searchParams.has('org_id'), false)
    assert.equal(new URL(buildAuthUrl({ ...base, orgId: 'org_1' })).searchParams.get('org_id'), 'org_1')
  })

  it('adds intent when given', () => {
    assert.equal(new URL(buildAuthUrl({ ...base, intent: 'setup' })).searchParams.get('intent'), 'setup')
  })
})

describe('buildSignUpUrl', () => {
  it('carries the full auth URL as redirect_url', () => {
    const authUrl = `${APP}/cli/auth?public_key=pk&state=s&intent=setup`
    const url = new URL(buildSignUpUrl(APP, authUrl))
    assert.equal(url.origin + url.pathname, `${APP}/sign-up`)
    assert.equal(url.searchParams.get('redirect_url'), authUrl)
  })
})

describe('startLoopbackLogin', () => {
  it('binds 127.0.0.1 on a free port and passes intent through', async () => {
    const login = await startLoopbackLogin({
      appBaseUrl: APP,
      timeoutMs: 5_000,
      readPastedCode: false,
      intent: 'setup',
    })
    const { redirectUri } = params(login)
    assert.match(redirectUri, new RegExp(`^http://127\\.0\\.0\\.1:\\d+${CALLBACK_PATH}$`))
    assert.equal(new URL(login.authUrl).searchParams.get('intent'), 'setup')
    login.submitCode(encryptFor(login, 'cleanup'))
    await login.result
  })

  it('accepts a callback with the right origin, state, and key type', async () => {
    const login = await start()
    const { redirectUri, state } = params(login)
    const response = await post(
      redirectUri,
      JSON.stringify({ encrypted_key: encryptFor(login, 'sk-pl-abc'), state, key_type: KEY_TYPE }),
      APP,
    )
    assert.equal(response.status, 204)
    assert.deepEqual(await login.result, { ok: true, apiKey: 'sk-pl-abc' })
  })

  it('rejects a foreign or missing origin and keeps waiting', async () => {
    const login = await start()
    const { redirectUri, state } = params(login)
    const body = JSON.stringify({ encrypted_key: encryptFor(login, 'sk-pl-abc'), state, key_type: KEY_TYPE })

    assert.equal((await post(redirectUri, body, 'https://evil.example')).status, 403)
    assert.equal((await post(redirectUri, body, null)).status, 403)

    assert.equal((await post(redirectUri, body, APP)).status, 204)
    assert.deepEqual(await login.result, { ok: true, apiKey: 'sk-pl-abc' })
  })

  it('answers a preflight from the app origin', async () => {
    const login = await start()
    const { redirectUri } = params(login)
    assert.equal((await post(redirectUri, '', APP, 'OPTIONS')).status, 204)
    login.submitCode(encryptFor(login, 'cleanup'))
    await login.result
  })

  it('returns 404 off the callback path', async () => {
    const login = await start()
    const { redirectUri } = params(login)
    assert.equal((await post(redirectUri.replace(CALLBACK_PATH, '/other'), '{}', APP)).status, 404)
    login.submitCode(encryptFor(login, 'cleanup'))
    await login.result
  })

  it('fails on a state mismatch', async () => {
    const login = await start()
    const { redirectUri } = params(login)
    const response = await post(
      redirectUri,
      JSON.stringify({ encrypted_key: encryptFor(login, 'sk-pl-abc'), state: 'wrong', key_type: KEY_TYPE }),
      APP,
    )
    assert.equal(response.status, 400)
    assert.equal(JSON.parse(response.body).error, 'state_mismatch')
    const result = await login.result
    assert.equal(result.ok, false)
  })

  it('fails on an unsupported key type', async () => {
    const login = await start()
    const { redirectUri, state } = params(login)
    const response = await post(
      redirectUri,
      JSON.stringify({ encrypted_key: encryptFor(login, 'sk-pl-abc'), state, key_type: 'v0' }),
      APP,
    )
    assert.equal(response.status, 400)
    assert.equal(JSON.parse(response.body).error, 'unsupported_key_type')
    assert.equal((await login.result).ok, false)
  })

  it('fails on a ciphertext that does not decrypt', async () => {
    const login = await start()
    const { redirectUri, state } = params(login)
    const response = await post(
      redirectUri,
      JSON.stringify({ encrypted_key: 'bm90LWNpcGhlcnRleHQ', state, key_type: KEY_TYPE }),
      APP,
    )
    assert.equal(response.status, 400)
    assert.equal(JSON.parse(response.body).error, 'decrypt_failed')
    assert.equal((await login.result).ok, false)
  })

  it('accepts a pasted code and rejects a bad one without settling', async () => {
    const login = await start()
    assert.equal(login.submitCode('garbage'), false)
    assert.equal(login.submitCode(`  ${encryptFor(login, 'sk-pl-pasted')}\n`), true)
    assert.deepEqual(await login.result, { ok: true, apiKey: 'sk-pl-pasted' })
    assert.equal(login.submitCode(encryptFor(login, 'sk-pl-late')), false)
  })

  it('closes the callback server once settled', async () => {
    const login = await start()
    const { redirectUri } = params(login)
    login.submitCode(encryptFor(login, 'sk-pl-abc'))
    await login.result
    await assert.rejects(post(redirectUri, '{}', APP))
  })

  it('times out', async () => {
    const login = await startLoopbackLogin({ appBaseUrl: APP, timeoutMs: 20, readPastedCode: false })
    const result = await login.result
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /timed out/)
  })

  it('settles with the auth page error code on a cancel callback', async () => {
    const login = await start()
    const { redirectUri, state } = params(login)
    const response = await post(
      redirectUri,
      JSON.stringify({ error: 'user_cancelled', error_description: 'User cancelled CLI authorization.', state }),
      APP,
    )
    assert.equal(response.status, 204)
    assert.deepEqual(await login.result, {
      ok: false,
      error: 'User cancelled CLI authorization.',
      code: 'user_cancelled',
    })
  })

  it('falls back to the error code when a cancel callback has no description', async () => {
    const login = await start()
    const { redirectUri, state } = params(login)
    assert.equal((await post(redirectUri, JSON.stringify({ error: 'issue_failed', state }), APP)).status, 204)
    assert.deepEqual(await login.result, { ok: false, error: 'issue_failed', code: 'issue_failed' })
  })

  it('rejects a cancel callback with the wrong state', async () => {
    const login = await start()
    const { redirectUri } = params(login)
    const response = await post(redirectUri, JSON.stringify({ error: 'user_cancelled', state: 'wrong' }), APP)
    assert.equal(response.status, 400)
    assert.equal(JSON.parse(response.body).error, 'state_mismatch')
    const result = await login.result
    assert.equal(result.ok, false)
    assert.equal(result.ok ? 'ok' : result.code, null)
  })
})
