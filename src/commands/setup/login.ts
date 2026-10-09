import { APP_BASE_URL, AuthError, whoami } from '../../lib/api'
import type { WhoamiResponse } from '../../lib/api'
import { buildSignUpUrl, startLoopbackLogin } from '../../lib/auth/loopback'
import { openInBrowser } from '../../lib/browser'
import { getApiSecret, loadConfigFile, resolveConfigFilePath, saveConfigFile } from '../../lib/config'
import type { SetupClient } from '../../lib/setup-api'
import { link } from '../../lib/ui/link'
import { SetupError, done, note, step, warn } from './output'

// Screen 1: sign in. Reuse the saved key when `/v1/me` accepts it, otherwise
// run the loopback login, and resolve the organization the key is bound to.

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000

export interface SignInOptions {
  /** `--org`: the organization setup must run against. */
  org: string | null
  /** `--new-account`: open the sign-up page first and skip the saved key. */
  newAccount: boolean
  openBrowser: boolean
}

export interface Session {
  client: SetupClient
  email: string
  orgId: string
  orgName: string
}

async function whoamiOrNull(apiSecret: string): Promise<WhoamiResponse | null> {
  try {
    return await whoami(apiSecret)
  } catch (err) {
    if (err instanceof AuthError) return null
    throw err
  }
}

async function loopbackSignIn(opts: SignInOptions): Promise<string> {
  const login = await startLoopbackLogin({
    timeoutMs: LOGIN_TIMEOUT_MS,
    readPastedCode: true,
    intent: 'setup',
    orgId: opts.org ?? undefined,
    onInvalidPaste: () => warn("That code didn't decrypt. Paste the full code, or wait for the browser."),
  })
  const url = opts.newAccount ? buildSignUpUrl(APP_BASE_URL, login.authUrl) : login.authUrl

  if (opts.openBrowser) {
    openInBrowser(url)
    note(`Opened ${link(url)} in your browser.`)
  } else {
    note(`Open ${link(url)} in your browser.`)
  }
  if (!opts.newAccount) note('New to Promptless? Create an account on that page.')
  note('If the page shows a code instead of returning here, paste the code and press Enter.')

  const result = await login.result
  if (!result.ok) {
    if (result.code === 'user_cancelled') {
      throw new SetupError('cancelled', 'Sign-in was cancelled in the browser. Nothing was changed.')
    }
    throw new SetupError('login_failed', `Sign-in failed: ${result.error}`)
  }

  return result.apiKey
}

/**
 * Sign in and return the session every later screen uses.
 *
 * @throws SetupError when sign-in fails or is cancelled, or when the new key
 *   belongs to an organization other than `--org`.
 */
export async function signIn(opts: SignInOptions): Promise<Session> {
  step(1, 'Sign in')

  const saved = opts.newAccount ? undefined : getApiSecret()
  if (saved) {
    const me = await whoamiOrNull(saved)
    if (me !== null && (opts.org === null || me.organization_id === opts.org)) return signedIn(saved, me)
    if (me !== null) {
      note(`The saved key belongs to ${me.organization_name ?? me.organization_id}. Sign in to choose ${opts.org}.`)
    }
  }

  const apiSecret = await loopbackSignIn(opts)
  const me = await whoami(apiSecret)
  if (opts.org !== null && me.organization_id !== opts.org) {
    throw new SetupError(
      'bad_arguments',
      `You signed in to ${me.organization_name ?? me.organization_id} (${me.organization_id}), not ${opts.org}. ` +
        'Run `promptless setup` again and choose that organization on the sign-in page.',
    )
  }
  const config = loadConfigFile()
  config.PROMPTLESS_CLI_API_SECRET = apiSecret
  saveConfigFile(config)
  note(`Saved the API key to ${resolveConfigFilePath()}`)
  return signedIn(apiSecret, me)
}

function signedIn(apiSecret: string, me: WhoamiResponse): Session {
  const orgName = me.organization_name ?? me.organization_id
  done(`Signed in as ${me.email}, organization ${orgName}`)
  return { client: { apiSecret }, email: me.email, orgId: me.organization_id, orgName }
}
