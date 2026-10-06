import { COMMANDS } from './registry'

const USAGE = `promptless completion — print a shell completion script

usage:
  promptless completion <shell>

shells:
  zsh    zsh completion
  bash   bash completion
  fish   fish completion

installation hints:
  zsh (persistent):
    promptless completion zsh > "\${fpath[1]}/_promptless" && compinit
  zsh (one-off in current shell):
    source <(promptless completion zsh)
  bash (persistent, Homebrew layout):
    promptless completion bash > $(brew --prefix)/etc/bash_completion.d/promptless
  bash (one-off):
    source <(promptless completion bash)
  fish:
    promptless completion fish > ~/.config/fish/completions/promptless.fish

exit codes:
  0   script printed
  2   missing or unknown shell
`

function zshDescribe(s: string): string {
  // `_describe` uses `name:description`; escape colons and single quotes for safety.
  return s.replace(/'/g, "'\\''").replace(/:/g, '\\:')
}

function fishDescribe(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function zshScript(): string {
  const items = COMMANDS.map((c) => `    '${c.name}:${zshDescribe(c.summary)}'`).join('\n')
  return `#compdef promptless
# Completion for \`promptless\`. Regenerate via \`promptless completion zsh\`.
# Install (persistent):
#   promptless completion zsh > "\${fpath[1]}/_promptless" && compinit
# One-off for current shell:
#   source <(promptless completion zsh)

local context curcontext="$curcontext" state line
local -a subcommands
subcommands=(
${items}
)

_arguments -C \\
  '1: :->subcommand' \\
  '*::arg:->args'

case $state in
  subcommand)
    _describe 'subcommand' subcommands
    ;;
  args)
    case \${line[1]} in
      slop-cop)
        _arguments \\
          '--debug[show debug view with [N] category markers]' \\
          '--color[force ANSI color on]' \\
          '--no-color[force ANSI color off]' \\
          '--format[input format]:fmt:(auto text markdown mdx pandoc)' \\
          '--from[pandoc input format]:fmt:' \\
          '(-h --help)'{-h,--help}'[show help]' \\
          '*:file:_files'
        ;;
      completion)
        _arguments '1:shell:(zsh bash fish)'
        ;;
      login)
        _arguments \\
          '--no-browser[do not open a browser; print URL only]' \\
          '(-h --help)'{-h,--help}'[show help]'
        ;;
      logout)
        _arguments '(-h --help)'{-h,--help}'[show help]'
        ;;
      whoami)
        _arguments \\
          '--json[output JSON]' \\
          '(-h --help)'{-h,--help}'[show help]'
        ;;
      setup)
        ;;
    esac
    ;;
esac
`
}

function bashScript(): string {
  const commandNames = COMMANDS.map((c) => c.name).join(' ')
  return `# Bash completion for \`promptless\`. Regenerate via \`promptless completion bash\`.
# Install (Homebrew layout):
#   promptless completion bash > $(brew --prefix)/etc/bash_completion.d/promptless
# One-off for current shell:
#   source <(promptless completion bash)

_promptless_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local cword=$COMP_CWORD
  local commands="${commandNames}"

  if [ "$cword" -eq 1 ]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return
  fi

  case "\${COMP_WORDS[1]}" in
    slop-cop)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "--debug --color --no-color --format --from -h --help" -- "$cur"))
      else
        COMPREPLY=($(compgen -f -- "$cur"))
      fi
      ;;
    completion)
      COMPREPLY=($(compgen -W "zsh bash fish" -- "$cur"))
      ;;
    login)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "--no-browser -h --help" -- "$cur"))
      fi
      ;;
    logout)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "-h --help" -- "$cur"))
      fi
      ;;
    whoami)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "--json -h --help" -- "$cur"))
      fi
      ;;
    setup)
      COMPREPLY=()
      ;;
  esac
}

complete -F _promptless_complete promptless
`
}

function fishScript(): string {
  const lines: string[] = [
    '# Fish completion for `promptless`. Regenerate via `promptless completion fish`.',
    '# Install:',
    '#   promptless completion fish > ~/.config/fish/completions/promptless.fish',
    '',
    'complete -c promptless -f',
  ]
  for (const c of COMMANDS) {
    lines.push(
      `complete -c promptless -n __fish_use_subcommand -a ${c.name} -d '${fishDescribe(c.summary)}'`,
    )
  }
  lines.push(
    "complete -c promptless -n '__fish_seen_subcommand_from slop-cop' -l debug -d 'Show debug view with [N] markers'",
    "complete -c promptless -n '__fish_seen_subcommand_from slop-cop' -l color -d 'Force ANSI color on'",
    "complete -c promptless -n '__fish_seen_subcommand_from slop-cop' -l no-color -d 'Force ANSI color off'",
    "complete -c promptless -n '__fish_seen_subcommand_from slop-cop' -l format -x -a 'auto text markdown mdx pandoc' -d 'Input format'",
    "complete -c promptless -n '__fish_seen_subcommand_from slop-cop' -l from -x -d 'Pandoc input format'",
    "complete -c promptless -n '__fish_seen_subcommand_from slop-cop' -s h -l help -d 'Show help'",
    "complete -c promptless -n '__fish_seen_subcommand_from slop-cop' -F",
    "complete -c promptless -n '__fish_seen_subcommand_from completion' -a 'zsh bash fish'",
    "complete -c promptless -n '__fish_seen_subcommand_from login' -l no-browser -d 'Do not open a browser'",
    "complete -c promptless -n '__fish_seen_subcommand_from login' -s h -l help -d 'Show help'",
    "complete -c promptless -n '__fish_seen_subcommand_from logout' -s h -l help -d 'Show help'",
    "complete -c promptless -n '__fish_seen_subcommand_from whoami' -l json -d 'Output JSON'",
    "complete -c promptless -n '__fish_seen_subcommand_from whoami' -s h -l help -d 'Show help'",
    '',
  )
  return lines.join('\n')
}

export function runCompletion(argv: string[]): never {
  const shell = argv[0]

  if (shell === '-h' || shell === '--help') {
    process.stdout.write(USAGE)
    process.exit(0)
  }

  if (!shell) {
    process.stderr.write(USAGE)
    process.exit(2)
  }

  if (shell === 'zsh') {
    process.stdout.write(zshScript())
    process.exit(0)
  }
  if (shell === 'bash') {
    process.stdout.write(bashScript())
    process.exit(0)
  }
  if (shell === 'fish') {
    process.stdout.write(fishScript())
    process.exit(0)
  }

  process.stderr.write(
    `promptless completion: unknown shell '${shell}'. Expected zsh, bash, or fish.\n`,
  )
  process.exit(2)
}
