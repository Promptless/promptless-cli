import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import type { Finding, LoadedInstruction, SkillValidatorSummary } from './types'

const DEFAULT_MAX_VALIDATOR_CHECKS = 40

interface ValidatorResultEntry {
  name: string | null
  status: string | null
  message: string | null
}

export function runSkillValidator(
  instructions: LoadedInstruction[],
  maxChecks = DEFAULT_MAX_VALIDATOR_CHECKS,
): SkillValidatorSummary {
  if (!commandExists('skill-validator')) {
    return { available: false, checkedCount: 0, findings: [] }
  }

  const skillInstructions = instructions.filter((instruction) => instruction.kind.endsWith('skill'))
  if (skillInstructions.length > maxChecks) {
    return {
      available: true,
      checkedCount: 0,
      findings: [],
      skippedReason: `selection includes ${skillInstructions.length} skills; validator cap is ${maxChecks}`,
    }
  }

  const findings: Finding[] = []
  let checkedCount = 0

  for (const instruction of skillInstructions) {
    const result = spawnSync(
      'skill-validator',
      ['check', dirname(instruction.path), '--output', 'json', '--allow-extra-frontmatter'],
      { encoding: 'utf-8', timeout: 30000 },
    )

    checkedCount += 1
    if (result.error) {
      findings.push({
        severity: 'should-fix',
        source: 'skill-validator',
        dimension: 'structure',
        title: 'skill-validator could not run',
        message: result.error.message,
        path: instruction.path,
        remediation: 'Run skill-validator manually for more detail.',
      })
      continue
    }

    const parsedEntries = parseValidatorEntries(result.stdout)
    if (parsedEntries.length === 0 && result.status !== 0) {
      findings.push({
        severity: 'should-fix',
        source: 'skill-validator',
        dimension: 'structure',
        title: 'skill-validator reported an issue',
        message: firstUsefulLine(result.stderr) ?? firstUsefulLine(result.stdout) ?? 'The validator exited with a non-zero status.',
        path: instruction.path,
        remediation: 'Run skill-validator manually for the full validation output.',
      })
      continue
    }

    for (const entry of parsedEntries) {
      const status = entry.status?.toLowerCase()
      if (status === 'passed' || status === 'pass' || status === 'ok') continue
      findings.push({
        severity: status === 'failed' || status === 'fail' || status === 'error' ? 'should-fix' : 'nice-to-have',
        source: 'skill-validator',
        dimension: 'structure',
        title: entry.name ?? 'skill-validator finding',
        message: entry.message ?? 'skill-validator flagged this skill.',
        path: instruction.path,
        remediation: 'Run skill-validator manually for detailed remediation guidance.',
      })
    }
  }

  return { available: true, checkedCount, findings }
}

export function commandExists(command: string): boolean {
  const result = spawnSync('which', [command], { encoding: 'utf-8' })
  return result.status === 0 && result.stdout.trim().length > 0
}

function parseValidatorEntries(stdout: string): ValidatorResultEntry[] {
  const parsed = parseJsonObject(stdout)
  if (!parsed) return []

  const results = readArrayProperty(parsed, 'results')
  if (results.length === 0) return []

  return results.map((entry) => ({
    name:
      readStringProperty(entry, 'name') ??
      readStringProperty(entry, 'check') ??
      readStringProperty(entry, 'title') ??
      readStringProperty(entry, 'category'),
    status: readStringProperty(entry, 'status') ?? readStringProperty(entry, 'level'),
    message: readStringProperty(entry, 'message') ?? readStringProperty(entry, 'details'),
  }))
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function readArrayProperty(object: Record<string, unknown>, property: string): Record<string, unknown>[] {
  const value = object[property]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is Record<string, unknown> => {
    return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
  })
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
