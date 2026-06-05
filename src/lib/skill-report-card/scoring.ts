import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type {
  DimensionScore,
  DiscoveredInstruction,
  Finding,
  FindingSeverity,
  InstructionScore,
  LoadedInstruction,
  ReportSummary,
  ScoreDimension,
} from './types'

const SCORE_DIMENSIONS: ScoreDimension[] = [
  'structure',
  'triggering',
  'specificity',
  'governance',
  'safety',
  'evaluation',
  'portability',
]

const DIMENSION_WEIGHTS: Record<ScoreDimension, number> = {
  structure: 1,
  triggering: 1.2,
  specificity: 1,
  governance: 0.9,
  safety: 1.35,
  evaluation: 0.8,
  portability: 0.9,
}

const SEVERITY_PENALTY: Record<FindingSeverity, number> = {
  blocker: 36,
  'should-fix': 18,
  'nice-to-have': 7,
}

export function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4))
}

export function loadInstructions(items: DiscoveredInstruction[]): LoadedInstruction[] {
  return items.map((item) => {
    const content = readFileSync(item.path, 'utf-8')
    return {
      ...item,
      content,
      lineCount: content.split(/\r?\n/).length,
      estimatedTokens: estimateTokens(content),
    }
  })
}

export function scoreInstructions(
  instructions: LoadedInstruction[],
  externalFindings: Finding[],
): InstructionScore[] {
  const conflictFindings = findCrossFileConflictFindings(instructions)

  return instructions.map((instruction) => {
    const findings = [
      ...deterministicFindings(instruction),
      ...conflictFindings.filter((finding) => finding.path === instruction.path),
      ...externalFindings.filter((finding) => finding.path === instruction.path),
    ]
    const dimensions = scoreDimensions(findings)
    const score = weightedScore(dimensions)
    const blockerCount = findings.filter((finding) => finding.severity === 'blocker').length
    const shouldFixCount = findings.filter((finding) => finding.severity === 'should-fix').length
    return {
      instruction,
      score,
      grade: gradeForScore(score),
      verdict: blockerCount > 0 || score < 65 ? 'block' : shouldFixCount > 0 || score < 90 ? 'revise' : 'ship',
      dimensions,
      findings,
    }
  })
}

export function summarizeScores(scores: InstructionScore[]): ReportSummary {
  const allFindings = scores.flatMap((score) => score.findings)
  const totalScore = scores.reduce((total, score) => total + score.score, 0)
  const averageScore = scores.length === 0 ? 0 : Math.round(totalScore / scores.length)
  const blockerCount = allFindings.filter((finding) => finding.severity === 'blocker').length
  const shouldFixCount = allFindings.filter((finding) => finding.severity === 'should-fix').length
  const adjustedScore = adjustedSummaryScore(averageScore, blockerCount, shouldFixCount)
  return {
    score: adjustedScore,
    grade: gradeForScore(adjustedScore),
    blockerCount,
    shouldFixCount,
    niceToHaveCount: allFindings.filter((finding) => finding.severity === 'nice-to-have').length,
    instructionCount: scores.length,
    skillCount: scores.filter((score) => score.instruction.kind.endsWith('skill')).length,
    rootInstructionCount: scores.filter((score) => !score.instruction.kind.endsWith('skill')).length,
  }
}

function adjustedSummaryScore(
  averageScore: number,
  blockerCount: number,
  shouldFixCount: number,
): number {
  if (blockerCount >= 5) return Math.min(averageScore, 74)
  if (blockerCount > 0) return Math.min(averageScore, 84)
  if (shouldFixCount > 0) return Math.min(averageScore, 89)
  return averageScore
}

export function gradeForScore(score: number): string {
  if (score >= 97) return 'A+'
  if (score >= 93) return 'A'
  if (score >= 90) return 'A-'
  if (score >= 87) return 'B+'
  if (score >= 83) return 'B'
  if (score >= 80) return 'B-'
  if (score >= 77) return 'C+'
  if (score >= 73) return 'C'
  if (score >= 70) return 'C-'
  if (score >= 67) return 'D+'
  if (score >= 63) return 'D'
  return 'F'
}

