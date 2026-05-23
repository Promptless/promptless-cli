# Command reference

Every command accepts `-h` / `--help` and prints its own usage. The tables below summarize what is shipping today.

## Authentication

| Command | Description |
|---|---|
| `promptless login` | Open a browser, complete the Clerk flow, and cache an API key |
| `promptless logout` | Remove the cached API key (and the file, if it ends up empty) |
| `promptless whoami` | Print the user and organizations associated with the current key |

Config-file location and env-var precedence are documented in [Configuration](configuration.md). The protocol between the CLI and the Promptless web app is documented in [CLI auth protocol](cli-auth-protocol.md).

## Suggestions

| Command | Description |
|---|---|
| `promptless suggestions [filters]` | List docs suggestions (default: 10 most recent, status=pr_open) |
| `promptless suggestions --stat [filters]` | Same list with a `git diff --stat`-style per-file breakdown |
| `promptless suggestions --id <id>` | Show a single suggestion in full, including the file list and stats |
| `promptless suggestions --json [filters]` | Emit JSON for scripting |

Filter flags: `--status` (repeatable; one of `ready`, `pr_open`, `published`, `closed`, or `any`), `--location`, `--trigger`, `--label`, `--assignee`, `--page`, `--since`, `--until`, `-q/--query` (dashboard-syntax filter expression). Limit flags: `-n/--limit`, `--all`, `--offset`. See [Suggestions](suggestions.md) for details.

## Local linting

| Command | Description |
|---|---|
| `promptless slop-cop <file>...` | Detect LLM prose tells in text files; runs entirely locally |
| `promptless slop-cop --debug <file>...` | Verbose debug output for rule authors |
| `promptless slop-cop --format <fmt> <file>...` | Force the input parser (`auto`, `text`, `markdown`, `mdx`, `pandoc`) |

Exit codes: `0` clean, `1` violations found, `2` argument error. `slop-cop` is the only command that does no network I/O.

## Web tools

| Command | Description |
|---|---|
| `promptless agentview <url>` | Fetch a page and print the markdown a coding agent will read |
| `promptless agentview <url> -o <file>` | Write the extracted markdown to a file instead of stdout |

## Shell integration

| Command | Description |
|---|---|
| `promptless completion zsh` | Print a zsh completion script |
| `promptless completion bash` | Print a bash completion script |
| `promptless completion fish` | Print a fish completion script |

Pipe the output into the appropriate location for your shell — e.g. `promptless completion zsh > ~/.zsh/completion/_promptless`.

## Global conventions

- Every command also responds to the short alias `pless`.
- Authenticated commands resolve the API key in this order: `$PROMPTLESS_CLI_API_SECRET`, then the cached config file. See [Configuration](configuration.md).
- Authenticated commands exit non-zero with a pointer back to `promptless login` if the key is missing or rejected — they never fall through to anonymous access.
- JSON output, where supported, is a single JSON value on stdout. Diagnostics go to stderr so `| jq` is safe.
