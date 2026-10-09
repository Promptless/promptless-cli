import { PR_LIFECYCLE_EVENTS } from '../../lib/setup-api'
import type { PrLifecycleEvent } from '../../lib/setup-api'
import { SetupError } from './output'

export interface SetupFlags {
  org: string | null
  docsRepo: string | null
  sourceRepos: string[]
  triggerOn: PrLifecycleEvent[]
  newAccount: boolean
  openBrowser: boolean
  backfill: boolean
}

export type ParsedArgs = { kind: 'help' } | { kind: 'run'; flags: SetupFlags }

const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/
const VALUE_FLAGS = new Set(['--org', '--docs-repo', '--source-repo', '--trigger-on'])

function badArguments(message: string): SetupError {
  return new SetupError('bad_arguments', message)
}

function repoValue(flag: string, value: string): string {
  if (!REPO_PATTERN.test(value)) throw badArguments(`${flag} expects owner/repo, got '${value}'`)
  return value
}

function lifecycleEvents(value: string): PrLifecycleEvent[] {
  return value.split(',').map((part) => {
    const event = PR_LIFECYCLE_EVENTS.find((candidate) => candidate === part.trim())
    if (event === undefined) {
      throw badArguments(`--trigger-on expects ${PR_LIFECYCLE_EVENTS.join(', ')}; got '${part.trim()}'`)
    }
    return event
  })
}

/**
 * Parse `promptless setup` arguments. Value flags take `--flag value` or
 * `--flag=value`; `--source-repo` and `--trigger-on` repeat, and
 * `--trigger-on` also takes a comma-separated list.
 *
 * @throws SetupError with code `bad_arguments` for an unknown flag or a bad value.
 */
export function parseSetupArgs(argv: string[]): ParsedArgs {
  const flags: SetupFlags = {
    org: null,
    docsRepo: null,
    sourceRepos: [],
    triggerOn: [],
    newAccount: false,
    openBrowser: true,
    backfill: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') return { kind: 'help' }
    if (arg === '--new-account') {
      flags.newAccount = true
      continue
    }
    if (arg === '--no-browser') {
      flags.openBrowser = false
      continue
    }
    if (arg === '--backfill') {
      flags.backfill = true
      continue
    }

    const eq = arg.indexOf('=')
    const name = eq >= 0 ? arg.slice(0, eq) : arg
    if (!VALUE_FLAGS.has(name)) throw badArguments(`unknown option ${arg}`)
    let value: string
    if (eq >= 0) {
      value = arg.slice(eq + 1)
    } else {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) throw badArguments(`${name} needs a value`)
      value = next
      i++
    }
    if (value.length === 0) throw badArguments(`${name} needs a value`)

    switch (name) {
      case '--org':
        flags.org = value
        break
      case '--docs-repo':
        flags.docsRepo = repoValue(name, value)
        break
      case '--source-repo':
        flags.sourceRepos.push(repoValue(name, value))
        break
      case '--trigger-on':
        flags.triggerOn.push(...lifecycleEvents(value))
        break
    }
  }

  flags.triggerOn = flags.triggerOn.length === 0 ? ['merge'] : [...new Set(flags.triggerOn)]
  return { kind: 'run', flags }
}
