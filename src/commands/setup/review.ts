import { ApiError } from '../../lib/api'
import { configValidationIssues, postApply, reposNotInstalled } from '../../lib/setup-api'
import type { ApplyRequest, ApplyResponse, PrLifecycleEvent } from '../../lib/setup-api'
import { selectOne } from '../../lib/ui/prompt'
import type { DocsChoice } from './docs'
import type { Session } from './login'
import { SetupError, answered, done, note, step } from './output'

// Screen 5: preview the promptless.yaml change with a dry run, confirm it
// (Cancel listed first), and apply it. The runtime writes the file in the
// organization's knowledge-base repository; nothing is written locally.

export function buildApplyRequest(
  docs: DocsChoice,
  sourceRepos: string[],
  triggerOn: PrLifecycleEvent[],
  dryRun: boolean,
): ApplyRequest {
  return {
    doc_collection: {
      repo: docs.repo,
      filter: docs.filter,
      docs_framework: docs.framework,
      config_file_path: docs.configPath,
    },
    trigger: { repos: sourceRepos, trigger_on: triggerOn, trigger_directories: [] },
    dry_run: dryRun,
  }
}

/**
 * Translate an `apply` failure the user can act on into the error that ends
 * setup, or return null for any other error.
 */
export function explainApplyError(err: unknown): SetupError | null {
  const missing = reposNotInstalled(err)
  if (missing !== null) {
    const repos = missing.join(', ')
    return new SetupError(
      'repos_not_installed',
      `The Promptless GitHub App cannot see ${repos}. Grant it access on GitHub, ` +
        'then run `promptless setup` again.',
    )
  }

  const issues = configValidationIssues(err)
  if (issues !== null) {
    const lines = issues.map((issue) => {
      const where = issue.path === null ? '' : `${issue.path}: `
      const line = issue.line === null ? '' : ` (line ${issue.line})`
      return `  ${where}${issue.message}${line}`
    })
    return new SetupError('config_invalid', ['promptless.yaml would not be valid:', ...lines].join('\n'))
  }

  if (err instanceof ApiError && err.status === 403) {
    return new SetupError(
      'admin_required',
      'Changing promptless.yaml needs an organization admin. Ask an admin to run `promptless setup`.',
    )
  }
  if (err instanceof ApiError && err.code === 'write_in_progress') {
    return new SetupError(
      'api_error',
      'Another change to promptless.yaml is in progress. Run `promptless setup` again in a minute.',
    )
  }
  return null
}

async function apply(session: Session, body: ApplyRequest): Promise<ApplyResponse> {
  try {
    return await postApply(session.client, session.orgId, body)
  } catch (err) {
    throw explainApplyError(err) ?? err
  }
}

function indent(text: string): string {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

/**
 * Screen 5: review and apply the doc collection and trigger.
 *
 * @throws SetupError when the user cancels or the runtime rejects the change.
 */
export async function reviewAndApply(
  session: Session,
  docs: DocsChoice,
  sourceRepos: string[],
  triggerOn: PrLifecycleEvent[],
): Promise<ApplyResponse> {
  step(5, 'Review')

  const preview = await apply(session, buildApplyRequest(docs, sourceRepos, triggerOn, true))
  if (!preview.changed) {
    done('promptless.yaml already has this collection and trigger. Nothing to change.')
    return preview
  }

  note('promptless.yaml after this change:')
  process.stderr.write(`${indent(preview.yaml)}\n`)
  const choice = answered(
    await selectOne<'cancel' | 'apply'>({
      message: 'Apply this change?',
      choices: [
        { value: 'cancel', label: 'Cancel' },
        { value: 'apply', label: 'Apply' },
      ],
    }),
  )
  if (choice === 'cancel') {
    throw new SetupError('cancelled', 'Nothing was changed. Run `promptless setup` again when you are ready.')
  }

  const result = await apply(session, buildApplyRequest(docs, sourceRepos, triggerOn, false))
  done(
    result.kb_commit_sha === null
      ? 'Saved promptless.yaml'
      : `Saved promptless.yaml (commit ${result.kb_commit_sha.slice(0, 7)})`,
  )
  return result
}
