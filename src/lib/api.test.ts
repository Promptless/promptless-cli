import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import { ApiError, AuthError, parseErrorBody, request } from './api'

describe('parseErrorBody', () => {
  it('reads a FastAPI string detail', () => {
    assert.deepEqual(parseErrorBody({ detail: 'Forbidden' }), { code: null, message: 'Forbidden' })
  })

  it('reads a FastAPI object detail with code and message', () => {
    assert.deepEqual(
      parseErrorBody({ detail: { code: 'doc_collection_required', message: 'Add a docs repository first' } }),
      { code: 'doc_collection_required', message: 'Add a docs repository first' },
    )
  })

  it('reads a FastAPI object detail with only a code', () => {
    assert.deepEqual(parseErrorBody({ detail: { code: 'host_enrollment_inactive' } }), {
      code: 'host_enrollment_inactive',
      message: null,
    })
  })

  it('joins FastAPI validation errors with their locations', () => {
    const body = {
      detail: [
        { loc: ['body', 'doc_collection', 'repo'], msg: 'Field required', type: 'missing' },
        { loc: [], msg: 'Bad request', type: 'value_error' },
      ],
    }
    assert.deepEqual(parseErrorBody(body), {
      code: null,
      message: 'body.doc_collection.repo: Field required; Bad request',
    })
  })

  it('reads the runtime error/message shape', () => {
    assert.deepEqual(parseErrorBody({ error: 'org_level_key', message: 'Run `promptless login`.' }), {
      code: 'org_level_key',
      message: 'Run `promptless login`.',
    })
  })

  it('reads the runtime error/detail shape', () => {
    assert.deepEqual(
      parseErrorBody({ error: 'trigger_not_backfillable', detail: 'Only pull request triggers can be backfilled' }),
      { code: 'trigger_not_backfillable', message: 'Only pull request triggers can be backfilled' },
    )
  })

  it('reads a bare runtime error code', () => {
    assert.deepEqual(parseErrorBody({ error: 'trigger_not_found' }), { code: 'trigger_not_found', message: null })
  })

  it('treats a prose error field as the message', () => {
    assert.deepEqual(parseErrorBody({ error: 'Validation failed', validation_errors: [] }), {
      code: null,
      message: 'Validation failed',
    })
  })

  it('returns nulls for bodies with no error fields', () => {
    assert.deepEqual(parseErrorBody('<html>Bad Gateway</html>'), { code: null, message: null })
    assert.deepEqual(parseErrorBody(null), { code: null, message: null })
    assert.deepEqual(parseErrorBody({ detail: [] }), { code: null, message: null })
  })
})

describe('request', () => {
  let server: Server
  let baseUrl: string

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
    'GET /ok': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ authorization: req.headers.authorization }))
    },
    'POST /echo': (req, res) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ contentType: req.headers['content-type'], body: JSON.parse(raw) }))
      })
    },
    'POST /empty': (_req, res) => {
      res.writeHead(204)
      res.end()
    },
    'GET /unauthorized': (_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'authentication_failed', message: 'API key is unknown or revoked' }))
    },
    'POST /conflict': (_req, res) => {
      res.writeHead(409, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: { code: 'doc_collection_required', message: 'Add a docs repository' } }))
    },
    'GET /missing-trigger': (_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'trigger_not_found' }))
    },
    'GET /bad-gateway': (_req, res) => {
      res.writeHead(502, { 'Content-Type': 'text/html' })
      res.end('<html>Bad Gateway</html>')
    },
    'GET /slow': (_req, res) => {
      setTimeout(() => {
        res.writeHead(200)
        res.end('{}')
      }, 500)
    },
  }

  before(async () => {
    server = createServer((req, res) => {
      const handler = routes[`${req.method} ${req.url}`]
      if (handler) handler(req, res)
      else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  after(() => {
    server.closeAllConnections()
    server.close()
  })

  it('sends the bearer key and returns the JSON body', async () => {
    const body = await request<{ authorization: string }>('GET', '/ok', { apiSecret: 'sk-pl-test', baseUrl })
    assert.equal(body.authorization, 'Bearer sk-pl-test')
  })

  it('sends a JSON body', async () => {
    const body = await request<{ contentType: string; body: unknown }>('POST', '/echo', {
      apiSecret: 'k',
      baseUrl,
      body: { dry_run: true },
    })
    assert.deepEqual(body, { contentType: 'application/json', body: { dry_run: true } })
  })

  it('returns undefined for an empty body', async () => {
    assert.equal(await request('POST', '/empty', { apiSecret: 'k', baseUrl }), undefined)
  })

  it('throws AuthError on 401', async () => {
    await assert.rejects(request('GET', '/unauthorized', { apiSecret: 'k', baseUrl }), (err) => {
      assert.ok(err instanceof AuthError)
      assert.equal(err.status, 401)
      assert.equal(err.code, 'authentication_failed')
      return true
    })
  })

  it('throws ApiError with the parsed code and raw body', async () => {
    await assert.rejects(request('POST', '/conflict', { apiSecret: 'k', baseUrl, body: {} }), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err instanceof AuthError, false)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'doc_collection_required')
      assert.deepEqual(err.body, { detail: { code: 'doc_collection_required', message: 'Add a docs repository' } })
      return true
    })
  })

  it('names the error code in the message when the body has no message', async () => {
    await assert.rejects(request('GET', '/missing-trigger', { apiSecret: 'k', baseUrl }), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 404)
      assert.equal(err.code, 'trigger_not_found')
      assert.equal(err.message, 'GET /missing-trigger failed: trigger_not_found')
      return true
    })
  })

  it('throws ApiError with the text body when the body is not JSON', async () => {
    await assert.rejects(request('GET', '/bad-gateway', { apiSecret: 'k', baseUrl }), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 502)
      assert.equal(err.code, null)
      assert.equal(err.body, '<html>Bad Gateway</html>')
      return true
    })
  })

  it('times out', async () => {
    await assert.rejects(
      request('GET', '/slow', { apiSecret: 'k', baseUrl, timeoutMs: 50 }),
      (err) => err instanceof Error && !(err instanceof ApiError) && /timed out/.test(err.message),
    )
  })

  it("rethrows the caller's abort reason", async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled by user')
    setTimeout(() => controller.abort(reason), 20)
    await assert.rejects(
      request('GET', '/slow', { apiSecret: 'k', baseUrl, signal: controller.signal }),
      (err) => err === reason,
    )
  })
})
