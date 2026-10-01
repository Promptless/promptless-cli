export const APP_BASE_URL =
  process.env.PROMPTLESS_APP_BASE_URL && process.env.PROMPTLESS_APP_BASE_URL.length > 0
    ? process.env.PROMPTLESS_APP_BASE_URL.replace(/\/+$/, '')
    : 'https://app.gopromptless.ai'

export const API_BASE_URL =
  process.env.PROMPTLESS_API_BASE_URL && process.env.PROMPTLESS_API_BASE_URL.length > 0
    ? process.env.PROMPTLESS_API_BASE_URL.replace(/\/+$/, '')
    : 'https://api.gopromptless.ai'

const DEFAULT_TIMEOUT_MS = 30_000

/** A non-2xx response. `code` is the machine-readable error name when the body carries one. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly body: unknown

  constructor(status: number, code: string | null, message: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

/** A 401: the API key is missing, expired, or revoked. */
export class AuthError extends ApiError {
  constructor(status: number, code: string | null, body: unknown) {
    super(
      status,
      code,
      'authentication failed — the API key may be expired or revoked. Run `promptless login` to re-authenticate.',
      body,
    )
    this.name = 'AuthError'
  }
}

export interface ParsedErrorBody {
  code: string | null
  message: string | null
}

const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]*$/

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.length > 0 ? field : null
}

function codeOrNull(value: string | null): string | null {
  return value !== null && ERROR_CODE_PATTERN.test(value) ? value : null
}

function formatValidationItem(item: unknown): string | null {
  const msg = stringField(item, 'msg')
  if (msg === null) return null
  const loc = (item as Record<string, unknown>).loc
  return Array.isArray(loc) && loc.length > 0 ? `${loc.join('.')}: ${msg}` : msg
}

/**
 * Extract an error code and message from a runtime error body. Handles the
 * FastAPI shapes `{"detail": "..."}`, `{"detail": {"code", "message"}}`, and
 * `{"detail": [{"loc", "msg"}]}`, plus the runtime's `{"error", "message"}`.
 * `error` counts as a code only when it is snake_case; otherwise it is the message.
 *
 * @example
 *   parseErrorBody({ detail: { code: 'doc_collection_required', message: 'Add a docs repo' } })
 *   // → { code: 'doc_collection_required', message: 'Add a docs repo' }
 */
export function parseErrorBody(body: unknown): ParsedErrorBody {
  if (typeof body !== 'object' || body === null) return { code: null, message: null }
  const detail = (body as Record<string, unknown>).detail

  if (typeof detail === 'string') return { code: null, message: detail }
  if (Array.isArray(detail)) {
    const parts = detail.map(formatValidationItem).filter((part) => part !== null)
    return { code: null, message: parts.length > 0 ? parts.join('; ') : null }
  }
  if (typeof detail === 'object' && detail !== null) {
    const code = codeOrNull(stringField(detail, 'code') ?? stringField(detail, 'error'))
    return { code, message: stringField(detail, 'message') }
  }

  const error = stringField(body, 'error')
  const code = codeOrNull(error)
  return { code, message: stringField(body, 'message') ?? (code === null ? error : null) }
}

function parseJsonOrText(text: string): unknown {
  if (text.length === 0) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export interface RequestOptions {
  apiSecret: string
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  /** Defaults to `API_BASE_URL`. */
  baseUrl?: string
}

/**
 * Call the Promptless API and return the parsed JSON body (`undefined` for an empty body).
 *
 * @throws AuthError on 401.
 * @throws ApiError on any other non-2xx status.
 * @throws Error on a network failure or timeout. A caller's abort rethrows its signal's reason.
 */
export async function request<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
  const baseUrl = opts.baseUrl ?? API_BASE_URL
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiSecret}`,
    Accept: 'application/json',
    'User-Agent': 'promptless-cli',
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  let text: string
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal,
    })
    text = await res.text()
  } catch (err) {
    if (opts.signal?.aborted) throw opts.signal.reason
    if (timeoutSignal.aborted) {
      throw new Error(`${method} ${path} timed out after ${timeoutMs}ms contacting ${baseUrl}`)
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`network error contacting ${baseUrl}: ${msg}`)
  }

  const body = parseJsonOrText(text)
  if (res.status === 401) {
    throw new AuthError(res.status, parseErrorBody(body).code, body)
  }
  if (!res.ok) {
    const parsed = parseErrorBody(body)
    const message = parsed.message ?? `HTTP ${res.status} ${res.statusText}`
    throw new ApiError(res.status, parsed.code, `${method} ${path} failed: ${message}`, body)
  }
  return (body ?? undefined) as T
}

export interface WhoamiResponse {
  user_id: string
  email: string
  name?: string
  organizations?: Array<{ id: string; name: string }>
}

export async function whoami(apiSecret: string): Promise<WhoamiResponse> {
  try {
    return await request<WhoamiResponse>('GET', '/v1/me', { apiSecret })
  } catch (err) {
    // `/v1/me` answers 403 for a key bound to no user, which `promptless login` fixes.
    if (err instanceof ApiError && err.status === 403) {
      throw new AuthError(err.status, err.code, err.body)
    }
    throw err
  }
}
