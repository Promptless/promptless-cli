import type { Violation, ViolationCategory } from '../lib/types'
import { RULES_BY_ID } from '../lib/rules'

export interface HumanOptions {
  color: boolean
}

const CATEGORY_NUMBER: Record<ViolationCategory, number> = {
  'word-choice': 1,
  'sentence-structure': 2,
  'rhetorical': 3,
  'structural': 4,
  'framing': 5,
}

const CATEGORY_LABEL: Record<number, string> = {
  1: 'word-choice',
  2: 'sentence-structure',
  3: 'rhetorical',
  4: 'structural',
  5: 'framing',
}

// ANSI SGR codes per category
const CATEGORY_FG: Record<number, string> = {
  1: '\x1b[33m', // yellow
  2: '\x1b[31m', // red
  3: '\x1b[35m', // magenta
  4: '\x1b[36m', // cyan
  5: '\x1b[32m', // green
}

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const UNDERLINE = '\x1b[4m'
const RESET = '\x1b[0m'

export function formatHuman(file: string, text: string, violations: Violation[], opts: HumanOptions): string {
  const c = (code: string) => (opts.color ? code : '')

  if (violations.length === 0) {
    return `${c(DIM)}${file}: clean — no slop detected${c(RESET)}\n`
  }

  // Sort by start, drop any overlapping later violations so inline rendering stays sane.
  const sorted = [...violations].sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex)
  const kept: Violation[] = []
  let lastEnd = -1
  for (const v of sorted) {
    if (v.startIndex >= lastEnd) {
      kept.push(v)
      lastEnd = v.endIndex
    }
  }

  // Walk text, inserting ANSI (or plain [N]) at each span boundary.
  let out = ''
  let cursor = 0
  const categoriesSeen = new Set<number>()
  for (const v of kept) {
    const rule = RULES_BY_ID[v.ruleId]
    const catN = rule ? CATEGORY_NUMBER[rule.category] : 1
    categoriesSeen.add(catN)
    const fg = CATEGORY_FG[catN] ?? ''
    out += text.slice(cursor, v.startIndex)
    const span = text.slice(v.startIndex, v.endIndex)
    out += `${c(fg)}${c(BOLD)}${c(UNDERLINE)}${span}${c(RESET)}${c(DIM)}[${catN}]${c(RESET)}`
    cursor = v.endIndex
  }
  out += text.slice(cursor)

  const dropped = violations.length - kept.length
  const droppedNote = dropped > 0 ? `, ${dropped} overlapping hidden` : ''
  const header =
    `${c(BOLD)}${file}${c(RESET)} ${c(DIM)}— ${kept.length} violation${kept.length === 1 ? '' : 's'}${droppedNote}${c(RESET)}\n\n`

  // Legend shows only categories that appeared, in numeric order.
  const legendParts: string[] = []
  for (const n of [1, 2, 3, 4, 5]) {
    if (!categoriesSeen.has(n)) continue
    legendParts.push(`${c(CATEGORY_FG[n])}[${n}]${c(RESET)} ${CATEGORY_LABEL[n]}`)
  }
  const legend = `\n\n${c(DIM)}legend:${c(RESET)}  ${legendParts.join('   ')}\n`

  return header + out + legend
}
