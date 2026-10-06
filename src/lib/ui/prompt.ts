import { isCancel, multiselect, select } from '@clack/prompts'

// Select prompts render on stderr, so stdout carries only data. Each prompt
// takes stdin in raw mode: start one only after any other stdin reader has
// closed. A loopback login's `result` settles after its paste reader closes.

export interface Choice<T> {
  value: T
  label: string
  hint?: string
}

interface SelectOneOptions<T> {
  message: string
  choices: Choice<T>[]
  /** Defaults to the first choice. List the safe or declining choice first. */
  initial?: T
  signal?: AbortSignal
}

interface SelectManyOptions<T> {
  message: string
  choices: Choice<T>[]
  initial?: T[]
  /** Require at least one selection. */
  required?: boolean
  signal?: AbortSignal
}

/** Ask for one choice. Returns null when the user cancels (Ctrl-C or Escape). */
export async function selectOne<T>(opts: SelectOneOptions<T>): Promise<T | null> {
  const answer = await select<T>({
    message: opts.message,
    // clack types `options` by whether T is a primitive; the shape is the same either way.
    options: opts.choices as Parameters<typeof select<T>>[0]['options'],
    initialValue: opts.initial,
    output: process.stderr,
    signal: opts.signal,
  })
  return isCancel(answer) ? null : answer
}

/** Ask for any number of choices. Returns null when the user cancels. */
export async function selectMany<T>(opts: SelectManyOptions<T>): Promise<T[] | null> {
  const answer = await multiselect<T>({
    message: opts.message,
    options: opts.choices as Parameters<typeof multiselect<T>>[0]['options'],
    initialValues: opts.initial,
    required: opts.required ?? false,
    output: process.stderr,
    signal: opts.signal,
  })
  return isCancel(answer) ? null : answer
}
