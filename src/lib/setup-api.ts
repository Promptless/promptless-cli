// Typed calls for `promptless setup`. Every request and response shape the
// setup command depends on lives here, so a runtime contract change touches
// one file. The contracts are documented in the runtime repository:
//   runtime/onboarding/setup/README.md    setup/status, setup/docs-candidates, setup/apply
//   runtime/cli/README.md                 GitHub begin/pull, onboarding/complete, backfill routes

import { ApiError, request } from './api'

/** The base URL and key every setup call sends. */
export interface SetupClient {
  apiSecret: string
  /** Defaults to `API_BASE_URL`. */
  baseUrl?: string
}

export type PrLifecycleEvent = 'opened' | 'first_approval' | 'merge' | 'updated'

export const PR_LIFECYCLE_EVENTS: readonly PrLifecycleEvent[] = ['opened', 'first_approval', 'merge', 'updated']

export interface BillingStatus {
  status: 'pending' | 'trialing' | 'active' | 'exempt'
  /** ISO 8601 timestamp, or null when no trial was started. */
  trial_end: string | null
}

export interface InstalledRepo {
  full_name: string
  default_branch: string | null
}

export interface GitHubInstallation {
  owner: string | null
  repository_selection: 'all' | 'selected' | null
  repos: InstalledRepo[]
}

export interface PendingApproval {
  github_org_login: string
  requested_at: string
}

export interface SetupDocCollection {
  repo: string
  platform: string
  docs_framework: string | null
  config_file_path: string | null
  filter: string[]
}

export interface SetupTrigger {
  key: string
  trigger_type: string
  /** `"all"`, the repositories its clauses name, or null for a trigger type that names none. */
  repos: 'all' | string[] | null
}

/** `GET /organizations/{org}/setup/status`. */
export interface SetupStatus {
  onboarding_completed: boolean
  /** Null when the organization has no commerce row. */
  billing: BillingStatus | null
  github: {
    connected: boolean
    installations: GitHubInstallation[]
    pending_approval: PendingApproval[]
  }
  doc_collections: SetupDocCollection[]
  triggers: SetupTrigger[]
}

export type CandidateReason = 'cwd_repo' | 'only_installed_repo' | 'name_match' | 'markdown_count'

export interface DocsCandidate {
  full_name: string
  default_branch: string | null
  framework: string | null
  config_path: string | null
  doc_count: number
  /** The directory that holds the framework config; empty when it is the root or none was found. */
  proposed_filter: string[]
  reason: CandidateReason
}

/** `POST /organizations/{org}/setup/docs-candidates`. Candidates are in rank order. */
export interface DocsCandidatesResponse {
  cwd_repo_installed: boolean
  candidates: DocsCandidate[]
  analysis_failures: Array<{ full_name: string; status_code: number }>
}

export interface ApplyRequest {
  doc_collection: {
    repo: string
    filter: string[]
    docs_framework: string | null
    config_file_path: string | null
  }
  trigger: {
    repos: string[]
    trigger_on: PrLifecycleEvent[]
    trigger_directories: string[]
  }
  dry_run: boolean
}

/** `POST /organizations/{org}/setup/apply`. */
export interface ApplyResponse {
  dry_run: boolean
  /** False when the config already holds the collection and an equivalent trigger. */
  changed: boolean
  yaml: string
  /** Null for a dry run and for an apply that changed nothing. */
  kb_commit_sha: string | null
  doc_collection: { key: string; added: boolean }
  trigger: { key: string; added: boolean }
}

/** One `promptless.yaml` validation failure from a 422. */
export interface ConfigValidationIssue {
  message: string
  path: string | null
  line: number | null
}

/** `POST /organizations/{org}/onboarding/complete`. The trial it starts is read back from `setup/status`. */
export interface OnboardingCompleteResponse {
  status: 'ok'
}

export type BackfillLookbackDays = 7 | 14 | 30

export interface BackfillRequest {
  lookback_days: BackfillLookbackDays
  skip_processed: boolean
}

export interface BackfillPreviewPullRequest {
  repo: string
  number: number
  title: string
  url: string
  created_at: string
  merged_at: string | null
  status: string
}

/** `POST .../triggers/{key}/backfill-preview`. */
export interface BackfillPreview {
  count: number
  approximate: boolean
  /** Set, with `count` 0, when the trigger cannot be replayed as pull request history. */
  unsupported_reason: string | null
  prs: BackfillPreviewPullRequest[]
}

/** `POST .../triggers/{key}/backfill` (202). */
export interface BackfillStarted {
  accepted: boolean
  matched: number | null
  job_id: string
}

export interface BackfillJob {
  id: string
  state: string
  lookback_days: number
  requested_by: string | null
  matched_count: number | null
  dispatched_count: number
  processed_count: number
  failed_dispatch_count: number
  error: string | null
  created_at: string
  dispatch_active: boolean
}

/** `GET .../triggers/{key}/backfill-status`. */
export interface BackfillStatus {
  latest_job: BackfillJob | null
  suggestion_activity: {
    total_count: number
    has_more: boolean
    suggestions: Array<{
      id: string
      title: string
      pr_status: string | null
      created_at: string
      created_by_backfill: boolean
    }>
  } | null
}

