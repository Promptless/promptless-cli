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

### `setup`

`promptless setup` connects a GitHub organization to Promptless and starts keeping one documentation repository current from merged pull requests. Run it in an interactive terminal, ideally from a clone of a repository whose merges should update the docs:

```sh
npx -y @promptless/cli@latest setup
```

The command runs these steps in order:

1. **Sign in.** Setup reuses the saved API key when it still works. Otherwise it opens the sign-in page in your browser and waits for the key, as `promptless login` does.
2. **Connect GitHub.** When the organization has no GitHub App installation, setup opens the install page and checks every 3 seconds until the installation arrives, for up to 30 minutes. Choose "I can't connect right now" to stop; nothing is changed.
3. **Find your documentation.** Setup reads the `origin` remote of the current directory, asks Promptless which installed repository holds the docs, and preselects the best match.
4. **Choose source repositories.** Pick the repositories whose merged pull requests update the docs. The current directory's repository is preselected.
5. **Review.** Setup shows the resulting `promptless.yaml` and applies it only after you choose Apply. Setup then completes onboarding, which starts the free trial.
6. **First suggestion.** Setup offers to run Promptless on the last 7 days of merged pull requests in the source repositories. It starts the run and does not wait for it.

| Flag | Effect |
| --- | --- |
| `--org <id>` | Run against this organization. When the saved key belongs to another organization, setup signs in again with this organization preselected on the sign-in page. |
| `--docs-repo <owner/repo>` | Use this documentation repository instead of asking. |
| `--source-repo <owner/repo>` | Watch this repository instead of asking. Repeat the flag for several repositories. |
| `--trigger-on <event>` | The pull request events that update the docs: `opened`, `first_approval`, `merge`, or `updated`. Repeat the flag or separate events with commas. The default is `merge`. |
| `--backfill` | Run on the last 7 days of merged pull requests without asking. |
| `--new-account` | Open the sign-up page instead of the sign-in page. |
| `--no-browser` | Print links instead of opening them. |

**What setup writes.** Setup writes nothing to the current repository. Promptless adds one doc collection and one `github_pr` trigger with an explicit repository list to `promptless.yaml` in your organization's Promptless knowledge-base repository. The only local file setup writes is the API key in the `promptless login` config file.

**Running setup again.** Setup skips every step that is already done: a working saved key, an existing GitHub installation, an existing doc collection and pull request trigger, and completed onboarding. A second run on a finished organization changes nothing and prints the dashboard link. To watch more repositories, run it again with `--source-repo`.

**Errors.** Setup exits `0` when it finishes, `1` when it stops, and `2` for an argument error. Every stop also prints one line on stderr that a script can parse:

```
promptless-error: {"code":"github_not_connected","message":"..."}
```

The codes are listed in `src/lib/errors.ts`. Codes are only ever added. Without an interactive terminal, setup exits `1` with the code `interactive_terminal_required`.

`PROMPTLESS_API_BASE_URL` and `PROMPTLESS_APP_BASE_URL` point setup at a local runtime and dashboard.

## Releasing

Pushing a `v*` tag whose version matches `package.json` runs `.github/workflows/release.yml`, which publishes to npm with provenance and creates a GitHub release.

The first publish of `@promptless/cli` is manual: an owner of the `promptless` npm organization runs `npm publish --access public` from a clean checkout of the tagged commit. After the package exists, configure this repository and `release.yml` as its trusted publisher on npmjs.com, so later releases publish from the workflow through OIDC with no npm token.

## License

[MPL-2.0](./LICENSE)
