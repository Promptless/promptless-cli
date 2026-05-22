export const APP_BASE_URL =
  process.env.PROMPTLESS_APP_BASE_URL && process.env.PROMPTLESS_APP_BASE_URL.length > 0
    ? process.env.PROMPTLESS_APP_BASE_URL.replace(/\/+$/, '')
    : 'https://app.gopromptless.ai'

export const API_BASE_URL =
  process.env.PROMPTLESS_API_BASE_URL && process.env.PROMPTLESS_API_BASE_URL.length > 0
    ? process.env.PROMPTLESS_API_BASE_URL.replace(/\/+$/, '')
    : 'https://api.gopromptless.ai'

export interface WhoamiResponse {
  user_id: string
  email: string
  name?: string
  organizations?: Array<{ id: string; name: string }>
}

export class AuthError extends Error {}

export async function whoami(apiSecret: string): Promise<WhoamiResponse> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/v1/me`, {
      headers: {
        Authorization: `Bearer ${apiSecret}`,
        Accept: 'application/json',
        'User-Agent': 'promptless-cli',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`network error contacting ${API_BASE_URL}: ${msg}`)
  }

  if (res.status === 401 || res.status === 403) {
    throw new AuthError(
      'authentication failed — the API key may be expired or revoked. Run `promptless login` to re-authenticate.',
    )
  }
  if (!res.ok) {
    throw new Error(`whoami failed: HTTP ${res.status} ${res.statusText}`)
  }

  return (await res.json()) as WhoamiResponse
}