function deterministicFindings(instruction: LoadedInstruction): Finding[] {
  const findings: Finding[] = []
  findings.push(...linkFindings(instruction))
  findings.push(...safetyFindings(instruction))
  findings.push(...portabilityFindings(instruction))
  findings.push(...stalenessFindings(instruction))

  if (instruction.kind.endsWith('skill')) {
    findings.push(...skillShapeFindings(instruction))
  } else {
    findings.push(...rootInstructionFindings(instruction))
  }

  if (instruction.estimatedTokens > 12000) {
    findings.push({
      severity: 'blocker',
      source: 'promptless',
      dimension: 'specificity',
      title: 'Instruction file is too large to use reliably',
      message: `This file is roughly ${instruction.estimatedTokens.toLocaleString()} tokens. Agents are likely to ignore or compress important details.`,
      path: instruction.path,
      remediation: 'Split this into smaller, purpose-specific skills or linked reference files.',
    })
  } else if (instruction.estimatedTokens > 6000) {
    findings.push({
      severity: 'should-fix',
      source: 'promptless',
      dimension: 'specificity',
      title: 'Instruction file is large',
      message: `This file is roughly ${instruction.estimatedTokens.toLocaleString()} tokens, which makes activation and retention less predictable.`,
      path: instruction.path,
      remediation: 'Move durable references into separate files and keep the activation instructions compact.',
    })
  }

  return findings
}

