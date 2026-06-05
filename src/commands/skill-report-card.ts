import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import prompts from 'prompts'
import { discoverInstructions } from '../lib/skill-report-card/discovery'
import { detectProviders, estimateLlmUsage, resolveRequestedProvider, runLlmReview } from '../lib/skill-report-card/providers'
import { formatTerminalSummary, writeHtmlReport } from '../lib/skill-report-card/render'
import { loadInstructions, scoreInstructions, summarizeScores } from '../lib/skill-report-card/scoring'
import {
  groupInstructionsForSelection,
  groupsForInteractivePrompt,
} from '../lib/skill-report-card/selectionGroups'
import { runSkillValidator } from '../lib/skill-report-card/validator'
import type {
  DiscoveredInstruction,
  LlmProvider,
  LlmReviewResult,
  LoadedInstruction,
  ProviderAvailability,
  ResolvedLlmProvider,
  SkillReportCard,
} from '../lib/skill-report-card/types'

type PromptLlmProvider = LlmProvider | 'prompt'

interface Args {
  targetPath: string
  showHelp: boolean
  yes: boolean
  llm: PromptLlmProvider
  htmlPath: string
  openReport: boolean
  includeMachineScan: boolean
  maxDepth: number
  maxDirectories: number
  failUnder: number | null
}

const DEFAULT_HTML_FILE = 'promptless-skill-report-card.html'

const HELP = `promptless skill-report-card — score local agent instructions and skills

usage:
  promptless skill-report-card [path] [options]

options:
  --yes, -y              Run without prompts. Selects all discovered files and skips LLM review unless --llm is set.
  --llm <provider>       LLM review provider: off, auto, claude, codex. Default is an interactive choice.
  --out <file>           HTML report path. Default: ./${DEFAULT_HTML_FILE}
  --no-open              Do not open the generated HTML report.
  --no-machine-scan      Only scan the provided/current path and common home agent config locations.
  --max-depth <n>        Directory recursion depth per scan root. Default: 8.
  --max-directories <n>  Stop discovery after visiting this many directories. Default: 25000.
  --fail-under <score>   Exit 2 if the overall score is below this 0-100 threshold.
  -h, --help             Show this help

examples:
  promptless skill-report-card
  promptless skill-report-card ~/work/docs-agent --llm codex
  promptless skill-report-card . --yes --llm off --fail-under 80
`

export async function runSkillReportCard(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  if (args.showHelp) {
    process.stdout.write(HELP)
    return
  }

  const interactive = args.yes ? false : process.stdin.isTTY === true && process.stdout.isTTY === true
  process.stdout.write('\nPromptless Skill Report Card\n\nLooking for agent instructions...\n')

  const discovery = await discoverInstructions(args.targetPath, {
    includeMachineScan: args.includeMachineScan,
    maxDepth: args.maxDepth,
    maxDirectories: args.maxDirectories,
  })

  if (discovery.items.length === 0) {
    process.stderr.write('promptless skill-report-card: no AGENTS.md, CLAUDE.md, or SKILL.md files found.\n')
    process.exitCode = 1
    return
  }

  process.stdout.write(
    `Found ${discovery.items.length} instruction file${plural(discovery.items.length)} across ${discovery.scannedRoots.length} scan root${plural(discovery.scannedRoots.length)}${discovery.truncated ? ' before hitting the scan cap' : ''}.\n`,
  )

  const selectionGroups = groupInstructionsForSelection(discovery.items)
  const promptGroups = groupsForInteractivePrompt(selectionGroups)
  if (interactive) {
    process.stdout.write(
      `Grouped into ${promptGroups.length} repo/location option${plural(promptGroups.length)}.\n`,
    )
  }

  const selectedItems = await selectInstructions(discovery.items, promptGroups, interactive)
  if (selectedItems.length === 0) {
    process.stderr.write('promptless skill-report-card: no instruction files selected.\n')
    process.exitCode = 1
    return
  }

  const loadedInstructions = loadInstructions(selectedItems)
  const providers = detectProviders()
  const selectedProvider = await chooseProvider(args.llm, providers, loadedInstructions, interactive)

  process.stdout.write('\nGenerating report card...\n')
  process.stdout.write('✓ Reading selected instruction files\n')

  const validator = runSkillValidator(loadedInstructions)
  if (validator.skippedReason) {
    process.stdout.write(`• Skipped skill-validator: ${validator.skippedReason}\n`)
  } else if (validator.available) {
    process.stdout.write(`✓ Ran skill-validator on ${validator.checkedCount} skill${plural(validator.checkedCount)}\n`)
  } else {
    process.stdout.write('• skill-validator not found; continuing with Promptless checks\n')
  }

  const llm = selectedProvider ? runOptionalLlmReview(selectedProvider, loadedInstructions) : null
  if (llm) {
    process.stdout.write(`✓ Added ${llm.provider} review findings\n`)
  }

  const scores = scoreInstructions(loadedInstructions, [...validator.findings, ...(llm?.findings ?? [])])
  const report: SkillReportCard = {
    schemaVersion: 'promptless.skill-report-card.v1',
    generatedAt: new Date().toISOString(),
    targetPath: resolve(args.targetPath),
    htmlPath: resolve(args.htmlPath),
    discovery,
    selectedInstructions: loadedInstructions,
    scores,
    summary: summarizeScores(scores),
    validator,
    llm,
  }

  writeHtmlReport(report)
  process.stdout.write('✓ Wrote HTML report\n')
  process.stdout.write(formatTerminalSummary(report))

  if (interactive && args.openReport) openHtmlReport(report.htmlPath)
  if (args.failUnder !== null && report.summary.score < args.failUnder) process.exitCode = 2
}

