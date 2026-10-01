import { execFileSync } from 'node:child_process'

export interface GitHubRepo {
  owner: string
  repo: string
  /** `owner/repo` */
  fullName: string
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const REPO = /^[A-Za-z0-9._-]+$/

function fromPath(path: string): GitHubRepo | null {
  const segments = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
  if (segments.length !== 2) return null
  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/, '')
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null
  return { owner, repo, fullName: `${owner}/${repo}` }
}

/**
 * Parse a git remote URL into a github.com repository. Accepts the SCP-like
 * SSH form (`git@github.com:owner/repo.git`) and URL forms (`https://`,
 * `ssh://`, `git://`, with optional credentials, port, `.git`, and trailing
 * slash). Returns null for any other host, including GitHub Enterprise and SSH
 * host aliases, because their repositories cannot be matched to github.com.
 *
 * Ported in spirit from PostHog's `parseGitRemote` (MIT, github.com/PostHog/wizard
 * src/shared/utils/setup-utils.ts), with the host checked.
 */
export function parseGitHubRemote(remoteUrl: string): GitHubRepo | null {
  const url = remoteUrl.trim()
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(url)
  if (scp && !url.includes('://')) {
    return GITHUB_HOSTS.has(scp[1].toLowerCase()) ? fromPath(scp[2]) : null
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!['https:', 'http:', 'ssh:', 'git:', 'git+ssh:'].includes(parsed.protocol)) return null
  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return null
  if (parsed.search || parsed.hash) return null
  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    // Malformed percent-encoding (URIError): not a repository path we can match.
    return null
  }
  return fromPath(pathname)
}

/** The github.com repository of `origin` in `cwd`, or null when there is none. */
export function readOriginGitHubRepo(cwd: string = process.cwd()): GitHubRepo | null {
  let remoteUrl: string
  try {
    remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    // Not a git repository, no `origin`, or git is not installed.
    return null
  }
  return parseGitHubRemote(remoteUrl)
}
