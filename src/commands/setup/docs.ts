import type { GitHubRepo } from '../../lib/git-remote'
import { installedRepos, postDocsCandidates } from '../../lib/setup-api'
import type { DocsCandidate, SetupDocCollection, SetupStatus } from '../../lib/setup-api'
import { selectOne } from '../../lib/ui/prompt'
import type { Choice } from '../../lib/ui/prompt'
import { SetupError, answered, done, note, step, warn } from './output'
import type { Session } from './login'

// Screen 3: find the documentation repository. An existing doc collection is
// kept; otherwise the runtime ranks the installed repositories and the top
// candidate is preselected.

export interface DocsChoice {
  repo: string
  framework: string | null
  configPath: string | null
  filter: string[]
  /** True when the organization already has this doc collection. */
  existing: boolean
}

const OTHER_REPO = Symbol('other repository')

function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** A one-line summary of what the analysis found, for example `mintlify, docs/docs.json, 214 pages`. */
export function describeCandidate(candidate: DocsCandidate): string {
  const parts = [candidate.framework ?? 'no docs framework config']
  if (candidate.config_path !== null) parts.push(candidate.config_path)
  parts.push(`${candidate.doc_count} ${candidate.doc_count === 1 ? 'page' : 'pages'}`)
  return parts.join(', ')
}

function fromCandidate(candidate: DocsCandidate): DocsChoice {
  return {
    repo: candidate.full_name,
    framework: candidate.framework,
    configPath: candidate.config_path,
    filter: candidate.proposed_filter,
    existing: false,
  }
}

function fromCollection(collection: SetupDocCollection): DocsChoice {
  return {
    repo: collection.repo,
    framework: collection.docs_framework,
    configPath: collection.config_file_path,
    filter: collection.filter,
    existing: true,
  }
}

function bareChoice(repo: string): DocsChoice {
  return { repo, framework: null, configPath: null, filter: [], existing: false }
}

async function pickInstalledRepo(status: SetupStatus): Promise<DocsChoice> {
  const repos = installedRepos(status)
  if (repos.length === 0) {
    throw new SetupError(
      'repos_not_installed',
      'The GitHub App installation lists no repositories. Grant it your docs repository on GitHub, ' +
        'then run `promptless setup` again.',
    )
  }
  const repo = answered(
    await selectOne<string>({
      message: 'Which repository holds your documentation?',
      choices: repos.map((r) => ({ value: r.full_name, label: r.full_name })),
    }),
  )
  return bareChoice(repo)
}

async function useExistingCollection(status: SetupStatus): Promise<DocsChoice> {
  const collections = status.doc_collections
  const repo =
    collections.length === 1
      ? collections[0].repo
      : answered(
          await selectOne<string>({
            message: 'Which documentation repository should setup use?',
            choices: collections.map((c) => ({ value: c.repo, label: c.repo, hint: c.docs_framework ?? undefined })),
          }),
        )
  return fromCollection(collections.find((c) => c.repo === repo) ?? collections[0])
}

function summarize(choice: DocsChoice): string {
  const details = [choice.framework, choice.configPath].filter((part): part is string => part !== null)
  if (choice.filter.length > 0) details.push(`filter: ${choice.filter.join(', ')}`)
  const suffix = choice.existing ? ' (already set up)' : ''
  return details.length > 0
    ? `Documentation: ${choice.repo} (${details.join(', ')})${suffix}`
    : `Documentation: ${choice.repo}${suffix}`
}

/**
 * Screen 3: choose the documentation repository.
 *
 * @param docsRepoFlag `--docs-repo`, which skips the prompt.
 * @param cwdRepo The github.com `origin` of the current directory, if any.
 */
export async function findDocsRepo(
  session: Session,
  status: SetupStatus,
  docsRepoFlag: string | null,
  cwdRepo: GitHubRepo | null,
): Promise<DocsChoice> {
  step(3, 'Find your documentation')

  const flagged =
    docsRepoFlag === null ? undefined : status.doc_collections.find((c) => sameRepo(c.repo, docsRepoFlag))
  if (flagged !== undefined) {
    const choice = fromCollection(flagged)
    done(summarize(choice))
    return choice
  }
  if (docsRepoFlag === null && status.doc_collections.length > 0) {
    const choice = await useExistingCollection(status)
    done(summarize(choice))
    return choice
  }

  note(
    cwdRepo === null
      ? 'This directory has no github.com remote named origin.'
      : `This directory is ${cwdRepo.fullName} (git remote origin).`,
  )
  const response = await postDocsCandidates(session.client, session.orgId, cwdRepo?.fullName ?? null)
  if (cwdRepo !== null && !response.cwd_repo_installed) {
    warn(`The GitHub App cannot see ${cwdRepo.fullName}. Grant it on GitHub if its merges should update the docs.`)
  }
  const candidates = response.candidates

  let choice: DocsChoice
  if (docsRepoFlag !== null) {
    const candidate = candidates.find((c) => sameRepo(c.full_name, docsRepoFlag))
    choice = candidate !== undefined ? fromCandidate(candidate) : bareChoice(docsRepoFlag)
  } else if (candidates.length === 0) {
    note('No installed repository looks like documentation.')
    choice = await pickInstalledRepo(status)
  } else {
    const top = candidates[0]
    note(`${top.full_name} looks like your documentation: ${describeCandidate(top)}.`)
    const choices: Choice<string | typeof OTHER_REPO>[] = candidates.map((c) => ({
      value: c.full_name,
      label: `Use ${c.full_name}`,
      hint: describeCandidate(c),
    }))
    choices.push({ value: OTHER_REPO, label: 'Pick a different repository' })
    const picked = answered(
      await selectOne<string | typeof OTHER_REPO>({
        message: 'Which repository holds your documentation?',
        choices,
        initial: top.full_name,
      }),
    )
    const candidate = candidates.find((c) => c.full_name === picked)
    choice = candidate !== undefined ? fromCandidate(candidate) : await pickInstalledRepo(status)
  }

  done(summarize(choice))
  return choice
}
