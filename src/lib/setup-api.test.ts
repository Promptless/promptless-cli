import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import { ApiError } from './api'
import {
  GITHUB_CONNECTED_RETURN_PATH,
  beginGitHubInstall,
  completeOnboarding,
  configValidationIssues,
  getBackfillStatus,
  getSetupStatus,
  installedRepos,
  postApply,
  postDocsCandidates,
  previewBackfill,
  pullGitHubInstallations,
  reposNotInstalled,
  startBackfill,
} from './setup-api'
import type { ApplyRequest, SetupClient, SetupStatus } from './setup-api'

// Contract tests: each call against a local fake runtime that records the
// request and answers with the shapes the runtime routes document.

interface Recorded {
  method: string
  path: string
  authorization: string | undefined
  body: unknown
}

interface Reply {
  status: number
  body: unknown
}

const ORG = 'org_abc'

const STATUS: SetupStatus = {
  onboarding_completed: false,
  billing: { status: 'trialing', trial_end: '2026-10-15T00:00:00+00:00' },
  github: {
    connected: true,
    installations: [
      {
        owner: 'acme',
        repository_selection: 'selected',
        repos: [
          { full_name: 'acme/docs', default_branch: 'main' },
          { full_name: 'acme/api', default_branch: 'main' },
        ],
      },
      { owner: 'acme-labs', repository_selection: 'all', repos: [{ full_name: 'Acme/Docs', default_branch: 'main' }] },
    ],
    pending_approval: [{ github_org_login: 'other', requested_at: '2026-10-01T12:00:00+00:00' }],
  },
  doc_collections: [
    { repo: 'acme/docs', platform: 'github', docs_framework: 'mintlify', config_file_path: 'docs.json', filter: [] },
  ],
  triggers: [{ key: 'source-merges', trigger_type: 'github_pr', repos: ['acme/api'] }],
}

const APPLY_BODY: ApplyRequest = {
  doc_collection: { repo: 'acme/docs', filter: ['docs'], docs_framework: 'mintlify', config_file_path: 'docs/docs.json' },
  trigger: { repos: ['acme/api'], trigger_on: ['merge'], trigger_directories: [] },
  dry_run: true,
}

