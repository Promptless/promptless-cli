// A fatal error is reported as one machine-readable line on stderr, so a
// script or coding agent driving the CLI can branch on `code` without parsing
// prose. The line shape follows PostHog's `phw-error:` emitter (MIT,
// github.com/PostHog/wizard src/shared/errors/emit.ts).

export const ERROR_LINE_PREFIX = 'promptless-error:'

/**
 * Stable error codes. Scripts depend on these strings: add new codes, and
 * never rename or remove one.
 */
export const ERROR_CODES = [
  'bad_arguments',
  'interactive_terminal_required',
  'not_logged_in',
  'auth_failed',
  'login_failed',
  'network_error',
  'api_error',
  'setup_unavailable',
  'github_not_connected',
  'cancelled',
  'config_invalid',
  'internal_error',
  'admin_required',
  'repos_not_installed',
  'doc_collection_required',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ErrorLine {
  code: ErrorCode
  message: string
}

/** Format an error as `promptless-error: {"code":...,"message":...}` with no newline. */
export function formatErrorLine(line: ErrorLine): string {
  return `${ERROR_LINE_PREFIX} ${JSON.stringify({ code: line.code, message: line.message })}`
}

/** Write the error line to `stream` (stderr by default). */
export function emitError(line: ErrorLine, stream: NodeJS.WritableStream = process.stderr): void {
  stream.write(`${formatErrorLine(line)}\n`)
}
