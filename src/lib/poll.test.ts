import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PollTimeoutError, pollUntil } from './poll'

describe('pollUntil', () => {
  it('returns the first non-null value and ticks once per attempt', async () => {
    const ticks: number[] = []
    const value = await pollUntil(async (attempt) => (attempt === 3 ? 'done' : null), {
      intervalMs: 1,
      onTick: (attempt) => {
        ticks.push(attempt)
      },
    })
    assert.equal(value, 'done')
    assert.deepEqual(ticks, [1, 2, 3])
  })

  it('reports only the first error and keeps polling', async () => {
    const reported: unknown[] = []
    const value = await pollUntil(
      async (attempt) => {
        if (attempt < 4) throw new Error(`failure ${attempt}`)
        return attempt
      },
      { intervalMs: 1, onError: (err) => reported.push(err) },
    )
    assert.equal(value, 4)
    assert.equal(reported.length, 1)
    assert.equal((reported[0] as Error).message, 'failure 1')
  })

  it('treats an onTick error as a failed attempt', async () => {
    const reported: unknown[] = []
    const value = await pollUntil(async () => 'ok', {
      intervalMs: 1,
      onTick: (attempt) => {
        if (attempt === 1) throw new Error('tick failed')
      },
      onError: (err) => reported.push(err),
    })
    assert.equal(value, 'ok')
    assert.equal(reported.length, 1)
  })

  it('throws PollTimeoutError when the deadline passes', async () => {
    let attempts = 0
    await assert.rejects(
      pollUntil(
        async () => {
          attempts++
          return null
        },
        { intervalMs: 5, timeoutMs: 30 },
      ),
      PollTimeoutError,
    )
    assert.ok(attempts >= 2)
  })

  it('stops with the abort reason when the signal aborts during a wait', async () => {
    const controller = new AbortController()
    const reason = new Error('user cancelled')
    setTimeout(() => controller.abort(reason), 10)
    await assert.rejects(
      pollUntil(async () => null, { intervalMs: 1_000, signal: controller.signal }),
      (err) => err === reason,
    )
  })

  it('does not call fn when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already'))
    let called = false
    await assert.rejects(
      pollUntil(
        async () => {
          called = true
          return 1
        },
        { intervalMs: 1, signal: controller.signal },
      ),
    )
    assert.equal(called, false)
  })
})
