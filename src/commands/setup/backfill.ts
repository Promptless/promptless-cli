import { ApiError } from '../../lib/api'
import { getBackfillStatus, previewBackfill, startBackfill } from '../../lib/setup-api'
import type { BackfillRequest } from '../../lib/setup-api'
import { selectOne } from '../../lib/ui/prompt'
import type { Session } from './login'
import { done, note, step, warn } from './output'

// Screen 7: offer a backfill over the last week of merged pull requests, so a
// first suggestion arrives without waiting for the next merge. The CLI starts
// the run and does not wait for it. This step is optional: a failure here
// warns and setup still finishes.

const LOOKBACK_DAYS = 7
const BACKFILL_REQUEST: BackfillRequest = { lookback_days: LOOKBACK_DAYS, skip_processed: true }

export interface BackfillOptions {
  triggerKey: string
  sourceRepos: string[] | 'all'
  /** `--backfill`: start without asking. */
  skipQuestion: boolean
}

function pullRequests(count: number, approximate: boolean): string {
  return `${approximate ? 'about ' : ''}${count} pull ${count === 1 ? 'request' : 'requests'}`
}

function apiMessage(err: ApiError): string {
  const body = typeof err.body === 'object' && err.body !== null ? (err.body as Record<string, unknown>) : {}
  return typeof body.message === 'string' ? body.message : err.message
}

async function describeActiveBackfill(session: Session, triggerKey: string): Promise<string> {
  try {
    const job = (await getBackfillStatus(session.client, session.orgId, triggerKey)).latest_job
    if (job !== null) {
      return `A backfill is already running: ${job.dispatched_count} of ${job.matched_count ?? 'the matched'} pull requests dispatched.`
    }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    warn(`Could not read the backfill progress: ${apiMessage(err)}`)
  }
  return 'A backfill is already running for this trigger.'
}

/**
 * Offer and start a backfill. Returns true when a backfill is running for the trigger.
 *
 * @throws Error only for failures other than an API error response, such as a network failure.
 */
export async function offerBackfill(session: Session, opts: BackfillOptions): Promise<boolean> {
  step(6, 'First suggestion')
  const { client, orgId } = session
  const repos = opts.sourceRepos === 'all' ? 'your repositories' : opts.sourceRepos.join(', ')

  try {
    const preview = await previewBackfill(client, orgId, opts.triggerKey, BACKFILL_REQUEST)
    if (preview.unsupported_reason !== null) {
      note(`A backfill is not available for this trigger: ${preview.unsupported_reason}`)
      return false
    }
    if (preview.count === 0) {
      note(`No pull requests merged in ${repos} in the last ${LOOKBACK_DAYS} days.`)
      return false
    }

    const count = pullRequests(preview.count, preview.approximate)
    if (!opts.skipQuestion) {
      const choice = await selectOne<'skip' | 'run'>({
        message: `Run Promptless on the last ${LOOKBACK_DAYS} days of merged pull requests in ${repos}? (${count})`,
        choices: [
          { value: 'skip', label: 'Not now' },
          { value: 'run', label: `Run on ${count}` },
        ],
      })
      if (choice !== 'run') return false
    }

    const started = await startBackfill(client, orgId, opts.triggerKey, BACKFILL_REQUEST)
    done(`Backfill accepted for ${count} (job ${started.job_id}). Suggestions arrive as pull requests.`)
    return true
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    if (err.code === 'backfill_already_active') {
      note(await describeActiveBackfill(session, opts.triggerKey))
      return true
    }
    warn(`Skipped the backfill: ${apiMessage(err)}`)
    return false
  }
}
