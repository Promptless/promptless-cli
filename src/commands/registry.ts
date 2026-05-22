import { runSlopCop } from './slop-cop'
import { runCompletion } from './completion'
import { runAgentView } from './agentview'
import { runLogin } from './login'
import { runLogout } from './logout'
import { runWhoami } from './whoami'

export interface CommandEntry {
  name: string
  summary: string
  run: (argv: string[]) => never
}

export const COMMANDS: CommandEntry[] = [
  {
    name: 'login',
    summary: 'Sign in and cache a long-lived API key for the CLI',
    run: runLogin,
  },
  {
    name: 'logout',
    summary: 'Remove the cached API key',
    run: runLogout,
  },
  {
    name: 'whoami',
    summary: 'Show the currently authenticated user',
    run: runWhoami,
  },
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
