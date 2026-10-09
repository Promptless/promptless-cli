import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ApiError } from '../../lib/api'
import { buildApplyRequest, explainApplyError } from './review'

describe('buildApplyRequest', () => {
  it('maps the docs choice and sources to the apply body with no trigger directories', () => {
    const body = buildApplyRequest(
      { repo: 'acme/docs', framework: 'mintlify', configPath: 'docs/docs.json', filter: ['docs'], existing: false },
      ['acme/api'],
      ['merge'],
      true,
    )
    assert.deepEqual(body, {
      doc_collection: { repo: 'acme/docs', filter: ['docs'], docs_framework: 'mintlify', config_file_path: 'docs/docs.json' },
      trigger: { repos: ['acme/api'], trigger_on: ['merge'], trigger_directories: [] },
      dry_run: true,
    })
  })
})

describe('explainApplyError', () => {
  it('names the missing repositories for repos_not_installed', () => {
    const err = new ApiError(422, 'repos_not_installed', 'failed', {
      error: 'repos_not_installed',
      missing_repos: ['acme/api', 'acme/web'],
    })
    const explained = explainApplyError(err)
    assert.equal(explained?.code, 'repos_not_installed')
    assert.ok(explained?.message.includes('acme/api, acme/web'))
  })

  it('lists each validation path for a promptless.yaml validation failure', () => {
    const err = new ApiError(422, null, 'failed', {
      error: 'Validation failed',
      validation_errors: [
        { message: 'unknown framework', path: 'doc_collections.acme/docs.docs_framework', line: 3 },
        { message: 'bad trigger', path: 'triggers.source-merges', line: null },
      ],
    })
    const explained = explainApplyError(err)
    assert.equal(explained?.code, 'config_invalid')
    assert.ok(explained?.message.includes('doc_collections.acme/docs.docs_framework'))
    assert.ok(explained?.message.includes('triggers.source-merges'))
  })

  it('asks for an admin on 403', () => {
    assert.equal(explainApplyError(new ApiError(403, null, 'failed', { detail: 'Forbidden' }))?.code, 'admin_required')
  })

  it('leaves other errors to the caller', () => {
    assert.equal(explainApplyError(new ApiError(502, 'kb_write_failed', 'failed', { error: 'kb_write_failed' })), null)
    assert.equal(explainApplyError(new Error('network')), null)
  })
})
