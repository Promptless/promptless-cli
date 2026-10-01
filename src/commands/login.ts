import { openInBrowser } from '../lib/browser'
import { APP_BASE_URL, AuthError, whoami } from '../lib/api'
import { startLoopbackLogin } from '../lib/auth/loopback'
import { loadConfigFile, resolveConfigFilePath, saveConfigFile } from '../lib/config'

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

  const login = await startLoopbackLogin({
    timeoutMs: 5 * 60 * 1000,
    readPastedCode: process.stdin.isTTY === true,
    onInvalidPaste: () => {
      process.stderr.write(
        "promptless login: that code didn't decrypt — paste the full code, or wait for the browser callback.\n",
      )
    },
  })

  if (shouldOpenBrowser) {
    process.stderr.write(
      `Attempting to open your default browser.\nIf the browser does not open, open the following URL:\n\n${login.authUrl}\n\n`,
    )
    openInBrowser(login.authUrl)
  } else {
    process.stderr.write(`Open the following URL:\n\n${login.authUrl}\n\n`)
  }

  process.stderr.write(
    `Waiting for the browser to deliver your API key...\n\nIf the browser can't reach this terminal (e.g. SSH or remote shell), the auth\npage will show a verification code — paste it here and press Enter:\n\n`,
  )

  const result = await login.result

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
