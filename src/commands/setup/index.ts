import { API_BASE_URL, APP_BASE_URL, ApiError, AuthError, NetworkError } from '../../lib/api'
import { emitError } from '../../lib/errors'
import type { ErrorLine } from '../../lib/errors'
import { readOriginGitHubRepo } from '../../lib/git-remote'
import { parseSetupArgs } from './args'
import type { SetupFlags } from './args'
import { offerBackfill } from './backfill'
import { completeSetup } from './complete'
import { findDocsRepo } from './docs'
import { buildExitBlock, renderExitBlock } from './exit'
import { connectGitHub } from './github'
import { signIn } from './login'
import { SetupError, done, step } from './output'
import { reviewAndApply } from './review'
import { chooseSourceRepos } from './sources'

const HELP = `promptless setup — connect GitHub and keep your docs current from merged pull requests

usage:
  promptless setup [options]

options:
  --org <id>                Run against this organization. The sign-in page picks it
                            when the saved key belongs to another one.
  --docs-repo <owner/repo>  Use this documentation repository instead of asking.
  --source-repo <owner/repo>
                            Update the docs when a pull request merges here. Repeat for
                            several repositories. Skips the repository prompt.
  --trigger-on <event>      Pull request events that update the docs: opened,
                            first_approval, merge, updated. Repeat or comma-separate.
                            Default: merge.
  --backfill                Run Promptless on the last 7 days of merged pull requests
                            without asking.
  --new-account             Open the sign-up page instead of sign-in.
  --no-browser              Print links instead of opening them.
  -h, --help                Show this help

description:
  Signs in (reusing the saved API key when it still works), waits for the
  Promptless GitHub App to be installed, finds your documentation repository,
  and adds it to your organization's promptless.yaml together with a trigger
  on the source repositories you choose. Completes onboarding, which starts the
  free trial, and can run Promptless on recent merged pull requests.

  promptless.yaml lives in your organization's Promptless knowledge-base
  repository and is written by Promptless. Setup writes nothing to the current
  repository; the only local file it writes is the API key in the config file
  that \`promptless login\` uses.

  Running setup again skips every step that is already done.

  Setup needs an interactive terminal. Every fatal error also prints one line
  on stderr: promptless-error: {"code": "...", "message": "..."}

exit codes:
  0   setup finished
  1   setup stopped: declined, cancelled, or failed
  2   argument error
`

function errorLineFor(err: unknown): ErrorLine {
  if (err instanceof SetupError) return { code: err.code, message: err.message }
  if (err instanceof AuthError) return { code: 'auth_failed', message: err.message }
  if (err instanceof ApiError) return { code: 'api_error', message: err.message }
  if (err instanceof NetworkError) return { code: 'network_error', message: err.message }
  return { code: 'internal_error', message: err instanceof Error ? err.message : String(err) }
}

function fail(err: unknown): never {
  const line = errorLineFor(err)
  process.stderr.write(`\n${line.message}\n`)
  emitError(line)
  process.exit(line.code === 'bad_arguments' ? 2 : 1)
}

async function runScreens(flags: SetupFlags): Promise<void> {
  process.stderr.write(
    'Promptless setup\n' +
      '  Keeps your documentation current from merged pull requests. About three minutes.\n' +
      '  Nothing is written to this repository.\n',
  )
  const cwdRepo = readOriginGitHubRepo()

  const session = await signIn({ org: flags.org, newAccount: flags.newAccount, openBrowser: flags.openBrowser })
  const status = await connectGitHub(session, flags.openBrowser)
  const docs = await findDocsRepo(session, status, flags.docsRepo, cwdRepo)
  const sources = await chooseSourceRepos(status, docs.repo, docs.existing, flags.sourceRepos, cwdRepo)

  let triggerKey: string
  let triggerAdded: boolean
  if (sources.kind === 'existing') {
    step(5, 'Review')
    done('promptless.yaml already has this collection and a pull request trigger. Nothing to change.')
    triggerKey = sources.triggerKey
    triggerAdded = false
  } else {
    const applied = await reviewAndApply(session, docs, sources.repos, flags.triggerOn)
    triggerKey = applied.trigger.key
    triggerAdded = applied.trigger.added
  }

  const finalStatus = await completeSetup(session, status)

  let backfillTriggerKey: string | null = null
  if (triggerAdded || flags.backfill) {
    const started = await offerBackfill(session, {
      triggerKey,
      sourceRepos: sources.repos,
      skipQuestion: flags.backfill,
    })
    if (started) backfillTriggerKey = triggerKey
  }

  process.stdout.write(
    renderExitBlock(
      buildExitBlock({
        appBaseUrl: APP_BASE_URL,
        apiBaseUrl: API_BASE_URL,
        docsRepo: docs.repo,
        sourceRepos: sources.repos,
        billing: finalStatus.billing,
        backfillTriggerKey,
      }),
    ),
  )
}

export function runSetup(argv: string[]): never {
  let flags: SetupFlags
  try {
    const parsed = parseSetupArgs(argv)
    if (parsed.kind === 'help') {
      process.stdout.write(HELP)
      process.exit(0)
    }
    flags = parsed.flags
  } catch (err) {
    fail(err)
  }

  if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
    fail(
      new SetupError(
        'interactive_terminal_required',
        'promptless setup asks questions as it goes, so it needs an interactive terminal. ' +
          'Run it again in a terminal window.',
      ),
    )
  }

  void runScreens(flags).then(
    () => process.exit(0),
    (err: unknown) => fail(err),
  )
  return undefined as never
}