describe('setup API contract', () => {
  let server: Server
  let client: SetupClient
  let recorded: Recorded[] = []
  let replies: Record<string, Reply> = {}

  before(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
      req.on('end', () => {
        const key = `${req.method} ${req.url}`
        recorded.push({
          method: req.method ?? '',
          path: req.url ?? '',
          authorization: req.headers.authorization,
          body: raw.length > 0 ? JSON.parse(raw) : undefined,
        })
        const reply = replies[key] ?? { status: 404, body: { error: 'not_found' } }
        res.writeHead(reply.status, { 'Content-Type': 'application/json' })
        res.end(reply.body === undefined ? '' : JSON.stringify(reply.body))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    client = { apiSecret: 'sk-pl-test', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
  })

  after(() => {
    server.closeAllConnections()
    server.close()
  })

  beforeEach(() => {
    recorded = []
    replies = {}
  })

  function only(): Recorded {
    assert.equal(recorded.length, 1)
    return recorded[0]
  }

  it('reads setup status with the bearer key', async () => {
    replies[`GET /organizations/${ORG}/setup/status`] = { status: 200, body: STATUS }
    assert.deepEqual(await getSetupStatus(client, ORG), STATUS)
    assert.equal(only().authorization, 'Bearer sk-pl-test')
  })

  it('encodes the organization id in the path', async () => {
    replies['GET /organizations/org%2Fodd/setup/status'] = { status: 200, body: STATUS }
    await getSetupStatus(client, 'org/odd')
    assert.equal(only().path, '/organizations/org%2Fodd/setup/status')
  })

  it('sends cwd_repo to docs-candidates, including null', async () => {
    const body = {
      cwd_repo_installed: true,
      candidates: [
        {
          full_name: 'acme/docs',
          default_branch: 'main',
          framework: 'mintlify',
          config_path: 'docs/docs.json',
          doc_count: 214,
          proposed_filter: ['docs'],
          reason: 'name_match',
        },
      ],
      analysis_failures: [{ full_name: 'acme/empty', status_code: 409 }],
    }
    replies[`POST /organizations/${ORG}/setup/docs-candidates`] = { status: 200, body }

    assert.deepEqual(await postDocsCandidates(client, ORG, 'acme/api'), body)
    assert.deepEqual(only().body, { cwd_repo: 'acme/api' })

    recorded = []
    await postDocsCandidates(client, ORG, null)
    assert.deepEqual(only().body, { cwd_repo: null })
  })

  it('surfaces 409 github_not_connected from docs-candidates', async () => {
    replies[`POST /organizations/${ORG}/setup/docs-candidates`] = {
      status: 409,
      body: { error: 'github_not_connected' },
    }
    await assert.rejects(postDocsCandidates(client, ORG, null), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'github_not_connected')
      return true
    })
  })

  it('posts the apply body and returns the result', async () => {
    const body = {
      dry_run: true,
      changed: true,
      yaml: 'doc_collections:\n  acme/docs: {}\n',
      kb_commit_sha: null,
      doc_collection: { key: 'acme/docs', added: true },
      trigger: { key: 'source-merges', added: true },
    }
    replies[`POST /organizations/${ORG}/setup/apply`] = { status: 200, body }
    assert.deepEqual(await postApply(client, ORG, APPLY_BODY), body)
    assert.deepEqual(only().body, APPLY_BODY)
  })

  it('reads 422 repos_not_installed from apply', async () => {
    replies[`POST /organizations/${ORG}/setup/apply`] = {
      status: 422,
      body: { error: 'repos_not_installed', missing_repos: ['acme/api', 'acme/web'] },
    }
    const err = await postApply(client, ORG, APPLY_BODY).catch((caught: unknown) => caught)
    assert.deepEqual(reposNotInstalled(err), ['acme/api', 'acme/web'])
    assert.equal(configValidationIssues(err), null)
  })

  it('reads 422 promptless.yaml validation errors from apply', async () => {
    replies[`POST /organizations/${ORG}/setup/apply`] = {
      status: 422,
      body: {
        error: 'Validation failed',
        validation_errors: [
          { message: 'unknown framework', path: 'doc_collections.acme/docs.docs_framework', line: 3 },
          { message: 'whole config is invalid', path: null, line: null },
        ],
      },
    }
    const err = await postApply(client, ORG, APPLY_BODY).catch((caught: unknown) => caught)
    assert.equal(reposNotInstalled(err), null)
    assert.deepEqual(configValidationIssues(err), [
      { message: 'unknown framework', path: 'doc_collections.acme/docs.docs_framework', line: 3 },
      { message: 'whole config is invalid', path: null, line: null },
    ])
  })

  it('reads 422 request-schema errors from apply', async () => {
    replies[`POST /organizations/${ORG}/setup/apply`] = {
      status: 422,
      body: { detail: [{ loc: ['body', 'trigger', 'repos'], msg: 'List should have at least 1 item', type: 'too_short' }] },
    }
    const err = await postApply(client, ORG, APPLY_BODY).catch((caught: unknown) => caught)
    assert.deepEqual(configValidationIssues(err), [
      { message: 'List should have at least 1 item', path: 'body.trigger.repos', line: null },
    ])
  })

  it('surfaces 409 write_in_progress from apply as an ApiError', async () => {
    replies[`POST /organizations/${ORG}/setup/apply`] = { status: 409, body: { error: 'write_in_progress' } }
    const err = await postApply(client, ORG, APPLY_BODY).catch((caught: unknown) => caught)
    assert.ok(err instanceof ApiError)
    assert.equal(err.code, 'write_in_progress')
    assert.equal(reposNotInstalled(err), null)
    assert.equal(configValidationIssues(err), null)
  })

  it('begins a GitHub install with the CLI return page', async () => {
    replies['POST /integrations/github/begin'] = {
      status: 200,
      body: { redirect_url: 'https://github.com/apps/promptless/installations/new?state=s' },
    }
    assert.equal(
      await beginGitHubInstall(client, ORG),
      'https://github.com/apps/promptless/installations/new?state=s',
    )
    assert.deepEqual(only().body, { org_id: ORG, return_to: GITHUB_CONNECTED_RETURN_PATH })
  })

  it('refreshes GitHub installations', async () => {
    replies['POST /integrations/github/pull'] = { status: 200, body: { installations: [] } }
    await pullGitHubInstallations(client, ORG)
    assert.deepEqual(only().body, { org_id: ORG })
  })

  it('completes onboarding with an empty body', async () => {
    replies[`POST /organizations/${ORG}/onboarding/complete`] = { status: 200, body: { status: 'ok' } }
    assert.deepEqual(await completeOnboarding(client, ORG), { status: 'ok' })
    assert.equal(only().body, undefined)
  })

  it('surfaces 409 doc_collection_required from onboarding completion', async () => {
    replies[`POST /organizations/${ORG}/onboarding/complete`] = {
      status: 409,
      body: { error: 'doc_collection_required', message: 'Connect at least one docs repository.' },
    }
    await assert.rejects(completeOnboarding(client, ORG), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'doc_collection_required')
      return true
    })
  })

  it('previews, starts, and reads a backfill with the trigger key encoded', async () => {
    const base = `/organizations/${ORG}/promptless_config/triggers/source-merges%202`
    const preview = {
      count: 2,
      approximate: false,
      unsupported_reason: null,
      prs: [
        {
          repo: 'acme/api',
          number: 7,
          title: 'Add a flag',
          url: 'https://github.com/acme/api/pull/7',
          created_at: '2026-09-28T00:00:00+00:00',
          merged_at: '2026-09-29T00:00:00+00:00',
          status: 'merged',
        },
      ],
    }
    const status = {
      latest_job: {
        id: 'job-1',
        state: 'dispatching',
        lookback_days: 7,
        requested_by: 'dev@acme.com',
        matched_count: 2,
        dispatched_count: 1,
        processed_count: 0,
        failed_dispatch_count: 0,
        error: null,
        created_at: '2026-10-01T00:00:00+00:00',
        dispatch_active: true,
      },
      suggestion_activity: { total_count: 0, has_more: false, suggestions: [] },
    }
    replies[`POST ${base}/backfill-preview`] = { status: 200, body: preview }
    replies[`POST ${base}/backfill`] = { status: 202, body: { accepted: true, matched: null, job_id: 'job-1' } }
    replies[`GET ${base}/backfill-status`] = { status: 200, body: status }

    const request = { lookback_days: 7, skip_processed: true } as const
    assert.deepEqual(await previewBackfill(client, ORG, 'source-merges 2', request), preview)
    assert.deepEqual(await startBackfill(client, ORG, 'source-merges 2', request), {
      accepted: true,
      matched: null,
      job_id: 'job-1',
    })
    assert.deepEqual(await getBackfillStatus(client, ORG, 'source-merges 2'), status)
    assert.deepEqual(
      recorded.map((r) => [r.method, r.path, r.body]),
      [
        ['POST', `${base}/backfill-preview`, request],
        ['POST', `${base}/backfill`, request],
        ['GET', `${base}/backfill-status`, undefined],
      ],
    )
  })

  it('surfaces 409 backfill_already_active and 402 trial_expired from a backfill start', async () => {
    const path = `/organizations/${ORG}/promptless_config/triggers/source-merges/backfill`
    const request = { lookback_days: 7, skip_processed: true } as const

    replies[`POST ${path}`] = { status: 409, body: { error: 'backfill_already_active' } }
    await assert.rejects(startBackfill(client, ORG, 'source-merges', request), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'backfill_already_active')
      return true
    })

    replies[`POST ${path}`] = { status: 402, body: { error: 'trial_expired', message: 'Trial ended 15 Oct.' } }
    await assert.rejects(startBackfill(client, ORG, 'source-merges', request), (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 402)
      assert.equal(err.code, 'trial_expired')
      return true
    })
  })

  it('reads an empty backfill status', async () => {
    replies[`GET /organizations/${ORG}/promptless_config/triggers/source-merges/backfill-status`] = {
      status: 200,
      body: { latest_job: null, suggestion_activity: null },
    }
    assert.deepEqual(await getBackfillStatus(client, ORG, 'source-merges'), {
      latest_job: null,
      suggestion_activity: null,
    })
  })
})

describe('installedRepos', () => {
  it('flattens installations and drops case-insensitive duplicates', () => {
    assert.deepEqual(
      installedRepos(STATUS).map((repo) => repo.full_name),
      ['acme/docs', 'acme/api'],
    )
  })
})
