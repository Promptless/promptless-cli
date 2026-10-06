// Placeholder so `setup` is wired into the command table and shell completion.
export function runSetup(_argv: string[]): never {
  process.stderr.write('promptless setup: not available yet\n')
  process.exit(2)
}
