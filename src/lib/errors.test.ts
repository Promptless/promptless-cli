import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Writable } from 'node:stream'

import { ERROR_CODES, ERROR_LINE_PREFIX, emitError, formatErrorLine } from './errors'

function captureStream(): { stream: Writable; output: () => string } {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk))
      callback()
    },
  })
  return { stream, output: () => chunks.join('') }
}

describe('emitError', () => {
  it('writes one prefixed JSON line', () => {
    const { stream, output } = captureStream()
    emitError({ code: 'github_not_connected', message: 'Nothing was changed.' }, stream)

    const text = output()
    assert.ok(text.endsWith('\n'))
    assert.equal(text.split('\n').length, 2)
    assert.ok(text.startsWith(`${ERROR_LINE_PREFIX} `))
    assert.deepEqual(JSON.parse(text.slice(ERROR_LINE_PREFIX.length + 1)), {
      code: 'github_not_connected',
      message: 'Nothing was changed.',
    })
  })

  it('keeps a multi-line message on one line', () => {
    const line = formatErrorLine({ code: 'api_error', message: 'first\nsecond' })
    assert.equal(line.includes('\n'), false)
    assert.equal(JSON.parse(line.slice(ERROR_LINE_PREFIX.length + 1)).message, 'first\nsecond')
  })
})

describe('ERROR_CODES', () => {
  it('holds unique snake_case codes', () => {
    assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length)
    for (const code of ERROR_CODES) assert.match(code, /^[a-z][a-z0-9_]*$/)
  })
})
