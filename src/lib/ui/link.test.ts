import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { link } from './link'

const url = 'https://app.gopromptless.ai/cli/auth?state=abc'

describe('link', () => {
  let savedTerm: string | undefined

  beforeEach(() => {
    savedTerm = process.env.TERM
    process.env.TERM = 'xterm-256color'
  })

  afterEach(() => {
    if (savedTerm === undefined) delete process.env.TERM
    else process.env.TERM = savedTerm
  })

  it('wraps the label in an OSC 8 escape on a TTY', () => {
    assert.equal(link(url, 'Sign in', { isTTY: true }), `\u001b]8;;${url}\u0007Sign in\u001b]8;;\u0007`)
  })

  it('uses the URL as the label by default', () => {
    assert.equal(link(url, undefined, { isTTY: true }), `\u001b]8;;${url}\u0007${url}\u001b]8;;\u0007`)
  })

  it('prints the plain URL off a TTY', () => {
    assert.equal(link(url, url, { isTTY: false }), url)
  })

  it('keeps the URL visible next to a custom label off a TTY', () => {
    assert.equal(link(url, 'Sign in', {}), `Sign in (${url})`)
  })

  it('prints plain text when TERM is dumb', () => {
    process.env.TERM = 'dumb'
    assert.equal(link(url, url, { isTTY: true }), url)
  })
})
