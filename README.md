# promptless-cli

A CLI for helping tech writers. Right now it only detects the rhetorical and structural tells of LLM-generated prose and surfaces diagnostics for people to fix.

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
promptless sample.md
pless --diagnostic sample.md
```

> The repo is currently internal — you'll need GitHub access to `Promptless/promptless-cli` for the install to fetch.

### Or clone and run locally

```sh
git clone git@github.com:Promptless/promptless-cli.git
cd promptless-cli
npm install
npm run promptless -- path/to/file.md
```

## Usage

```
promptless [options] <file>...
```

Run `promptless --help` for the full option list (input format, color, diagnostic vs. human mode, pandoc passthrough).

Exit codes: `0` clean, `1` violations found, `2` argument error.

## License

[MPL-2.0](./LICENSE)
