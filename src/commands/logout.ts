import { unlinkSync } from 'node:fs'

import { loadConfigFile, resolveConfigFilePath, saveConfigFile } from '../lib/config'

const HELP = `promptless logout — remove the cached API key

usage:
  promptless logout [options]

options:
  -h, --help   Show this help

description:
  Removes PROMPTLESS_CLI_API_SECRET from the config file. If the file ends
  up empty, the file itself is deleted. This does not revoke the key on
  the server — revoke it from the Promptless web app if you need to.
`

function _run(argv: string[]): void {
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP)
      process.exit(0)
    } else {
      process.stderr.write(`promptless logout: unknown option ${arg}\n`)
      process.exit(2)
    }
  }

  const path = resolveConfigFilePath()
  const config = loadConfigFile()

  if (!config.PROMPTLESS_CLI_API_SECRET) {
    process.stderr.write('promptless logout: no API key in config — already logged out\n')
    process.exit(0)
  }

  delete config.PROMPTLESS_CLI_API_SECRET

  if (Object.keys(config).length === 0) {
    try {
      unlinkSync(path)
    } catch {
      // file may have already been removed externally
    }
  } else {
    saveConfigFile(config)
  }

  process.stderr.write(`Removed API key from ${path}\n`)
  if (process.env.PROMPTLESS_CLI_API_SECRET) {
    process.stderr.write(
      'Note: PROMPTLESS_CLI_API_SECRET is also set in your environment. Unset it to fully log out of this shell.\n',
    )
  }
  process.exit(0)
}

export function runLogout(argv: string[]): never {
  _run(argv)
  return undefined as never
}
