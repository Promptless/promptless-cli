import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { constants, createPublicKey, publicEncrypt } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const ORIGINAL_CONFIG = 'PROMPTLESS_CLI_API_SECRET=sk-pl-previous\nOTHER_SETTING=keep\n'
const NEW_KEY = 'sk-pl-new-test'
const IDENTITY = {
  user_id: 'user_test',
  email: 'test@example.com',
  organization_id: 'org_expected',
  organization_name: 'Test organization',
}

interface LoginScenario {
  responseStatus: number
  responseBody: unknown
  cancel?: boolean
}

// Run the real sign-in flow and encrypted loopback callback against a local
// runtime. No production credentials, browser, or account is involved.
async function runLogin(scenario: LoginScenario) {
  const directory = mkdtempSync(join(tmpdir(), 'promptless-setup-login-'))
  const configPath = join(directory, 'env')
  writeFileSync(configPath, ORIGINAL_CONFIG, { mode: 0o600 })
  const requests: Array<{ url: string | undefined; authorization: string | undefined }> = []
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization })
    res.writeHead(scenario.responseStatus, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(scenario.responseBody))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const child = spawn(process.execPath, [
    '--import', 'tsx', '--input-type=module', '--eval',
    `import { signIn } from ${JSON.stringify(new URL('./login.ts', import.meta.url).href)};
     try {
       await signIn({ org: 'org_expected', newAccount: true, openBrowser: false });
     } catch (err) {
       process.stderr.write(err.message + '\\n');
       process.exitCode = 1;
     }`,
  ], {
    env: {
      ...process.env,
      PROMPTLESS_API_BASE_URL: baseUrl,
      PROMPTLESS_APP_BASE_URL: baseUrl,
      PROMPTLESS_CLI_DEVELOPER_CONFIG_FILE: configPath,
      PROMPTLESS_CLI_API_SECRET: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  let stdout = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once('close', resolve)
    child.once('error', reject)
  })
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000)

  try {
    const signUpUrl = await new Promise<URL>((resolve, reject) => {
      const inspect = () => {
        const match = /Open (http\S+) in your browser\./.exec(stderr)
        if (match) resolve(new URL(match[1]))
      }
      child.stderr.on('data', inspect)
      void finished.then(() => reject(new Error(`Sign-in ended before printing its URL: ${stderr}`)), reject)
      inspect()
    })
    assert.equal(signUpUrl.pathname, '/sign-up')
    const authUrl = new URL(signUpUrl.searchParams.get('redirect_url')!)
    assert.equal(authUrl.pathname, '/cli/auth')
    assert.equal(authUrl.searchParams.get('intent'), 'setup')
    assert.equal(authUrl.searchParams.get('org_id'), 'org_expected')
    const publicKey = createPublicKey({
      key: Buffer.from(authUrl.searchParams.get('public_key')!, 'base64url'),
      type: 'spki',
      format: 'der',
    })
    const payload = scenario.cancel
      ? { state: authUrl.searchParams.get('state'), error: 'user_cancelled', error_description: 'Cancelled' }
      : {
          state: authUrl.searchParams.get('state'),
          key_type: 'v1',
          encrypted_key: publicEncrypt({
            key: publicKey,
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
          }, Buffer.from(NEW_KEY)).toString('base64url'),
        }
    const callback = await fetch(authUrl.searchParams.get('redirect_uri')!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify(payload),
    })
    assert.equal(callback.status, 204)
    const exitCode = await finished
    assert.doesNotMatch(stdout + stderr, /sk-pl-(previous|new-test)/)
    return {
      exitCode,
      stderr,
      requests,
      config: readFileSync(configPath, 'utf8'),
      mode: statSync(configPath).mode & 0o777,
    }
  } finally {
    clearTimeout(deadline)
    child.kill('SIGKILL')
    await finished
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('setup sign-in', () => {
  it('verifies a new key before saving it and preserves other settings', async () => {
    const result = await runLogin({ responseStatus: 200, responseBody: IDENTITY })
    assert.equal(result.exitCode, 0)
    assert.equal(result.config, `PROMPTLESS_CLI_API_SECRET=${NEW_KEY}\nOTHER_SETTING=keep\n`)
    assert.equal(result.mode, 0o600)
    assert.deepEqual(result.requests, [{ url: '/v1/me', authorization: `Bearer ${NEW_KEY}` }])
  })

  it('keeps the previous key when the browser authorizes a different organization', async () => {
    const result = await runLogin({
      responseStatus: 200,
      responseBody: { ...IDENTITY, organization_id: 'org_other' },
    })
    assert.equal(result.exitCode, 1)
    assert.equal(result.config, ORIGINAL_CONFIG)
    assert.match(result.stderr, /not org_expected/)
    assert.doesNotMatch(result.stderr, /Saved the API key/)
  })

  it('keeps the previous key when identity verification rejects the new key', async () => {
    const result = await runLogin({ responseStatus: 401, responseBody: { error: 'authentication_failed' } })
    assert.equal(result.exitCode, 1)
    assert.equal(result.config, ORIGINAL_CONFIG)
    assert.match(result.stderr, /authentication failed/)
  })

  it('does not save a key or call the API when authorization is cancelled', async () => {
    const result = await runLogin({ responseStatus: 200, responseBody: IDENTITY, cancel: true })
    assert.equal(result.exitCode, 1)
    assert.equal(result.config, ORIGINAL_CONFIG)
    assert.deepEqual(result.requests, [])
    assert.match(result.stderr, /Sign-in was cancelled/)
  })
})
