import { runSlopCop } from './slop-cop'
import { runCompletion } from './completion'
import { runAgentView } from './agentview'

export interface CommandEntry {
  name: string
  summary: string
  run: (argv: string[]) => never
}

export const COMMANDS: CommandEntry[] = [
  {
    name: 'slop-cop',
    summary: 'Detect LLM prose tells in text files',
    run: runSlopCop,
  },
  {
    name: 'agentview',
    summary: 'Fetch a docs page and show the markdown a coding agent sees',
    run: runAgentView,
  },
  {
    name: 'completion',
    summary: 'Print a shell completion script (zsh, bash, fish)',
    run: runCompletion,
  },
]
