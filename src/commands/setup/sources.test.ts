import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { defaultSourceRepos } from './sources'

const INSTALLED = [
  { full_name: 'Acme/API', default_branch: 'main' },
  { full_name: 'acme/docs', default_branch: 'main' },
]

describe('defaultSourceRepos', () => {
  it('preselects the installed cwd repository in inventory casing', () => {
    assert.deepEqual(defaultSourceRepos(INSTALLED, 'acme/api', 'acme/docs'), ['Acme/API'])
  })

  it('preselects nothing when the cwd repository is the docs repository', () => {
    assert.deepEqual(defaultSourceRepos(INSTALLED, 'acme/docs', 'Acme/Docs'), [])
  })

  it('preselects nothing without a cwd repository or when it is not installed', () => {
    assert.deepEqual(defaultSourceRepos(INSTALLED, null, 'acme/docs'), [])
    assert.deepEqual(defaultSourceRepos(INSTALLED, 'acme/web', 'acme/docs'), [])
  })
})