function skillShapeFindings(instruction: LoadedInstruction): Finding[] {
  const findings: Finding[] = []
  const frontmatterDescription = frontmatterField(instruction.content, 'description')
  const hasUseWhen = /use when/i.test(frontmatterDescription ?? instruction.content.slice(0, 600))
  const headingCount = (instruction.content.match(/^##\s+/gm) ?? []).length

  if (!frontmatterDescription) {
    findings.push({
      severity: 'should-fix',
      source: 'promptless',
      dimension: 'triggering',
      title: 'Skill is missing a frontmatter description',
      message: 'Agents need a concise trigger description to decide when this skill applies.',
      path: instruction.path,
      remediation: 'Add a frontmatter description that starts with "Use when..." and names the activation condition.',
    })
  } else if (!hasUseWhen) {
    findings.push({
      severity: 'should-fix',
      source: 'promptless',
      dimension: 'triggering',
      title: 'Skill trigger is not phrased as an activation condition',
      message: 'The description should tell the agent when to use the skill, not summarize all implementation details.',
      path: instruction.path,
      remediation: 'Rewrite the description as a short "Use when..." trigger.',
    })
  }

  if (frontmatterDescription && frontmatterDescription.length > 260) {
    findings.push({
      severity: 'nice-to-have',
      source: 'promptless',
      dimension: 'specificity',
      title: 'Skill description is long',
      message: 'Long trigger descriptions are harder for agents to match precisely.',
      path: instruction.path,
      remediation: 'Keep the description to one sentence and move details into the body.',
    })
  }

  if (headingCount < 2) {
    findings.push({
      severity: 'should-fix',
      source: 'promptless',
      dimension: 'structure',
      title: 'Skill body has little visible structure',
      message: 'A skill should separate activation, workflow, and output expectations so agents can follow it quickly.',
      path: instruction.path,
      remediation: 'Add short sections such as Workflow, Output, and Boundaries.',
    })
  }

  if (!/\b(workflow|steps|process|procedure|instructions)\b/i.test(instruction.content)) {
    findings.push({
      severity: 'should-fix',
      source: 'promptless',
      dimension: 'evaluation',
      title: 'Skill lacks an explicit workflow',
      message: 'The skill describes a capability but does not clearly tell the agent what to do.',
      path: instruction.path,
      remediation: 'Add a compact ordered workflow for the agent to execute.',
    })
  }

  if (!/\b(output|deliverable|report|response|result|acceptance|verify|test)\b/i.test(instruction.content)) {
    findings.push({
      severity: 'nice-to-have',
      source: 'promptless',
      dimension: 'evaluation',
      title: 'Skill lacks output or verification criteria',
      message: 'The skill does not say how success should be recognized.',
      path: instruction.path,
      remediation: 'Add expected output shape, verification steps, or acceptance criteria.',
    })
  }

  return findings
}

function rootInstructionFindings(instruction: LoadedInstruction): Finding[] {
  const findings: Finding[] = []
  if (!/\b(test|lint|typecheck|verify|build)\b/i.test(instruction.content)) {
    findings.push({
      severity: 'nice-to-have',
      source: 'promptless',
      dimension: 'evaluation',
      title: 'Root instructions do not mention verification',
      message: 'Agents get better outcomes when the root policy names the expected local checks.',
      path: instruction.path,
      remediation: 'Add the project-specific verification commands or point to the source of truth.',
    })
  }
  if (!/\b(owner|maintainer|escalate|approval|confirm)\b/i.test(instruction.content)) {
    findings.push({
      severity: 'nice-to-have',
      source: 'promptless',
      dimension: 'governance',
      title: 'Root instructions do not define escalation boundaries',
      message: 'The file does not say when an agent should ask a human before taking risky action.',
      path: instruction.path,
      remediation: 'Document approval boundaries for production, credentials, data writes, and destructive commands.',
    })
  }
  return findings
}

function linkFindings(instruction: LoadedInstruction): Finding[] {
  const findings: Finding[] = []
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g
  let match: RegExpExecArray | null

  while ((match = linkPattern.exec(instruction.content)) !== null) {
    const rawTarget = match[1]?.trim()
    if (!rawTarget || shouldIgnoreLink(rawTarget)) continue

    const withoutAnchor = rawTarget.split('#')[0] ?? rawTarget
    if (!withoutAnchor) continue

    const resolved = resolve(dirname(instruction.path), withoutAnchor)
    if (!existsSync(resolved)) {
      findings.push({
        severity: 'should-fix',
        source: 'promptless',
        dimension: 'portability',
        title: 'Relative link target is missing',
        message: `The link target "${rawTarget}" does not exist from this instruction file.`,
        path: instruction.path,
        line: lineForOffset(instruction.content, match.index),
        remediation: 'Update the link or remove the stale reference.',
      })
    }
  }

  return findings
}

function shouldIgnoreLink(target: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith('#') ||
    target.startsWith('/') ||
    target.startsWith('~')
  )
}

function safetyFindings(instruction: LoadedInstruction): Finding[] {
  const findings: Finding[] = []
  const lines = instruction.content.split(/\r?\n/)

  lines.forEach((line, index) => {
    if (isProtectiveLine(line)) return
    if (/secretsmanager\s+(put-secret-value|create-secret|update-secret|delete-secret)/i.test(line)) {
      findings.push({
        severity: 'blocker',
        source: 'promptless',
        dimension: 'safety',
        title: 'Instruction includes a Secrets Manager write command',
        message: 'Agents should not be instructed to write secrets directly.',
        path: instruction.path,
        line: index + 1,
        remediation: 'Replace this with a human-run command and an explicit approval boundary.',
      })
    }
    if (/\b(git\s+reset\s+--hard|git\s+checkout\s+--|rm\s+-rf|push\s+--force|force-push)\b/i.test(line)) {
      findings.push({
        severity: 'blocker',
        source: 'promptless',
        dimension: 'safety',
        title: 'Instruction includes destructive command guidance',
        message: 'Destructive commands need an explicit prohibition or human approval path.',
        path: instruction.path,
        line: index + 1,
        remediation: 'State the approval requirement or remove the command from agent-executable instructions.',
      })
    }
  })

  if (
    instruction.kind.endsWith('skill') &&
    /\b(production|prod|deploy|database|secret|credential)\b/i.test(instruction.content) &&
    /\b(write|update|delete|insert|deploy|push|send|post|create)\b/i.test(instruction.content) &&
    !/\b(approval|confirm|consent|read-only|ask the user|human)\b/i.test(instruction.content)
  ) {
    findings.push({
      severity: 'blocker',
      source: 'promptless',
      dimension: 'safety',
      title: 'Risky skill lacks an approval boundary',
      message: 'This skill appears able to mutate production, credentials, or durable data without saying when to ask a human.',
      path: instruction.path,
      remediation: 'Add an explicit approval boundary before production writes, credential changes, deploys, or destructive actions.',
    })
  }

  return findings
}

function isProtectiveLine(line: string): boolean {
  return /\b(never|do not|don't|must not|without explicit|only after approval|ask before)\b/i.test(line)
}

function portabilityFindings(instruction: LoadedInstruction): Finding[] {
  const findings: Finding[] = []
  const localPathPattern = /(?:^|[\s"`'])\/Users\/[A-Za-z0-9._-]+\//gm
  let match: RegExpExecArray | null

  while ((match = localPathPattern.exec(instruction.content)) !== null) {
    findings.push({
      severity: 'should-fix',
      source: 'promptless',
      dimension: 'portability',
      title: 'Instruction contains a user-specific absolute path',
      message: 'Hardcoded local paths make skills fail on other machines.',
      path: instruction.path,
      line: lineForOffset(instruction.content, match.index),
      remediation: 'Use repo-relative paths, environment variables, or documented placeholders.',
    })
  }

  return findings
}

function stalenessFindings(instruction: LoadedInstruction): Finding[] {
  const findings: Finding[] = []
  const stalePattern = /\b(todo|fixme|deprecated|obsolete|old workflow|stale)\b/i
  const lines = instruction.content.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (!stalePattern.test(line)) return
    findings.push({
      severity: /deprecated|obsolete|stale/i.test(line) ? 'should-fix' : 'nice-to-have',
      source: 'promptless',
      dimension: 'governance',
      title: 'Instruction includes stale-maintenance language',
      message: 'Stale markers make it unclear whether the instruction is still authoritative.',
      path: instruction.path,
      line: index + 1,
      remediation: 'Resolve the marker or move speculative notes out of active instructions.',
    })
  })
  return findings
}

function findCrossFileConflictFindings(instructions: LoadedInstruction[]): Finding[] {
  const prohibitsForcePush = instructions.filter((instruction) =>
    /\b(never|do not|don't|must not)\b[^.\n]*(force-push|push\s+--force)/i.test(instruction.content),
  )
  const allowsForcePush = instructions.filter((instruction) =>
    /\b(use|run|perform|allow)\b[^.\n]*(force-push|push\s+--force)/i.test(instruction.content),
  )

  if (prohibitsForcePush.length === 0 || allowsForcePush.length === 0) return []

  return [...prohibitsForcePush, ...allowsForcePush].map((instruction) => ({
    severity: 'blocker',
    source: 'promptless',
    dimension: 'governance',
    title: 'Selected instructions conflict on force-push policy',
    message: 'One selected instruction prohibits force-push while another appears to allow it.',
    path: instruction.path,
    remediation: 'Make the policy consistent across selected instruction roots.',
  }))
}

function scoreDimensions(findings: Finding[]): DimensionScore[] {
  return SCORE_DIMENSIONS.map((dimension) => {
    const penalty = findings
      .filter((finding) => finding.dimension === dimension)
      .reduce((total, finding) => total + SEVERITY_PENALTY[finding.severity], 0)
    return { dimension, score: Math.max(0, 100 - penalty) }
  })
}

function weightedScore(dimensions: DimensionScore[]): number {
  const weightedTotal = dimensions.reduce(
    (total, dimension) => total + dimension.score * DIMENSION_WEIGHTS[dimension.dimension],
    0,
  )
  const weightTotal = dimensions.reduce((total, dimension) => total + DIMENSION_WEIGHTS[dimension.dimension], 0)
  return Math.round(weightedTotal / weightTotal)
}

function frontmatterField(content: string, fieldName: string): string | null {
  if (!content.startsWith('---')) return null
  const end = content.indexOf('\n---', 3)
  if (end === -1) return null
  const frontmatter = content.slice(3, end)
  const pattern = new RegExp(`^${fieldName}:\\s*(.+)$`, 'im')
  const match = frontmatter.match(pattern)
  if (!match?.[1]) return null
  return match[1].trim().replace(/^['"]|['"]$/g, '')
}

function lineForOffset(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/).length
}
