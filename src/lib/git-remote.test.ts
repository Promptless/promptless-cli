import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'

import { parseGitHubRemote, readOriginGitHubRepo } from './git-remote'

const acmeApi = { owner: 'acme', repo: 'api', fullName: 'acme/api' }

describe('parseGitHubRemote', () => {
  for (const url of [
    'git@github.com:acme/api.git',
    'git@github.com:acme/api',
    'ssh://git@github.com/acme/api.git',
    'ssh://git@github.com:22/acme/api.git',
    'https://github.com/acme/api.git',
    'https://github.com/acme/api',
    'https://github.com/acme/api/',
    'https://x-access-token:secret@github.com/acme/api.git',
    'https://GitHub.com/acme/api.git',
    'git://github.com/acme/api.git',
    '  https://github.com/acme/api.git\n',
  ]) {
    it(`parses ${JSON.stringify(url)}`, () => {
      assert.deepEqual(parseGitHubRemote(url), acmeApi)
    })
  }

  it('keeps dots and dashes in repository names', () => {
    assert.deepEqual(parseGitHubRemote('git@github.com:acme-corp/docs.site.git'), {
      owner: 'acme-corp',
      repo: 'docs.site',
      fullName: 'acme-corp/docs.site',
    })
  })

  for (const url of [
    '',
    'git@gitlab.com:acme/api.git',
    'https://gitlab.com/acme/api.git',
    'https://github.example.com/acme/api.git',
    'git@github.com-work:acme/api.git',
    'https://github.com/acme',
    'https://github.com/acme/api/tree/main',
    '/srv/git/api.git',
    'file:///srv/git/api.git',
  ]) {
    it(`returns null for ${JSON.stringify(url)}`, () => {
      assert.equal(parseGitHubRemote(url), null)
    })
  }
})

describe('readOriginGitHubRepo', () => {
  it('returns null outside a git repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'promptless-git-remote-'))
    try {
      assert.equal(readOriginGitHubRepo(dir), null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a repository without origin, and parses origin once added', () => {
    const dir = mkdtempSync(join(tmpdir(), 'promptless-git-remote-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      assert.equal(readOriginGitHubRepo(dir), null)
      execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/api.git'], { cwd: dir })
      assert.deepEqual(readOriginGitHubRepo(dir), acmeApi)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
