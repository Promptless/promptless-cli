import { spawnSync } from 'node:child_process'

export class PandocError extends Error {}

let cachedAvailable: boolean | null = null

export function isPandocAvailable(): boolean {
  if (cachedAvailable !== null) return cachedAvailable
  try {
    const result = spawnSync('pandoc', ['--version'], { stdio: 'ignore' })
    cachedAvailable = result.status === 0
  } catch {
    cachedAvailable = false
  }
  return cachedAvailable
}

/**
 * Map a file extension to the pandoc `-f` format name. Returns `null` for formats
 * we handle natively (markdown, mdx, plain text) or don't support.
 */
export function pandocFormatFromExt(ext: string): string | null {
  switch (ext.toLowerCase()) {
    case '.rst':
      return 'rst'
    case '.org':
      return 'org'
    case '.adoc':
    case '.asciidoc':
      return 'asciidoc'
    case '.tex':
    case '.ltx':
      return 'latex'
    case '.textile':
      return 'textile'
    case '.wiki':
    case '.mediawiki':
      return 'mediawiki'
    case '.dbk':
    case '.docbook':
      return 'docbook'
    case '.rtf':
      return 'rtf'
    case '.t2t':
      return 't2t'
    default:
      return null
  }
}

/**
 * Convert `input` from `inputFormat` to GFM markdown by piping through pandoc.
 * Throws `PandocError` if pandoc is missing or exits non-zero.
 *
 * Note: pandoc does not preserve source positions across conversion, so the
 * returned markdown's offsets do NOT map back to the original document. Callers
 * should make this limitation visible in user-facing output.
 */
export function pandocToMarkdown(input: string, inputFormat: string): string {
  if (!isPandocAvailable()) {
    throw new PandocError(
      `pandoc is not installed or not on PATH. Install it from https://pandoc.org/installing.html to analyze ${inputFormat} files.`,
    )
  }
  const result = spawnSync('pandoc', ['-f', inputFormat, '-t', 'gfm', '--wrap=preserve'], {
    input,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw new PandocError(`pandoc failed: ${result.error.message}`)
  if (result.status !== 0) {
    throw new PandocError(`pandoc exited with status ${result.status}: ${result.stderr?.trim() || '(no stderr)'}`)
  }
  return result.stdout
}
