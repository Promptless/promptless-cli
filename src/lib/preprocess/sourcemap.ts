import type { Violation } from '../types'

/**
 * A mapping from a contiguous slice of the extracted prose string back to the
 * original source document. `extractedStart` and `originalStart` are byte/char
 * offsets; `length` is the number of chars that map 1:1 between them.
 */
export interface Segment {
  extractedStart: number
  originalStart: number
  length: number
}

export interface Extracted {
  /** Prose-only text fed to detectors. */
  text: string
  /** Sorted by `extractedStart`. Gaps represent synthetic separators with no source mapping. */
  segments: Segment[]
}

/**
 * Translate an offset into the extracted prose back to an offset in the original source.
 * Offsets that fall in synthetic gaps (separators we injected) snap to the end of the
 * preceding mapped segment — preferable to guessing, and keeps violations near their
 * real source location.
 */
export function remapOffset(segments: Segment[], offset: number): number {
  if (segments.length === 0) return offset

  // Largest segment with extractedStart <= offset.
  let lo = 0
  let hi = segments.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segments[mid].extractedStart <= offset) lo = mid
    else hi = mid - 1
  }
  const seg = segments[lo]

  if (offset < seg.extractedStart) return seg.originalStart

  const within = offset - seg.extractedStart
  if (within <= seg.length) return seg.originalStart + within

  // Inside a synthetic gap after `seg` — snap to that segment's original end.
  return seg.originalStart + seg.length
}

/** Remap a violation's offsets and matchedText back onto the original source text. */
export function remapViolation(
  v: Violation,
  segments: Segment[],
  originalText: string,
): Violation {
  const startIndex = remapOffset(segments, v.startIndex)
  const endIndex = Math.max(startIndex, remapOffset(segments, v.endIndex))
  return {
    ...v,
    startIndex,
    endIndex,
    matchedText: originalText.slice(startIndex, endIndex),
  }
}
