<p align="center" style="padding-top:32px;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-text-v1-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-text-v1.png">
    <img src="assets/logo-text-v1.png" alt="promptless cli" width="300">
  </picture>
</p>

<p align="center">
   <a href="./docs/index">Get Started</a> · 
   <a href="./docs">Docs</a> · 
   <a href="example.com">Slack</a>
<p>

A CLI for helping tech writers and agent-instruction maintainers. It can detect
the rhetorical and structural tells of LLM-generated prose, and it can generate
a local report card for agent skills and instruction files.

## Install

Requires Node.js 20+ and npm. Pandoc is optional, used only for non-markdown formats (`.rst`, `.org`, `.adoc`, `.tex`, …).

### Install globally from GitHub

```sh
npm install -g github:Promptless/promptless-cli
```

Or with an explicit git URL (useful in CI):

```sh
npm install -g git+https://github.com/Promptless/promptless-cli.git
# or over SSH:
npm install -g git+ssh://git@github.com/Promptless/promptless-cli.git
```

This exposes two binaries on your `PATH`: `promptless` and `pless`.

```sh
promptless slop-cop sample.md
promptless skill-report-card
```

> The repo is currently internal — you'll need GitHub access to `Promptless/promptless-cli` for the install to fetch.

### Or clone and run locally

```sh
git clone git@github.com:Promptless/promptless-cli.git
cd promptless-cli
npm install
npm run promptless -- slop-cop path/to/file.md
npm run promptless -- skill-report-card
```

## Usage

```
promptless <command> [options]
```

Run `promptless --help` for the command list.

### `promptless slop-cop`

Detect LLM prose tells in text files and print editor-friendly diagnostics.

```sh
promptless slop-cop docs/page.md
promptless slop-cop --format mdx docs/page.mdx
```

### `promptless skill-report-card`

Generate a local report card for agent instruction files and skills.

```sh
promptless skill-report-card
```

The default flow is interactive:

1. Searches the current directory, common home config locations, and bounded
   machine locations for `AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`, and
   `.codex/` instruction assets. Generated copies under Codex worktrees, temp
   plugin storage, customer-repo clones, and plugin caches are skipped during
   broad scans.
2. Groups discovered files by skill-bearing Git repo or global skill location,
   then lets you check or uncheck those groups. Instruction-only groups are
   shown only when no skills are found.
3. Detects whether `claude` or `codex` CLIs are installed.
4. Shows an estimated LLM token count if a provider is available.
5. Runs deterministic local checks, uses `skill-validator` when it is installed,
   prints an inline summary, and writes `promptless-skill-report-card.html`.

Useful noninteractive examples:

```sh
promptless skill-report-card . --yes --llm off
promptless skill-report-card ~/work/docs-agent --llm codex --out report.html
promptless skill-report-card . --yes --fail-under 80
```

Privacy: deterministic checks are local. File contents are only sent to an LLM
when you explicitly choose `claude`, `codex`, or pass `--llm auto|claude|codex`.

Attribution: `skill-report-card` uses
[`skill-validator`](https://github.com/agent-ecosystem/skill-validator) as an
internal component when the binary is available on `PATH`. Promptless adds the
interactive report-card UX, governance scoring, and HTML report.

Exit codes: `0` clean or report generated, `1` runtime/input error, `2`
argument error or `--fail-under` threshold failure.

## License

[MPL-2.0](./LICENSE)
