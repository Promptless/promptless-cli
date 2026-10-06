import { openInBrowser } from '../../lib/browser'
import { PollTimeoutError, pollUntil } from '../../lib/poll'
import {
  beginGitHubInstall,
  getSetupStatus,
  installedRepos,
  pullGitHubInstallations,
} from '../../lib/setup-api'
import type { SetupStatus } from '../../lib/setup-api'
import { link } from '../../lib/ui/link'
import { selectOne } from '../../lib/ui/prompt'
import { SetupError, done, note, step, warn } from './output'
import type { Session } from './login'

// Screen 2: the GitHub App gate. Pass straight through when an installation
// exists; otherwise open the install page and poll `setup/status` until one
// appears, while a prompt offers to decline or re-open the page. The loop
// follows PostHog's GitHub gate (MIT, github.com/PostHog/wizard
// src/ui/tui/screens/SelfDrivingGitHubScreen.tsx).

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 30 * 60 * 1000
/** Every this many polls, ask the runtime to re-read installations from GitHub (covers admin approval). */
const PULL_EVERY = 10

export type GateChoice = 'decline' | 'open'

export type GateEvent =
  | { kind: 'already_connected'; status: SetupStatus }
  | { kind: 'install_link'; url: string; opened: boolean }
  | { kind: 'pending_approval'; githubOrgs: string[] }
  | { kind: 'check_failed'; error: unknown }
  | { kind: 'connected'; status: SetupStatus }

export type GateOutcome =
  | { kind: 'connected'; status: SetupStatus }
  | { kind: 'declined' }
  | { kind: 'cancelled' }
  | { kind: 'timed_out' }

export interface GateDeps {
  fetchStatus: () => Promise<SetupStatus>
  /** Start an install and return the URL to open. */
  begin: () => Promise<string>
  pull: () => Promise<void>
  openUrl: (url: string) => void
  /**
   * Ask whether to decline or open the install page. Resolve null when the
   * user cancels or when `signal` aborts; the gate aborts the prompt to print
   * an event or to finish, and asks again when it is still waiting.
   */
  ask: (installOpened: boolean, signal: AbortSignal) => Promise<GateChoice | null>
  /** Show an event. Called only while no prompt is open. */
  report: (event: GateEvent) => void
  /** Open the install page before the first prompt. */
  openOnStart: boolean
  intervalMs: number
  timeoutMs: number
  pullEvery: number
}

function pendingOrgs(status: SetupStatus): string[] {
  return status.github.pending_approval.map((request) => request.github_org_login).sort()
}

/**
 * Wait until the organization has a GitHub App installation, the user
 * declines, the user cancels, or `timeoutMs` passes.
 */
export async function runGitHubGate(deps: GateDeps): Promise<GateOutcome> {
  const initial = await deps.fetchStatus()
  if (initial.github.connected) {
    deps.report({ kind: 'already_connected', status: initial })
    return { kind: 'connected', status: initial }
  }

  const url = await deps.begin()
  let installOpened = false
  if (deps.openOnStart) {
    deps.openUrl(url)
    installOpened = true
  }
  deps.report({ kind: 'install_link', url, opened: installOpened })

  const queued: GateEvent[] = []
  let promptAbort = new AbortController()
  const notify = (event: GateEvent): void => {
    queued.push(event)
    promptAbort.abort()
  }
  const flush = (): void => {
    for (const event of queued.splice(0)) deps.report(event)
  }

  let lastPending = pendingOrgs(initial).join(',')
  if (lastPending.length > 0) queued.push({ kind: 'pending_approval', githubOrgs: pendingOrgs(initial) })

  const pollAbort = new AbortController()
  let pollFinished = false
  const pollDone: Promise<GateOutcome | null> = pollUntil(
    async (attempt) => {
      if (attempt % deps.pullEvery === 0) await deps.pull()
      const status = await deps.fetchStatus()
      const pending = pendingOrgs(status)
      if (pending.join(',') !== lastPending) {
        lastPending = pending.join(',')
        if (pending.length > 0 && !status.github.connected) notify({ kind: 'pending_approval', githubOrgs: pending })
      }
      return status.github.connected ? status : null
    },
    {
      intervalMs: deps.intervalMs,
      timeoutMs: deps.timeoutMs,
      signal: pollAbort.signal,
      onError: (error) => notify({ kind: 'check_failed', error }),
    },
  )
    .then(
      (status): GateOutcome => ({ kind: 'connected', status }),
      (err: unknown): GateOutcome | null => {
        if (err instanceof PollTimeoutError) return { kind: 'timed_out' }
        if (pollAbort.signal.aborted) return null
        throw err
      },
    )
    .finally(() => {
      pollFinished = true
      promptAbort.abort()
    })
  // Awaited below; this branch only keeps a rejection from being reported as unhandled meanwhile.
  pollDone.catch(() => {})

  const askLoop = async (): Promise<GateOutcome | null> => {
    for (;;) {
      flush()
      if (pollFinished) return null
      promptAbort = new AbortController()
      const choice = await deps.ask(installOpened, promptAbort.signal)
      if (promptAbort.signal.aborted) continue
      if (choice === null) return { kind: 'cancelled' }
      if (choice === 'decline') return { kind: 'declined' }
      deps.openUrl(url)
      installOpened = true
      deps.report({ kind: 'install_link', url, opened: true })
    }
  }

  const userOutcome = await askLoop()
  if (userOutcome !== null) {
    pollAbort.abort()
    await pollDone
    return userOutcome
  }

  const outcome = (await pollDone) ?? { kind: 'timed_out' }
  flush()
  if (outcome.kind === 'connected') deps.report({ kind: 'connected', status: outcome.status })
  return outcome
}

