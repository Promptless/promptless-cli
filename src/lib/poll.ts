// Loop semantics follow PostHog's GitHub-connection poll (MIT,
// github.com/PostHog/wizard src/ui/tui/hooks/useGithubConnection.ts): check
// immediately, wait a fixed interval between checks, report the first failed
// check once, and keep polling through transient failures.

export class PollTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`gave up waiting after ${timeoutMs}ms`)
    this.name = 'PollTimeoutError'
  }
}

export interface PollOptions {
  intervalMs: number
  /** Overall deadline. Omit to poll until `fn` finishes or `signal` aborts. */
  timeoutMs?: number
  /** Called before each attempt with its 1-based number. Errors it throws count as a failed attempt. */
  onTick?: (attempt: number) => void | Promise<void>
  /** Called with the first failed attempt's error only. */
  onError?: (err: unknown) => void
  signal?: AbortSignal
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Call `fn` until it returns a value other than `null`, and return that value.
 *
 * @throws PollTimeoutError when `timeoutMs` passes first.
 * @throws the signal's reason when `signal` aborts.
 *
 * @example
 *   const status = await pollUntil(
 *     async () => {
 *       const s = await fetchStatus()
 *       return s.github.connected ? s : null
 *     },
 *     { intervalMs: 3000, onError: (err) => warn(err) },
 *   )
 */
export async function pollUntil<T>(
  fn: (attempt: number) => Promise<T | null>,
  opts: PollOptions,
): Promise<T> {
  const deadline = opts.timeoutMs === undefined ? Infinity : Date.now() + opts.timeoutMs
  let errorReported = false

  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) throw opts.signal.reason
    try {
      await opts.onTick?.(attempt)
      const value = await fn(attempt)
      if (value !== null) return value
    } catch (err) {
      if (opts.signal?.aborted) throw opts.signal.reason
      if (!errorReported) {
        errorReported = true
        opts.onError?.(err)
      }
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new PollTimeoutError(opts.timeoutMs ?? 0)
    await sleep(Math.min(opts.intervalMs, remaining), opts.signal)
    if (Date.now() >= deadline) throw new PollTimeoutError(opts.timeoutMs ?? 0)
  }
}
