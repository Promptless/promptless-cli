import type { ErrorCode } from '../../lib/errors'

// Progress output for `promptless setup`. Steps, notes, and prompts go to
// stderr; only the exit block goes to stdout.

/** A failure that ends setup. `index.ts` reports it as one `promptless-error:` line and exits 1. */
export class SetupError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'SetupError'
    this.code = code
  }
}

/** Print a numbered step heading. */
export function step(number: number, title: string): void {
  process.stderr.write(`\n${number} ${title}\n`)
}

/** Print an indented note under the current step. */
export function note(text: string): void {
  process.stderr.write(`  ${text}\n`)
}

/** Print a completed item under the current step. */
export function done(text: string): void {
  process.stderr.write(`  ✓ ${text}\n`)
}

/** Print a warning under the current step. */
export function warn(text: string): void {
  process.stderr.write(`  ! ${text}\n`)
}

/** Return a prompt answer, or end setup when the user cancelled the prompt (Ctrl-C or Escape). */
export function answered<T>(answer: T | null): T {
  if (answer === null) throw new SetupError('cancelled', 'Setup was cancelled.')
  return answer
}
