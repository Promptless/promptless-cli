import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildExitBlock, formatTrialEnd, renderExitBlock } from './exit'
import type { ExitBlockInput } from './exit'

const APP = 'https://app.example.test'
const API = 'https://api.example.test'

const BASE: ExitBlockInput = {
  appBaseUrl: APP,
  apiBaseUrl: API,
  docsRepo: 'acme/docs',
  sourceRepos: ['acme/api', 'acme/web'],
  billing: null,
  backfillTriggerKey: null,
}

function kinds(input: ExitBlockInput): string[] {
  return buildExitBlock(input).map((line) => line.kind)
}

function lineOf(input: ExitBlockInput, kind: string): string {
  const line = buildExitBlock(input).find((l) => l.kind === kind)
  assert.ok(line, `no ${kind} line`)
  return line.text
}

describe('buildExitBlock', () => {
  it('has a headline, the dashboard link, and next steps without a trial or backfill', () => {
    assert.deepEqual(kinds(BASE), ['headline', 'dashboard', 'next_steps', 'next_step', 'next_step', 'next_step'])
    assert.ok(lineOf(BASE, 'dashboard').endsWith(`${APP}/configuration`))
  })

  it('adds the trial line while trialing', () => {
    const input: ExitBlockInput = { ...BASE, billing: { status: 'trialing', trial_end: '2026-10-15T00:00:00+00:00' } }
    assert.deepEqual(kinds(input).slice(0, 3), ['headline', 'dashboard', 'trial'])
    const trial = lineOf(input, 'trial')
    assert.ok(trial.includes(formatTrialEnd('2026-10-15T00:00:00+00:00')))
    assert.ok(trial.endsWith(`${APP}/settings/billing`))
  })

  it('omits the trial line for every other billing state', () => {
    for (const status of ['pending', 'active', 'exempt'] as const) {
      const input: ExitBlockInput = { ...BASE, billing: { status, trial_end: '2026-10-15T00:00:00+00:00' } }
      assert.equal(kinds(input).includes('trial'), false, status)
    }
    assert.equal(kinds({ ...BASE, billing: { status: 'trialing', trial_end: null } }).includes('trial'), false)
  })

  it('links backfill progress and drops the merge-a-PR step once a backfill started', () => {
    const input: ExitBlockInput = { ...BASE, backfillTriggerKey: 'source-merges' }
    assert.deepEqual(kinds(input), ['headline', 'dashboard', 'backfill', 'next_steps', 'next_step', 'next_step'])
    assert.ok(lineOf(input, 'backfill').includes(`${APP}/configuration`))
  })

  it('ends with the MCP handoff command on the API host', () => {
    const lines = buildExitBlock(BASE)
    assert.ok(lines[lines.length - 1].text.endsWith(`claude mcp add --transport http promptless ${API}/mcp`))
  })

  it('names the docs repository and each source repository in the headline', () => {
    const headline = lineOf(BASE, 'headline')
    for (const repo of ['acme/docs', 'acme/api', 'acme/web']) assert.ok(headline.includes(repo), repo)
  })
})

describe('formatTrialEnd', () => {
  it('formats the date in UTC', () => {
    assert.equal(formatTrialEnd('2026-10-15T23:30:00-05:00'), '16 Oct 2026')
  })
})

describe('renderExitBlock', () => {
  it('writes one line per entry after a blank line', () => {
    const lines = buildExitBlock(BASE)
    const text = renderExitBlock(lines)
    assert.equal(text.split('\n').length, lines.length + 2)
    assert.ok(text.startsWith('\n'))
  })
})