function parseArgs(argv: string[]): Args {
  let showHelp = false
  let yes = false
  let llm: PromptLlmProvider = 'prompt'
  let htmlPath = DEFAULT_HTML_FILE
  let openReport = true
  let includeMachineScan = true
  let maxDepth = 8
  let maxDirectories = 25000
  let failUnder: number | null = null
  const positional: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') showHelp = true
    else if (arg === '--yes' || arg === '-y') yes = true
    else if (arg === '--no-open') openReport = false
    else if (arg === '--no-machine-scan') includeMachineScan = false
    else if (arg === '--llm' || arg.startsWith('--llm=')) {
      const value = readFlagValue(argv, index, '--llm')
      if (!arg.includes('=')) index += 1
      if (value !== 'off' && value !== 'auto' && value !== 'claude' && value !== 'codex') {
        exitArgError('--llm expects one of: off, auto, claude, codex')
      }
      llm = value
    } else if (arg === '--out' || arg.startsWith('--out=')) {
      htmlPath = readFlagValue(argv, index, '--out')
      if (!arg.includes('=')) index += 1
    } else if (arg === '--max-depth' || arg.startsWith('--max-depth=')) {
      maxDepth = readPositiveIntegerFlag(argv, index, '--max-depth')
      if (!arg.includes('=')) index += 1
    } else if (arg === '--max-directories' || arg.startsWith('--max-directories=')) {
      maxDirectories = readPositiveIntegerFlag(argv, index, '--max-directories')
      if (!arg.includes('=')) index += 1
    } else if (arg === '--fail-under' || arg.startsWith('--fail-under=')) {
      failUnder = readScoreFlag(argv, index, '--fail-under')
      if (!arg.includes('=')) index += 1
    } else if (arg.startsWith('-')) {
      exitArgError(`unknown flag ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  if (positional.length > 1) exitArgError('expected at most one path')

  return {
    targetPath: positional[0] ?? process.cwd(),
    showHelp,
    yes,
    llm,
    htmlPath,
    openReport,
    includeMachineScan,
    maxDepth,
    maxDirectories,
    failUnder,
  }
}

async function selectInstructions(
  items: DiscoveredInstruction[],
  groups: ReturnType<typeof groupInstructionsForSelection>,
  interactive: boolean,
): Promise<DiscoveredInstruction[]> {
  if (!interactive) return items

  const response = await prompts(
    {
      type: 'multiselect',
      name: 'selectedIds',
      message: 'Select repos and skill locations to include in this report',
      hint: 'Space to toggle, enter to continue',
      choices: groups.map((group) => ({
        title: group.label,
        value: group.id,
        selected: true,
      })),
      min: 1,
    },
    {
      onCancel: () => {
        process.stdout.write('\nCancelled.\n')
        process.exit(1)
      },
    },
  )

  const selectedIds = readSelectedIds(response)
  return groups
    .filter((group) => selectedIds.has(group.id))
    .flatMap((group) => group.items)
}

async function chooseProvider(
  requested: PromptLlmProvider,
  availability: ProviderAvailability,
  instructions: LoadedInstruction[],
  interactive: boolean,
): Promise<ResolvedLlmProvider | null> {
  if (requested === 'off') return null

  const estimate = estimateLlmUsage(instructions)
  if (requested !== 'prompt') {
    const provider = resolveRequestedProvider(requested, availability)
    if (!provider) {
      process.stdout.write(
        `• Requested LLM provider unavailable. Found claude: ${availability.claude ? 'yes' : 'no'}, codex: ${availability.codex ? 'yes' : 'no'}.\n`,
      )
    }
    return provider
  }

  if (!interactive) return null

  const choices = [{ title: 'Skip LLM review', value: 'off' }]
  if (availability.claude) choices.push({ title: 'Use Claude CLI', value: 'claude' })
  if (availability.codex) choices.push({ title: 'Use Codex CLI', value: 'codex' })

  if (choices.length === 1) {
    process.stdout.write('\nLLM review\nNo claude or codex CLI detected; skipping LLM review.\n')
    return null
  }

  process.stdout.write(
    `\nLLM review\nFound: claude ${availability.claude ? '✓' : 'not found'}, codex ${availability.codex ? '✓' : 'not found'}\nEstimated usage: ~${estimate.inputTokens.toLocaleString()} input tokens, ~${estimate.outputTokens.toLocaleString()} output tokens.\n`,
  )

  const response = await prompts(
    {
      type: 'select',
      name: 'provider',
      message: 'Choose review mode',
      choices,
      initial: 0,
    },
    {
      onCancel: () => {
        process.stdout.write('\nCancelled.\n')
        process.exit(1)
      },
    },
  )

  const provider = readProviderChoice(response)
  return provider === 'off' ? null : provider
}

function runOptionalLlmReview(
  provider: ResolvedLlmProvider,
  instructions: LoadedInstruction[],
): LlmReviewResult | null {
  try {
    return runLlmReview(provider, instructions)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`promptless skill-report-card: ${provider} review failed: ${message}\n`)
    return null
  }
}

function openHtmlReport(htmlPath: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawnSync(opener, [htmlPath], { stdio: 'ignore' })
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const arg = argv[index]
  const value = arg.includes('=') ? arg.slice(flag.length + 1) : argv[index + 1]
  if (!value || value.startsWith('-')) exitArgError(`${flag} expects a value`)
  return value
}

function readPositiveIntegerFlag(argv: string[], index: number, flag: string): number {
  const value = Number(readFlagValue(argv, index, flag))
  if (!Number.isInteger(value) || value < 1) exitArgError(`${flag} expects a positive integer`)
  return value
}

function readScoreFlag(argv: string[], index: number, flag: string): number {
  const value = Number(readFlagValue(argv, index, flag))
  if (!Number.isInteger(value) || value < 0 || value > 100) exitArgError(`${flag} expects an integer from 0 to 100`)
  return value
}

function readSelectedIds(response: unknown): Set<string> {
  if (!response || typeof response !== 'object' || !('selectedIds' in response)) return new Set()
  const selectedIds = (response as { selectedIds: unknown }).selectedIds
  if (!Array.isArray(selectedIds)) return new Set()
  return new Set(selectedIds.filter((value): value is string => typeof value === 'string'))
}

function readProviderChoice(response: unknown): 'off' | ResolvedLlmProvider {
  if (!response || typeof response !== 'object' || !('provider' in response)) return 'off'
  const provider = (response as { provider: unknown }).provider
  return provider === 'claude' || provider === 'codex' ? provider : 'off'
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}

function exitArgError(message: string): never {
  process.stderr.write(`promptless skill-report-card: ${message}\n\n${HELP}`)
  process.exit(2)
}
