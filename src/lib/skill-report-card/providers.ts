import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type {
  Finding,
  LlmReviewResult,
  LlmUsageEstimate,
  LoadedInstruction,
  ProviderAvailability,
  ResolvedLlmProvider,
  ScoreDimension,
} from './types'
import { commandExists } from './validator'

interface RawLlmFinding {
  severity: string
  dimension: string
  title: string
  message: string
  path: string
  remediation: string | null
}

interface ParsedLlmOutput {
  findings: RawLlmFinding[]
  summary: string | null
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: ['string', 'null'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'should-fix', 'nice-to-have'] },
          dimension: {
            type: 'string',
            enum: ['structure', 'triggering', 'specificity', 'governance', 'safety', 'evaluation', 'portability'],
          },
          title: { type: 'string' },
          message: { type: 'string' },
          path: { type: 'string' },
          remediation: { type: ['string', 'null'] },
        },
        required: ['severity', 'dimension', 'title', 'message', 'path', 'remediation'],
      },
    },
  },
  required: ['summary', 'findings'],
} satisfies Record<string, unknown>

export function detectProviders(): ProviderAvailability {
  return { claude: commandExists('claude'), codex: commandExists('codex') }
}

export function estimateLlmUsage(instructions: LoadedInstruction[]): LlmUsageEstimate {
  const contentTokens = instructions.reduce((total, instruction) => total + instruction.estimatedTokens, 0)
  const promptOverhead = 900 + instructions.length * 80
  return {
    inputTokens: contentTokens + promptOverhead,
    outputTokens: Math.max(1200, Math.min(6000, Math.round((contentTokens + promptOverhead) * 0.12))),
  }
}

export function resolveRequestedProvider(
  requested: 'auto' | 'claude' | 'codex',
  availability: ProviderAvailability,
): ResolvedLlmProvider | null {
  if (requested === 'claude') return availability.claude ? 'claude' : null
  if (requested === 'codex') return availability.codex ? 'codex' : null
  if (availability.claude) return 'claude'
  if (availability.codex) return 'codex'
  return null
}

export function runLlmReview(
  provider: ResolvedLlmProvider,
  instructions: LoadedInstruction[],
): LlmReviewResult {
  const prompt = buildReviewPrompt(instructions)
  const output = provider === 'claude' ? runClaude(prompt) : runCodex(prompt)
  const parsed = parseProviderOutput(output)
  const findings = parsed.findings.map((finding) => normalizeFinding(finding, instructions))
  return { provider, findings, rawSummary: parsed.summary }
}

function runClaude(prompt: string): string {
  const result = spawnSync(
    'claude',
    ['--print', '--output-format', 'json', '--json-schema', JSON.stringify(REVIEW_SCHEMA), '--no-session-persistence'],
    { input: prompt, encoding: 'utf-8', timeout: 240000 },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(firstUsefulLine(result.stderr) ?? 'claude exited with a non-zero status')
  return result.stdout
}

function runCodex(prompt: string): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'promptless-skill-report-card-'))
  const schemaPath = join(tempDirectory, 'schema.json')
  try {
    writeFileSync(schemaPath, JSON.stringify(REVIEW_SCHEMA), 'utf-8')
    const result = spawnSync(
      'codex',
      ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-schema', schemaPath, '-'],
      { input: prompt, encoding: 'utf-8', timeout: 240000 },
    )
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(firstUsefulLine(result.stderr) ?? 'codex exited with a non-zero status')
    return result.stdout
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

function buildReviewPrompt(instructions: LoadedInstruction[]): string {
  const files = instructions
    .map((instruction) => {
      return [
        `Path: ${instruction.path}`,
        `Kind: ${instruction.kind}`,
        'Content:',
        '```markdown',
        instruction.content,
        '```',
      ].join('\n')
    })
    .join('\n\n---\n\n')

  return `You are reviewing agent instruction files for Promptless Skill Report Card.

Return only JSON that matches the provided schema. Focus on concrete issues that would reduce agent reliability or governance readiness.

Severity guidance:
- blocker: unsafe, contradictory, non-portable, or likely to cause harmful agent behavior.
- should-fix: unclear triggers, broken references, stale guidance, or missing workflows.
- nice-to-have: polish or maintainability improvements.

Dimensions: structure, triggering, specificity, governance, safety, evaluation, portability.

Selected files:

${files}
`
}

function parseProviderOutput(stdout: string): ParsedLlmOutput {
  const parsed = parseJson(stdout)
  if (!parsed) throw new Error('LLM provider did not return parseable JSON')

  const direct = parsedOutputFromObject(parsed)
  if (direct) return direct

  const resultText = readStringProperty(parsed, 'result') ?? readStringProperty(parsed, 'message')
  if (resultText) {
    const nested = parseJson(resultText)
    if (nested) {
      const nestedOutput = parsedOutputFromObject(nested)
      if (nestedOutput) return nestedOutput
    }
  }

  throw new Error('LLM provider JSON did not match the expected report schema')
}

function parsedOutputFromObject(object: Record<string, unknown>): ParsedLlmOutput | null {
  const rawFindings = object.findings
  if (!Array.isArray(rawFindings)) return null

  const findings: RawLlmFinding[] = []
  for (const entry of rawFindings) {
    if (!isRecord(entry)) continue
    const severity = readStringProperty(entry, 'severity')
    const dimension = readStringProperty(entry, 'dimension')
    const title = readStringProperty(entry, 'title')
    const message = readStringProperty(entry, 'message')
    const path = readStringProperty(entry, 'path')
    if (!severity || !dimension || !title || !message || !path) continue
    findings.push({
      severity,
      dimension,
      title,
      message,
      path,
      remediation: readStringProperty(entry, 'remediation'),
    })
  }

  return { findings, summary: readStringProperty(object, 'summary') }
}

function normalizeFinding(rawFinding: RawLlmFinding, instructions: LoadedInstruction[]): Finding {
  const matchedInstruction = instructions.find((instruction) => {
    return (
      instruction.path === rawFinding.path ||
      instruction.displayPath === rawFinding.path ||
      instruction.path.endsWith(rawFinding.path)
    )
  })
  return {
    severity:
      rawFinding.severity === 'blocker' || rawFinding.severity === 'should-fix'
        ? rawFinding.severity
        : 'nice-to-have',
    source: 'llm',
    dimension: normalizeDimension(rawFinding.dimension),
    title: rawFinding.title,
    message: rawFinding.message,
    path: matchedInstruction?.path ?? rawFinding.path,
    remediation: rawFinding.remediation ?? undefined,
  }
}

function normalizeDimension(value: string): ScoreDimension {
  if (
    value === 'structure' ||
    value === 'triggering' ||
    value === 'specificity' ||
    value === 'governance' ||
    value === 'safety' ||
    value === 'evaluation' ||
    value === 'portability'
  ) {
    return value
  }
  return 'governance'
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readStringProperty(object: Record<string, unknown>, property: string): string | null {
  const value = object[property]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function firstUsefulLine(output: string): string | null {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0)
  return line ?? null
}
