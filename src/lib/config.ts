import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type ConfigFileShape = Record<string, string>

// Resolution order:
//   1. $PROMPTLESS_CLI_DEVELOPER_CONFIG_FILE  (escape hatch for devs / tests)
//   2. $XDG_CONFIG_HOME/promptless/env        (if XDG_CONFIG_HOME is set)
//   3. ~/.config/promptless/env               (default)
export function resolveConfigFilePath(): string {
  const developerOverride = process.env.PROMPTLESS_CLI_DEVELOPER_CONFIG_FILE
  if (developerOverride && developerOverride.length > 0) return developerOverride

  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  const base =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : join(homedir(), '.config')
  return join(base, 'promptless', 'env')
}

function parseEnvFile(contents: string): ConfigFileShape {
  const result: ConfigFileShape = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

function serializeEnvFile(values: ConfigFileShape): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${value}`)
  }
  return lines.join('\n') + '\n'
}

export function loadConfigFile(): ConfigFileShape {
  const path = resolveConfigFilePath()
  if (!existsSync(path)) return {}
  return parseEnvFile(readFileSync(path, 'utf8'))
}

export function saveConfigFile(values: ConfigFileShape): void {
  const path = resolveConfigFilePath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, serializeEnvFile(values), { mode: 0o600 })
  // writeFileSync `mode` only applies on file creation, so re-apply for safety.
  try {
    chmodSync(path, 0o600)
  } catch {
    // ignore on platforms that don't honor unix perms
  }
}

export function deleteConfigFileIfExists(): boolean {
  const path = resolveConfigFilePath()
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}

// Env var always wins over config file, so users can override per-shell.
export function getApiSecret(): string | undefined {
  const envValue = process.env.PROMPTLESS_CLI_API_SECRET
  if (envValue && envValue.length > 0) return envValue
  const config = loadConfigFile()
  return config.PROMPTLESS_CLI_API_SECRET
}
