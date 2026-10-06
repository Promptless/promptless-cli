import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseSetupArgs } from './args'
import { SetupError } from './output'

function flags(argv: string[]) {
  const parsed = parseSetupArgs(argv)
  assert.equal(parsed.kind, 'run')
  return parsed.kind === 'run' ? parsed.flags : null
}

function rejects(argv: string[]): void {
  assert.throws(
    () => parseSetupArgs(argv),
    (err) => err instanceof SetupError && err.code === 'bad_arguments',
  )
}

describe('parseSetupArgs', () => {
  it('defaults to merge triggers, an opened browser, and no overrides', () => {
    assert.deepEqual(flags([]), {
      org: null,
      docsRepo: null,
      sourceRepos: [],
      triggerOn: ['merge'],
      newAccount: false,
      openBrowser: true,
      backfill: false,
    })
  })

  it('reads every flag in both value forms and repeats --source-repo', () => {
    assert.deepEqual(
      flags([
        '--org=org_1',
        '--docs-repo',
        'acme/docs',
        '--source-repo',
        'acme/api',
        '--source-repo=acme/web',
        '--trigger-on',
        'opened,merge',
        '--trigger-on=merge',
        '--new-account',
        '--no-browser',
        '--backfill',
      ]),
      {
        org: 'org_1',
        docsRepo: 'acme/docs',
        sourceRepos: ['acme/api', 'acme/web'],
        triggerOn: ['opened', 'merge'],
        newAccount: true,
        openBrowser: false,
        backfill: true,
      },
    )
  })

  it('returns help for -h and --help', () => {
    assert.deepEqual(parseSetupArgs(['--org', 'x', '-h']), { kind: 'help' })
    assert.deepEqual(parseSetupArgs(['--help']), { kind: 'help' })
  })

  it('rejects unknown flags, missing values, bad repositories, and bad events', () => {
    rejects(['--ci'])
    rejects(['--org'])
    rejects(['--org', '--backfill'])
    rejects(['--docs-repo='])
    rejects(['--docs-repo', 'not-a-repo'])
    rejects(['--source-repo', 'https://github.com/acme/api'])
    rejects(['--trigger-on', 'closed'])
  })
})
