import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { runClientDetectors } from '../lib/detectors/index'
import { extractMarkdown } from '../lib/preprocess/extract'
import { remapViolation } from '../lib/preprocess/sourcemap'
import { pandocFormatFromExt, pandocToMarkdown, PandocError } from '../lib/preprocess/pandoc'
import { formatHuman } from '../format/human'
import { formatDiagnostic } from '../format/diagnostic'
import { RULES_BY_ID } from '../lib/rules'

type Mode = 'diagnostic' | 'debug'
type Format = 'auto' | 'text' | 'markdown' | 'mdx' | 'pandoc'

interface Args {
  mode: Mode
  files: string[]
  color: 'auto' | 'always' | 'never'
  format: Format
  pandocFrom: string | null
  showHelp: boolean
}

function parseArgs(argv: string[]): Args {
  let mode: Mode = 'diagnostic'
  let color: 'auto' | 'always' | 'never' = 'auto'
  let format: Format = 'auto'
  let pandocFrom: string | null = null
  let showHelp = false
  const files: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--debug') mode = 'debug'
    else if (arg === '--color') color = 'always'
    else if (arg === '--no-color') color = 'never'
    else if (arg === '-h' || arg === '--help') showHelp = true
    else if (arg === '--format' || arg.startsWith('--format=')) {
      const val = arg.startsWith('--format=') ? arg.slice('--format='.length) : argv[++i]
      if (val !== 'auto' && val !== 'text' && val !== 'markdown' && val !== 'mdx' && val !== 'pandoc') {
        process.stderr.write(`promptless slop-cop: --format expects one of: auto, text, markdown, mdx, pandoc\n`)
        process.exit(2)
      }
      format = val
    } else if (arg === '--from' || arg.startsWith('--from=')) {
      pandocFrom = arg.startsWith('--from=') ? arg.slice('--from='.length) : argv[++i]
    } else if (arg.startsWith('-')) {
      process.stderr.write(`promptless slop-cop: unknown flag ${arg}\n`)
      process.exit(2)
    } else {
      files.push(arg)
    }
  }
  return { mode, files, color, format, pandocFrom, showHelp }
}

const HELP = `promptless slop-cop — detect LLM prose tells in text files

usage:
  promptless slop-cop [options] <file>...

options:
  --debug             Compact ANSI-highlighted view with [N] category markers.
                      Useful for eyeballing hits; the default output is
                      per-violation diagnostics intended for agents and editors.
  --format <fmt>      Input format: auto (default), text, markdown, mdx, pandoc.
                      markdown/mdx use a remark AST parser and emit exact source
                      positions. pandoc shells out to \`pandoc\` and positions
                      refer to the converted markdown (not the original file).
  --from <pandoc-fmt> Force pandoc input format (rst, org, asciidoc, latex, ...).
                      Implies --format pandoc. Auto-detects from file extension
                      when --format auto.
  --color             Force ANSI color on
  --no-color          Force ANSI color off
  -h, --help          Show this help

formats:
  .md, .markdown      → markdown (remark)
  .mdx                → mdx (remark + remark-mdx)
  .rst, .org, .adoc,
  .tex, .textile,
  .wiki, .docbook, …  → pandoc (shell-out required)
  everything else     → plain text

exit codes:
  0   no errors (warnings may still be present)
  1   one or more errors found
  2   argument error
`

type ResolvedFormat =
  | { kind: 'text' }
  | { kind: 'markdown' }
  | { kind: 'mdx' }
  | { kind: 'pandoc'; from: string }

function resolveFormat(flag: Format, pandocFrom: string | null, file: string): ResolvedFormat {
  if (flag === 'markdown') return { kind: 'markdown' }
  if (flag === 'mdx') return { kind: 'mdx' }
  if (flag === 'text') return { kind: 'text' }
  if (flag === 'pandoc') {
    const from = pandocFrom ?? pandocFormatFromExt(extname(file))
    if (!from) {
      process.stderr.write(`promptless slop-cop: --format pandoc requires --from <pandoc-fmt> for ${file}\n`)
      process.exit(2)
    }
    return { kind: 'pandoc', from }
  }
  // auto
  if (pandocFrom) return { kind: 'pandoc', from: pandocFrom }
  const ext = extname(file).toLowerCase()
  if (ext === '.mdx') return { kind: 'mdx' }
  if (ext === '.md' || ext === '.markdown') return { kind: 'markdown' }
  const pandocFmt = pandocFormatFromExt(ext)
  if (pandocFmt) return { kind: 'pandoc', from: pandocFmt }
  return { kind: 'text' }
}

export function runSlopCop(argv: string[]): never {
  const args = parseArgs(argv)

  if (args.showHelp) {
    process.stdout.write(HELP)
    process.exit(0)
  }

  if (args.files.length === 0) {
    process.stderr.write(HELP)
    process.exit(2)
  }

  const useColor = args.color === 'always' || (args.color === 'auto' && process.stdout.isTTY === true)

  let errorTotal = 0
  for (const file of args.files) {
    let raw: string
    try {
      raw = readFileSync(file, 'utf-8')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`promptless slop-cop: could not read ${file}: ${msg}\n`)
      process.exit(2)
    }

    const fmt = resolveFormat(args.format, args.pandocFrom, file)

    // `displayText` is what the formatter quotes; violation offsets must be valid against it.
    // `label` is the file path we print in violation headers.
    let displayText: string
    let label: string
    let violations

    if (fmt.kind === 'text') {
      displayText = raw
      label = file
      violations = runClientDetectors(raw)
    } else if (fmt.kind === 'markdown' || fmt.kind === 'mdx') {
      const { text, segments } = extractMarkdown(raw, { mdx: fmt.kind === 'mdx' })
      const found = runClientDetectors(text)
      violations = found.map((v) => remapViolation(v, segments, raw))
      displayText = raw
      label = file
    } else {
      // pandoc path: convert to GFM markdown, then run the markdown pipeline on THAT.
      // Positions live in the converted markdown, not the original file — flag that in the label.
      let md: string
      try {
        md = pandocToMarkdown(raw, fmt.from)
      } catch (err) {
        if (err instanceof PandocError) {
          process.stderr.write(`promptless slop-cop: ${err.message}\n`)
          process.exit(2)
        }
        throw err
      }
      const { text, segments } = extractMarkdown(md, { mdx: false })
      const found = runClientDetectors(text)
      violations = found.map((v) => remapViolation(v, segments, md))
      displayText = md
      label = `${file} (via pandoc --from ${fmt.from})`
    }

    for (const v of violations) {
      const rule = RULES_BY_ID[v.ruleId]
      if ((rule?.severity ?? 'error') === 'error') errorTotal++
    }
    const output =
      args.mode === 'diagnostic'
        ? formatDiagnostic(label, displayText, violations, { color: useColor })
        : formatHuman(label, displayText, violations, { color: useColor })
    process.stdout.write(output)
  }

  process.exit(errorTotal > 0 ? 1 : 0)
}
