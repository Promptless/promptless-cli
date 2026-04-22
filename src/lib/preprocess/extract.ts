import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import type { Extracted, Segment } from './sourcemap'

export interface ExtractOptions {
  mdx: boolean
}

/**
 * Parse markdown/MDX with remark and extract only the prose text,
 * building a sourcemap from each extracted chunk back to the original document.
 *
 * Skipped node kinds:
 *   heading, code, inlineCode, html, yaml, toml, thematicBreak,
 *   image, imageReference, definition, footnote*, table*,
 *   mdxjsEsm, mdx{Flow,Text}Expression, mdxJsx{Flow,Text}Element
 *
 * Block-level skips still emit a synthetic `\n\n` so paragraph-aware detectors
 * keep their sense of boundaries.
 */
export function extractMarkdown(input: string, opts: ExtractOptions): Extracted {
  const base = unified().use(remarkParse).use(remarkFrontmatter, ['yaml', 'toml']).use(remarkGfm)
  const processor = opts.mdx ? base.use(remarkMdx) : base
  // The mdast types from different plugins don't compose cleanly; the walker only touches
  // `.type`, `.value`, `.children`, and `.position.start.offset`, so `any` is safe here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree = processor.parse(input) as any

  let extracted = ''
  const segments: Segment[] = []

  const appendMapped = (value: string, originalOffset: number): void => {
    if (value.length === 0) return
    const last = segments[segments.length - 1]
    if (
      last &&
      last.extractedStart + last.length === extracted.length &&
      last.originalStart + last.length === originalOffset
    ) {
      last.length += value.length
    } else {
      segments.push({ extractedStart: extracted.length, originalStart: originalOffset, length: value.length })
    }
    extracted += value
  }

  const appendSynthetic = (value: string): void => {
    extracted += value
  }

  const ensureParagraphBreak = (): void => {
    if (extracted.length === 0) return
    if (extracted.endsWith('\n\n')) return
    if (extracted.endsWith('\n')) appendSynthetic('\n')
    else appendSynthetic('\n\n')
  }

  const SKIP_WITH_BREAK = new Set([
    'heading',
    'code',
    'html',
    'thematicBreak',
    'mdxjsEsm',
    'mdxFlowExpression',
    'mdxJsxFlowElement',
    'table',
    'definition',
    'footnoteDefinition',
  ])

  const SKIP_SILENT = new Set([
    'yaml',
    'toml',
    'inlineCode',
    'image',
    'imageReference',
    'mdxTextExpression',
    'mdxJsxTextElement',
    'footnoteReference',
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any): void => {
    if (!node) return
    const type: string = node.type

    if (SKIP_SILENT.has(type)) return
    if (SKIP_WITH_BREAK.has(type)) {
      ensureParagraphBreak()
      return
    }

    switch (type) {
      case 'text': {
        const value = String(node.value ?? '')
        const offset = node.position?.start?.offset
        if (typeof offset === 'number') appendMapped(value, offset)
        else appendSynthetic(value)
        return
      }
      case 'break': {
        appendSynthetic(' ')
        return
      }
      case 'paragraph':
      case 'blockquote':
      case 'listItem': {
        if (Array.isArray(node.children)) for (const c of node.children) walk(c)
        ensureParagraphBreak()
        return
      }
      case 'root':
      case 'list':
      case 'emphasis':
      case 'strong':
      case 'delete':
      case 'link':
      case 'linkReference': {
        if (Array.isArray(node.children)) for (const c of node.children) walk(c)
        return
      }
      default: {
        // Unknown node — recurse into children if any.
        if (Array.isArray(node.children)) for (const c of node.children) walk(c)
      }
    }
  }

  walk(tree)
  return { text: extracted, segments }
}
