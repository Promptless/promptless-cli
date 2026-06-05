#!/usr/bin/env node
import { COMMANDS } from './commands/registry'

// Planned subcommands (the CLI is a Swiss-army toolkit for tech writers — not a one-trick
// linter). Add an entry to COMMANDS in ./commands/registry.ts once the implementation lands,
// and extend ./commands/completion.ts so shell completion knows about the new flags.
//
//   traces       Pull agent traces from remote machines back here for eval runs.
//   docs-audit   Audit a docs site / repo for coverage, staleness, and drift.
//   event        POST text to the Promptless API to fire an ad-hoc docs-agent run.
//
// Naming conventions: lowercase, kebab-case, noun-ish when the command names the artifact
// it operates on (traces, event), verb-noun when the operation is the point (docs-audit).

const commandNameWidth = Math.max(...COMMANDS.map((command) => command.name.length)) + 2

const TOP_HELP = `promptless — CLI for tech writers

usage:
  promptless <command> [options]

commands:
${COMMANDS.map((c) => `  ${c.name.padEnd(commandNameWidth)} ${c.summary}`).join('\n')}

run \`promptless <command> --help\` for command-specific options.
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const first = argv[0]

  if (first === '-h' || first === '--help' || first === 'help') {
    process.stdout.write(TOP_HELP)
    process.exit(0)
  }

  if (!first) {
    process.stderr.write(TOP_HELP)
    process.exit(2)
  }

  const cmd = COMMANDS.find((c) => c.name === first)
  if (!cmd) {
    process.stderr.write(`promptless: unknown command '${first}'\n\n${TOP_HELP}`)
    process.exit(2)
  }

  await cmd.run(argv.slice(1))
}

main()
