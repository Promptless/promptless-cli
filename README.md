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

A CLI for helping tech writers. Right now it only detects the rhetorical and structural tells of LLM-generated prose and surfaces diagnostics for people to fix.

## Install

Requires Node.js 22+ and npm. Pandoc is optional, used only for non-markdown formats (`.rst`, `.org`, `.adoc`, `.tex`, …).

Set up Promptless for your repositories without installing anything:

```sh
npx -y @promptless/cli@latest setup
```

Or install the `promptless` binary globally:

```sh
npm i -g @promptless/cli
promptless slop-cop sample.md
promptless slop-cop --debug sample.md
```

### Or clone and run locally

```sh
git clone git@github.com:Promptless/promptless-cli.git
cd promptless-cli
npm install
npm run promptless -- slop-cop path/to/file.md
```

## Usage

```
promptless <command> [options]
```

Run `promptless --help` for the command list and `promptless <command> --help` for each command's options.

`slop-cop` exit codes: `0` clean, `1` violations found, `2` argument error.

## Releasing

Pushing a `v*` tag whose version matches `package.json` runs `.github/workflows/release.yml`, which publishes to npm with provenance and creates a GitHub release.

The first publish of `@promptless/cli` is manual: an owner of the `promptless` npm organization runs `npm publish --access public` from a clean checkout of the tagged commit. After the package exists, configure this repository and `release.yml` as its trusted publisher on npmjs.com, so later releases publish from the workflow through OIDC with no npm token.

## License

[MPL-2.0](./LICENSE)
