import type { Violation } from '../lib/types'
import { RULES_BY_ID } from '../lib/rules'

export interface DiagnosticOptions {
  color: boolean
}

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const UNDERLINE = '\x1b[4m'
const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'

export function formatDiagnostic(
  file: string,
  text: string,
  violations: Violation[],
  opts: DiagnosticOptions = { color: false },
): string {
  const c = (code: string) => (opts.color ? code : '')

  if (violations.length === 0) {
    return `${c(DIM)}${file}: no violations${c(RESET)}\n`
  }

  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)
  }
  const lines = text.split('\n')

  const locate = (idx: number): { line: number; col: number } => {
    const clamped = Math.min(idx, text.length)
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= clamped) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, col: clamped - lineStarts[lo] + 1 }
  }

  const sorted = [...violations].sort((a, b) => a.startIndex - b.startIndex)
  let out = ''
  for (const v of sorted) {
    const rule = RULES_BY_ID[v.ruleId]
    const start = locate(v.startIndex)
    const end = locate(v.endIndex)
    const name = rule?.name ?? v.ruleId
    const category = rule?.category ?? 'unknown'
    const gutterWidth = String(end.line).length
    const pad = (s: string) => s.padStart(gutterWidth, ' ')
    const empty = ' '.repeat(gutterWidth)
    const bar = `${c(DIM)}|${c(RESET)}`

    out +=
      `${c(BOLD)}${file}:${start.line}:${start.col}${c(RESET)}: ` +
      `${c(CYAN)}${c(BOLD)}${category}[${v.ruleId}]${c(RESET)}: ` +
      `${c(BOLD)}${name}${c(RESET)}\n`
    out += `${empty} ${bar}\n`

    for (let lineNum = start.line; lineNum <= end.line; lineNum++) {
      const lineText = lines[lineNum - 1] ?? ''
      const caretStart = lineNum === start.line ? start.col : 1
      const caretEnd = lineNum === end.line ? end.col : lineText.length + 1
      const pre = lineText.slice(0, caretStart - 1)
      const mid = lineText.slice(caretStart - 1, caretEnd - 1)
      const post = lineText.slice(caretEnd - 1)
      const highlighted = `${pre}${c(UNDERLINE)}${mid}${c(RESET)}${post}`
      out += `${c(DIM)}${pad(String(lineNum))}${c(RESET)} ${bar} ${highlighted}\n`
      const before = ' '.repeat(Math.max(0, caretStart - 1))
      const carets = '^'.repeat(Math.max(1, caretEnd - caretStart))
      out += `${empty} ${bar} ${c(RED)}${c(BOLD)}${before}${carets}${c(RESET)}\n`
    }
    out += `${empty} ${bar}\n`

    if (v.explanation) {
      out += `${empty} ${c(DIM)}=${c(RESET)} ${c(YELLOW)}${c(BOLD)}note:${c(RESET)} ${v.explanation}\n`
    }
    if (rule?.tip) {
      out += `${empty} ${c(DIM)}=${c(RESET)} ${c(CYAN)}${c(BOLD)}help:${c(RESET)} ${rule.tip}\n`
    }
    if (v.suggestedChange !== undefined && v.suggestedChange !== '') {
      out +=
        `${empty} ${c(DIM)}=${c(RESET)} ${c(GREEN)}${c(BOLD)}replace with:${c(RESET)} ` +
        `${JSON.stringify(v.suggestedChange)}\n`
    }
    out += '\n'
  }

  out += `${c(DIM)}${violations.length} violation${violations.length === 1 ? '' : 's'} in ${file}${c(RESET)}\n`
  return out
}
