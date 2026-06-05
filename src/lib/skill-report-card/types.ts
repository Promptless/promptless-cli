export type InstructionKind =
  | 'agents-md'
  | 'claude-md'
  | 'agent-skill'
  | 'claude-skill'
  | 'codex-skill'

export type FindingSeverity = 'blocker' | 'should-fix' | 'nice-to-have'

export type FindingSource = 'promptless' | 'skill-validator' | 'llm'

export type ScoreDimension =
  | 'structure'
  | 'triggering'
  | 'specificity'
  | 'governance'
  | 'safety'
  | 'evaluation'
  | 'portability'

export type LlmProvider = 'off' | 'auto' | 'claude' | 'codex'

export type ResolvedLlmProvider = 'claude' | 'codex'

export interface DiscoveredInstruction {
  id: string
  path: string
  rootPath: string
  displayPath: string
  title: string
  kind: InstructionKind
  sizeBytes: number
}

export interface DiscoveryResult {
  items: DiscoveredInstruction[]
  scannedRoots: string[]
  truncated: boolean
}

export interface LoadedInstruction extends DiscoveredInstruction {
  content: string
  lineCount: number
  estimatedTokens: number
}

export interface Finding {
  severity: FindingSeverity
  source: FindingSource
  dimension: ScoreDimension
  title: string
  message: string
  path: string
  line?: number
  remediation?: string
}

export interface DimensionScore {
  dimension: ScoreDimension
  score: number
}

export interface InstructionScore {
  instruction: LoadedInstruction
  score: number
  grade: string
  verdict: 'ship' | 'revise' | 'block'
  dimensions: DimensionScore[]
  findings: Finding[]
}

export interface ProviderAvailability {
  claude: boolean
  codex: boolean
}

export interface LlmUsageEstimate {
  inputTokens: number
  outputTokens: number
}

export interface LlmReviewResult {
  provider: ResolvedLlmProvider
  findings: Finding[]
  rawSummary: string | null
}

export interface SkillValidatorSummary {
  available: boolean
  checkedCount: number
  findings: Finding[]
  skippedReason?: string
}

export interface ReportSummary {
  score: number
  grade: string
  blockerCount: number
  shouldFixCount: number
  niceToHaveCount: number
  instructionCount: number
  skillCount: number
  rootInstructionCount: number
}

export interface SkillReportCard {
  schemaVersion: 'promptless.skill-report-card.v1'
  generatedAt: string
  targetPath: string
  htmlPath: string
  discovery: DiscoveryResult
  selectedInstructions: LoadedInstruction[]
  scores: InstructionScore[]
  summary: ReportSummary
  validator: SkillValidatorSummary
  llm: LlmReviewResult | null
}
