import { AuthError, whoami } from '../lib/api'
import { getApiSecret } from '../lib/config'

const HELP = `promptless whoami — display the currently authenticated user

usage:
  promptless whoami [options]

options:
  --json       Output the full response as JSON
  -h, --help   Show this help
`

async function _run(argv: string[]): Promise<void> {
  let asJson = false
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP)
      process.exit(0)
    } else if (arg === '--json') {
      asJson = true
    } else {
      process.stderr.write(`promptless whoami: unknown option ${arg}\n`)
      process.exit(2)
    }
  }

  const secret = getApiSecret()
  if (!secret) {
    process.stderr.write('promptless whoami: not logged in. Run `promptless login`.\n')
    process.exit(1)
  }

  try {
    const me = await whoami(secret)
    if (asJson) {
      process.stdout.write(JSON.stringify(me, null, 2) + '\n')
    } else {
      process.stdout.write(`${me.email}${me.name ? ` (${me.name})` : ''}\n`)
      if (me.organizations && me.organizations.length > 0) {
        process.stdout.write('Organizations:\n')
        for (const org of me.organizations) {
          process.stdout.write(`  - ${org.name} (${org.id})\n`)
        }
      }
    }
    process.exit(0)
  } catch (err) {
    const msg = err instanceof AuthError || err instanceof Error ? err.message : String(err)
    process.stderr.write(`promptless whoami: ${msg}\n`)
    process.exit(1)
  }
}

export function runWhoami(argv: string[]): never {
  void _run(argv).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`promptless whoami: ${msg}\n`)
    process.exit(1)
  })
  return undefined as never
}
