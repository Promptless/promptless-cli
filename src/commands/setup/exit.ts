import type { BillingStatus } from '../../lib/setup-api'

// The exit block: a short summary printed to stdout in the normal scrollback,
// so it stays after the prompts are gone. Shape from PostHog's exit line (MIT,
// github.com/PostHog/wizard src/ui/tui/exit-line.ts).

export interface ExitBlockInput {
  appBaseUrl: string
  apiBaseUrl: string
  docsRepo: string
  sourceRepos: string[] | 'all'
  billing: BillingStatus | null
  /** The trigger a backfill was started for, or null when none was started. */
  backfillTriggerKey: string | null
}

export type ExitLineKind = 'headline' | 'dashboard' | 'trial' | 'backfill' | 'next_steps' | 'next_step'

export interface ExitLine {
  kind: ExitLineKind
  text: string
}

/** `15 Oct 2026`, in UTC so the date matches the stored trial end. */
export function formatTrialEnd(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

/** Assemble the exit block. The trial line appears only while the organization is trialing. */
export function buildExitBlock(input: ExitBlockInput): ExitLine[] {
  const watched = input.sourceRepos === 'all' ? 'every repository the GitHub App can see' : input.sourceRepos.join(', ')
  const lines: ExitLine[] = [
    {
      kind: 'headline',
      text: `✔ Promptless is watching ${watched}. Documentation updates arrive as pull requests on ${input.docsRepo}.`,
    },
    { kind: 'dashboard', text: `Dashboard: ${input.appBaseUrl}/configuration` },
  ]

  if (input.billing?.status === 'trialing' && input.billing.trial_end !== null) {
    lines.push({
      kind: 'trial',
      text: `Free trial ends ${formatTrialEnd(input.billing.trial_end)}. Add a card at ${input.appBaseUrl}/settings/billing`,
    })
  }
  if (input.backfillTriggerKey !== null) {
    lines.push({
      kind: 'backfill',
      text: `Backfill progress: ${input.appBaseUrl}/configuration (trigger ${input.backfillTriggerKey})`,
    })
  }

  lines.push({ kind: 'next_steps', text: 'Next steps' })
  if (input.backfillTriggerKey === null) {
    const where = input.sourceRepos === 'all' ? 'a watched repository' : input.sourceRepos.join(' or ')
    lines.push({ kind: 'next_step', text: `  • Merge a pull request in ${where} to see a first suggestion.` })
  }
  lines.push(
    { kind: 'next_step', text: `  • Connect Slack, Jira, or Linear: ${input.appBaseUrl}/integrations` },
    {
      kind: 'next_step',
      text: `  • Let your coding agent use Promptless: claude mcp add --transport http promptless ${input.apiBaseUrl}/mcp`,
    },
  )
  return lines
}

/** Join the exit block into the text written to stdout, with a leading blank line. */
export function renderExitBlock(lines: ExitLine[]): string {
  return `\n${lines.map((line) => line.text).join('\n')}\n`
}
