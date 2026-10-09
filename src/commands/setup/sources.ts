import type { GitHubRepo } from '../../lib/git-remote'
import { installedRepos } from '../../lib/setup-api'
import type { InstalledRepo, SetupStatus } from '../../lib/setup-api'
import { selectMany } from '../../lib/ui/prompt'
import { SetupError, answered, done, step } from './output'

// Screen 4: choose the source repositories whose merged pull requests update
// the docs. The list is always explicit, never `all`, so a later GitHub grant
// does not widen the trigger unnoticed.

/** Either the repositories for a trigger setup adds, or an existing trigger setup keeps. */
export type SourceChoice =
  | { kind: 'new'; repos: string[] }
  | { kind: 'existing'; triggerKey: string; repos: string[] | 'all' }

/**
 * The repositories preselected in the prompt: the current directory's
 * repository, in inventory casing, when it is installed and is not the docs repository.
 */
export function defaultSourceRepos(installed: InstalledRepo[], cwdRepo: string | null, docsRepo: string): string[] {
  if (cwdRepo === null || cwdRepo.toLowerCase() === docsRepo.toLowerCase()) return []
  const match = installed.find((repo) => repo.full_name.toLowerCase() === cwdRepo.toLowerCase())
  return match === undefined ? [] : [match.full_name]
}

/**
 * Screen 4: choose the source repositories.
 *
 * @param sourceRepoFlags `--source-repo` values, which skip the prompt.
 * @param docsExisting True when the docs collection already exists; an existing
 *   `github_pr` trigger is then kept and the prompt is skipped.
 */
export async function chooseSourceRepos(
  status: SetupStatus,
  docsRepo: string,
  docsExisting: boolean,
  sourceRepoFlags: string[],
  cwdRepo: GitHubRepo | null,
): Promise<SourceChoice> {
  step(4, 'Choose source repositories')

  if (sourceRepoFlags.length > 0) {
    done(`Update the docs when a pull request merges in: ${sourceRepoFlags.join(', ')}`)
    return { kind: 'new', repos: sourceRepoFlags }
  }

  const existingTrigger = docsExisting
    ? status.triggers.find((trigger) => trigger.trigger_type === 'github_pr' && trigger.repos !== null)
    : undefined
  if (existingTrigger !== undefined && existingTrigger.repos !== null) {
    const repos = existingTrigger.repos
    done(
      `Already watching ${repos === 'all' ? 'every repository the GitHub App can see' : repos.join(', ')} ` +
        `(trigger ${existingTrigger.key}). Pass --source-repo to add more.`,
    )
    return { kind: 'existing', triggerKey: existingTrigger.key, repos }
  }

  const installed = installedRepos(status)
  if (installed.length === 0) {
    throw new SetupError(
      'repos_not_installed',
      'The GitHub App installation lists no repositories. Grant it your source repositories on GitHub, ' +
        'then run `promptless setup` again.',
    )
  }
  const cwd = cwdRepo?.fullName.toLowerCase() ?? null
  const repos = answered(
    await selectMany<string>({
      message: 'Update the docs when a pull request merges in:',
      choices: installed.map((repo) => ({
        value: repo.full_name,
        label: repo.full_name,
        hint: repo.full_name.toLowerCase() === cwd ? 'this directory' : undefined,
      })),
      initial: defaultSourceRepos(installed, cwdRepo?.fullName ?? null, docsRepo),
      required: true,
    }),
  )
  done(`Update the docs when a pull request merges in: ${repos.join(', ')}`)
  return { kind: 'new', repos }
}