/** The return page the GitHub install callback sends the browser to. */
export const GITHUB_CONNECTED_RETURN_PATH = '/cli/setup/github-connected'

function orgPath(orgId: string): string {
  return `/organizations/${encodeURIComponent(orgId)}`
}

function triggerPath(orgId: string, triggerKey: string): string {
  return `${orgPath(orgId)}/promptless_config/triggers/${encodeURIComponent(triggerKey)}`
}

export async function getSetupStatus(client: SetupClient, orgId: string): Promise<SetupStatus> {
  try {
    return await request<SetupStatus>('GET', `${orgPath(orgId)}/setup/status`, client)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && recordOf(err.body)?.detail === 'Not Found') {
      throw new ApiError(
        err.status,
        'setup_unavailable',
        'This Promptless server does not provide CLI setup yet. ' +
          'The setup backend must be deployed before this command can continue. ' +
          'You can use the dashboard to finish onboarding.',
        err.body,
      )
    }
    throw err
  }
}

export function postDocsCandidates(
  client: SetupClient,
  orgId: string,
  cwdRepo: string | null,
): Promise<DocsCandidatesResponse> {
  return request<DocsCandidatesResponse>('POST', `${orgPath(orgId)}/setup/docs-candidates`, {
    ...client,
    body: { cwd_repo: cwdRepo },
  })
}

export function postApply(client: SetupClient, orgId: string, body: ApplyRequest): Promise<ApplyResponse> {
  return request<ApplyResponse>('POST', `${orgPath(orgId)}/setup/apply`, { ...client, body })
}

/** Start a GitHub App install and return the URL to open. */
export async function beginGitHubInstall(client: SetupClient, orgId: string): Promise<string> {
  const response = await request<{ redirect_url: string }>('POST', '/integrations/github/begin', {
    ...client,
    body: { org_id: orgId, return_to: GITHUB_CONNECTED_RETURN_PATH },
  })
  return response.redirect_url
}

/** Ask the runtime to re-read the organization's GitHub installations from GitHub. */
export async function pullGitHubInstallations(client: SetupClient, orgId: string): Promise<void> {
  await request<unknown>('POST', '/integrations/github/pull', { ...client, body: { org_id: orgId } })
}

export function completeOnboarding(client: SetupClient, orgId: string): Promise<OnboardingCompleteResponse> {
  return request<OnboardingCompleteResponse>('POST', `${orgPath(orgId)}/onboarding/complete`, client)
}

export function previewBackfill(
  client: SetupClient,
  orgId: string,
  triggerKey: string,
  body: BackfillRequest,
): Promise<BackfillPreview> {
  return request<BackfillPreview>('POST', `${triggerPath(orgId, triggerKey)}/backfill-preview`, { ...client, body })
}

export function startBackfill(
  client: SetupClient,
  orgId: string,
  triggerKey: string,
  body: BackfillRequest,
): Promise<BackfillStarted> {
  return request<BackfillStarted>('POST', `${triggerPath(orgId, triggerKey)}/backfill`, { ...client, body })
}

export function getBackfillStatus(client: SetupClient, orgId: string, triggerKey: string): Promise<BackfillStatus> {
  return request<BackfillStatus>('GET', `${triggerPath(orgId, triggerKey)}/backfill-status`, client)
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The repositories a 422 `repos_not_installed` from `apply` names, or null for any other error. */
export function reposNotInstalled(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 422 || err.code !== 'repos_not_installed') return null
  const missing = recordOf(err.body)?.missing_repos
  return Array.isArray(missing) ? missing.filter((repo): repo is string => typeof repo === 'string') : []
}

/**
 * The validation failures a 422 from `apply` carries, or null for any other error.
 * Reads both the `promptless.yaml` shape (`validation_errors[{message, path, line}]`)
 * and the FastAPI request-schema shape (`detail[{loc, msg}]`).
 */
export function configValidationIssues(err: unknown): ConfigValidationIssue[] | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null
  const body = recordOf(err.body)
  if (body === null) return null

  if (Array.isArray(body.validation_errors)) {
    return body.validation_errors.flatMap((item) => {
      const issue = recordOf(item)
      if (issue === null || typeof issue.message !== 'string') return []
      return [
        {
          message: issue.message,
          path: typeof issue.path === 'string' && issue.path.length > 0 ? issue.path : null,
          line: typeof issue.line === 'number' ? issue.line : null,
        },
      ]
    })
  }
  if (Array.isArray(body.detail)) {
    return body.detail.flatMap((item) => {
      const issue = recordOf(item)
      if (issue === null || typeof issue.msg !== 'string') return []
      const loc = Array.isArray(issue.loc) ? issue.loc.map(String) : []
      return [{ message: issue.msg, path: loc.length > 0 ? loc.join('.') : null, line: null }]
    })
  }
  return null
}

/** Every repository across the organization's installations, without duplicates, in inventory order. */
export function installedRepos(status: SetupStatus): InstalledRepo[] {
  const seen = new Map<string, InstalledRepo>()
  for (const installation of status.github.installations) {
    for (const repo of installation.repos) {
      const key = repo.full_name.toLowerCase()
      if (!seen.has(key)) seen.set(key, repo)
    }
  }
  return [...seen.values()]
}
