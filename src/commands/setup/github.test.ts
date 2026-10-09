import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SetupStatus } from '../../lib/setup-api'
import { runGitHubGate } from './github'
import type { GateChoice, GateDeps, GateEvent } from './github'

function status(connected: boolean, pending: string[] = []): SetupStatus {
  return {
    onboarding_completed: false,
    billing: null,
    github: {
      connected,
      installations: connected
        ? [{ owner: 'acme', repository_selection: 'selected', repos: [{ full_name: 'acme/docs', default_branch: 'main' }] }]
        : [],
      pending_approval: pending.map((login) => ({ github_org_login: login, requested_at: '2026-10-01T00:00:00Z' })),
    },
    doc_collections: [],
    triggers: [],
  }
}

/** A prompt that stays open until the gate aborts it, like a user who never answers. */
function idleAsk(signal: AbortSignal): Promise<GateChoice | null> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(null)
    signal.addEventListener('abort', () => resolve(null), { once: true })
  })
}

interface Harness {
  deps: GateDeps
  events: GateEvent[]
  opened: string[]
  calls: { status: number; begin: number; pull: number; ask: number }
}

function harness(statuses: SetupStatus[], overrides: Partial<GateDeps> = {}): Harness {
  const events: GateEvent[] = []
  const opened: string[] = []
  const calls = { status: 0, begin: 0, pull: 0, ask: 0 }
  const deps: GateDeps = {
    fetchStatus: async () => statuses[Math.min(calls.status++, statuses.length - 1)],
    begin: async () => {
      calls.begin++
      return 'https://github.com/apps/promptless/installations/new'
    },
    pull: async () => {
      calls.pull++
    },
    openUrl: (url) => opened.push(url),
    ask: (_opened, signal) => {
      calls.ask++
      return idleAsk(signal)
    },
    report: (event) => events.push(event),
    openOnStart: true,
    intervalMs: 2,
    timeoutMs: 2_000,
    pullEvery: 3,
    ...overrides,
  }
  return { deps, events, opened, calls }
}

describe('runGitHubGate', () => {
  it('passes straight through when GitHub is already connected', async () => {
    const h = harness([status(true)])
    const outcome = await runGitHubGate(h.deps)
    assert.equal(outcome.kind, 'connected')
    assert.equal(h.calls.begin, 0)
    assert.equal(h.calls.ask, 0)
    assert.deepEqual(
      h.events.map((e) => e.kind),
      ['already_connected'],
    )
  })

  it('opens the install page and polls until an installation appears', async () => {
    const statuses = [status(false), ...Array.from({ length: 7 }, () => status(false)), status(true)]
    const h = harness(statuses)
    const outcome = await runGitHubGate(h.deps)

    assert.equal(outcome.kind, 'connected')
    assert.deepEqual(h.opened, ['https://github.com/apps/promptless/installations/new'])
    // One initial read, then poll attempts 1..8; attempts 3 and 6 also pull.
    assert.equal(h.calls.status, 9)
    assert.equal(h.calls.pull, 2)
    assert.deepEqual(
      h.events.map((e) => e.kind),
      ['install_link', 'connected'],
    )
  })

  it('only prints the link without opening a browser when openOnStart is off', async () => {
    const h = harness([status(false), status(true)], { openOnStart: false })
    await runGitHubGate(h.deps)
    assert.deepEqual(h.opened, [])
    assert.deepEqual(h.events[0], {
      kind: 'install_link',
      url: 'https://github.com/apps/promptless/installations/new',
      opened: false,
    })
  })

  it('stops polling when the user declines', async () => {
    const h = harness([status(false)], { ask: async () => 'decline' })
    const outcome = await runGitHubGate(h.deps)
    assert.deepEqual(outcome, { kind: 'declined' })

    const statusCallsAtDecline = h.calls.status
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(h.calls.status, statusCallsAtDecline)
  })

  it('reports a cancelled prompt as cancelled', async () => {
    const h = harness([status(false)], { ask: async () => null })
    assert.deepEqual(await runGitHubGate(h.deps), { kind: 'cancelled' })
  })

  it('re-opens the install page when asked, then keeps waiting', async () => {
    const answers: Array<GateChoice | null> = ['open']
    const statuses = [status(false), ...Array.from({ length: 20 }, () => status(false)), status(true)]
    const h = harness(statuses, {
      ask: (opened, signal) => {
        const next = answers.shift()
        if (next !== undefined) {
          assert.equal(opened, true)
          return Promise.resolve(next)
        }
        return idleAsk(signal)
      },
    })
    const outcome = await runGitHubGate(h.deps)
    assert.equal(outcome.kind, 'connected')
    assert.equal(h.opened.length, 2)
    assert.deepEqual(
      h.events.map((e) => (e.kind === 'install_link' ? `${e.kind}:${e.opened}` : e.kind)),
      ['install_link:true', 'install_link:true', 'connected'],
    )
  })

  it('reports a pending admin approval once per change, between prompts', async () => {
    const statuses = [
      status(false),
      status(false, ['acme']),
      status(false, ['acme']),
      status(false, ['acme']),
      status(false, ['acme', 'labs']),
      status(true),
    ]
    let promptOpen = false
    const h = harness(statuses, {
      ask: (_opened, signal) => {
        promptOpen = true
        return idleAsk(signal).finally(() => {
          promptOpen = false
        })
      },
    })
    const report = h.deps.report
    h.deps.report = (event) => {
      assert.equal(promptOpen, false, 'events print only while no prompt is open')
      report(event)
    }

    const outcome = await runGitHubGate(h.deps)
    assert.equal(outcome.kind, 'connected')
    const pending = h.events.filter((e) => e.kind === 'pending_approval')
    assert.deepEqual(
      pending.map((e) => (e.kind === 'pending_approval' ? e.githubOrgs : [])),
      [['acme'], ['acme', 'labs']],
    )
  })

  it('reports a pending approval that exists before polling starts', async () => {
    const h = harness([status(false, ['acme']), status(false, ['acme']), status(true)])
    await runGitHubGate(h.deps)
    assert.deepEqual(
      h.events.map((e) => e.kind),
      ['install_link', 'pending_approval', 'connected'],
    )
  })

  it('reports the first failed check once and keeps polling', async () => {
    let calls = 0
    const h = harness([], {
      fetchStatus: async () => {
        calls++
        if (calls === 1) return status(false)
        if (calls <= 4) throw new Error('connection reset')
        return status(true)
      },
    })
    const outcome = await runGitHubGate(h.deps)
    assert.equal(outcome.kind, 'connected')
    assert.deepEqual(
      h.events.map((e) => e.kind),
      ['install_link', 'check_failed', 'connected'],
    )
  })

  it('times out when no installation arrives', async () => {
    const h = harness([status(false)], { timeoutMs: 20 })
    assert.deepEqual(await runGitHubGate(h.deps), { kind: 'timed_out' })
  })
})