function describeConnection(status: SetupStatus): string {
  const owners = status.github.installations
    .map((installation) => installation.owner)
    .filter((owner): owner is string => owner !== null)
  const count = installedRepos(status).length
  const repos = `${count} ${count === 1 ? 'repository' : 'repositories'}`
  return owners.length > 0 ? `${owners.join(', ')}, ${repos}` : repos
}

function reportEvent(event: GateEvent): void {
  switch (event.kind) {
    case 'already_connected':
    case 'connected':
      done(`GitHub connected: ${describeConnection(event.status)}`)
      return
    case 'install_link':
      note(
        event.opened
          ? `Opened ${link(event.url)} in your browser.`
          : `Open ${link(event.url)} to install the GitHub App.`,
      )
      return
    case 'pending_approval':
      warn(
        `The install is waiting for a GitHub admin of ${event.githubOrgs.join(', ')} to approve it. ` +
          'Setup continues once they approve.',
      )
      return
    case 'check_failed': {
      const message = event.error instanceof Error ? event.error.message : String(event.error)
      warn(`Could not check the installation (${message}). Still checking.`)
      return
    }
  }
}

async function askGateChoice(installOpened: boolean, signal: AbortSignal): Promise<GateChoice | null> {
  return selectOne<GateChoice>({
    message: 'Waiting for the installation...',
    choices: [
      { value: 'decline', label: "I can't connect right now" },
      { value: 'open', label: installOpened ? 'Re-open GitHub App install' : 'Open GitHub App install' },
    ],
    signal,
  })
}

/**
 * Screen 2: make sure the GitHub App is installed, and return the status that shows it.
 *
 * @throws SetupError when the user declines or cancels, or the install does not arrive in 30 minutes.
 */
export async function connectGitHub(session: Session, openBrowser: boolean): Promise<SetupStatus> {
  step(2, 'Connect GitHub')
  const { client, orgId } = session

  const outcome = await runGitHubGate({
    fetchStatus: () => getSetupStatus(client, orgId),
    begin: async () => {
      note('Promptless needs the GitHub App on your docs repository and on the repositories whose merges')
      note('should update it. Grant both when GitHub asks which repositories to include.')
      return beginGitHubInstall(client, orgId)
    },
    pull: () => pullGitHubInstallations(client, orgId),
    openUrl: openInBrowser,
    ask: askGateChoice,
    report: reportEvent,
    openOnStart: openBrowser,
    intervalMs: POLL_INTERVAL_MS,
    timeoutMs: POLL_TIMEOUT_MS,
    pullEvery: PULL_EVERY,
  })

  switch (outcome.kind) {
    case 'connected':
      return outcome.status
    case 'declined':
      throw new SetupError(
        'github_not_connected',
        'Promptless needs the GitHub App to read your documentation repository. ' +
          'Nothing was changed. Run `promptless setup` again when you are ready.',
      )
    case 'cancelled':
      throw new SetupError('cancelled', 'Setup was cancelled. Nothing was changed.')
    case 'timed_out':
      throw new SetupError(
        'github_not_connected',
        'No GitHub App installation arrived within 30 minutes. ' +
          'Nothing was changed. Run `promptless setup` again when you are ready.',
      )
  }
}
