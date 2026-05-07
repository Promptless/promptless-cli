import { COMMANDS } from './registry'

const USAGE = `promptless completion — print a shell completion script

usage:
  promptless completion <shell>

shells:
  zsh    zsh completion (bound to both \`promptless\` and \`pless\`)
  bash   bash completion
  fish   fish completion

installation hints:
  zsh (persistent):
    pless completion zsh > "\${fpath[1]}/_promptless" && compinit
  zsh (one-off in current shell):
    source <(pless completion zsh)
  bash (persistent, Homebrew layout):
    pless completion bash > $(brew --prefix)/etc/bash_completion.d/promptless
  bash (one-off):
    source <(pless completion bash)
  fish:
    pless completion fish > ~/.config/fish/completions/promptless.fish
    pless completion fish > ~/.config/fish/completions/pless.fish

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
  return `#compdef promptless pless
# Completion for \`promptless\` / \`pless\`. Regenerate via \`pless completion zsh\`.
# Install (persistent):
#   pless completion zsh > "\${fpath[1]}/_promptless" && compinit
# One-off for current shell:
#   source <(pless completion zsh)

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
    esac
    ;;
esac
`
}

function bashScript(): string {
  const commandNames = COMMANDS.map((c) => c.name).join(' ')
  return `# Bash completion for \`promptless\` / \`pless\`. Regenerate via \`pless completion bash\`.
# Install (Homebrew layout):
#   pless completion bash > $(brew --prefix)/etc/bash_completion.d/promptless
# One-off for current shell:
#   source <(pless completion bash)

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
  esac
}

complete -F _promptless_complete promptless
complete -F _promptless_complete pless
`
}

function fishScript(): string {
  const lines: string[] = [
    '# Fish completion for `promptless` / `pless`. Regenerate via `pless completion fish`.',
    '# Install:',
    '#   pless completion fish > ~/.config/fish/completions/promptless.fish',
    '#   pless completion fish > ~/.config/fish/completions/pless.fish',
    '',
  ]
  for (const bin of ['promptless', 'pless']) {
    lines.push(`complete -c ${bin} -f`)
    for (const c of COMMANDS) {
      lines.push(
        `complete -c ${bin} -n __fish_use_subcommand -a ${c.name} -d '${fishDescribe(c.summary)}'`,
      )
    }
    lines.push(
      `complete -c ${bin} -n '__fish_seen_subcommand_from slop-cop' -l debug -d 'Show debug view with [N] markers'`,
    )
    lines.push(
      `complete -c ${bin} -n '__fish_seen_subcommand_from slop-cop' -l color -d 'Force ANSI color on'`,
    )
    lines.push(
      `complete -c ${bin} -n '__fish_seen_subcommand_from slop-cop' -l no-color -d 'Force ANSI color off'`,
    )
    lines.push(
      `complete -c ${bin} -n '__fish_seen_subcommand_from slop-cop' -l format -x -a 'auto text markdown mdx pandoc' -d 'Input format'`,
    )
    lines.push(
      `complete -c ${bin} -n '__fish_seen_subcommand_from slop-cop' -l from -x -d 'Pandoc input format'`,
    )
    lines.push(
      `complete -c ${bin} -n '__fish_seen_subcommand_from slop-cop' -s h -l help -d 'Show help'`,
    )
    lines.push(`complete -c ${bin} -n '__fish_seen_subcommand_from slop-cop' -F`)
    lines.push(
      `complete -c ${bin} -n '__fish_seen_subcommand_from completion' -a 'zsh bash fish'`,
    )
    lines.push('')
  }
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
