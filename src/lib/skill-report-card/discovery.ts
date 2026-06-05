import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type {
  DiscoveredInstruction,
  DiscoveryResult,
  InstructionKind,
} from './types'

interface SearchRoot {
  path: string
  maxDepth: number
}

export interface DiscoveryOptions {
  includeMachineScan: boolean
  maxDepth: number
  maxDirectories: number
  homeDirectory?: string
}

interface DiscoveryState {
  itemsByRealPath: Map<string, DiscoveredInstruction>
  scannedRoots: string[]
  seenDirectories: Set<string>
  visitedDirectoryCount: number
  truncated: boolean
  homeDirectory: string
  maxDirectories: number
}

const ROOT_INSTRUCTION_FILES = new Set(['AGENTS.md', 'CLAUDE.md'])
const AGENT_DIRECTORY_NAMES = new Set(['.agents', '.claude', '.codex'])
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.git',
  '.hg',
  '.next',
  '.npm',
  '.pnpm-store',
  '.svn',
  '.Trash',
  '.venv',
  'Applications',
  'build',
  'dist',
  'Library',
  'Movies',
  'Music',
  'node_modules',
  'Pictures',
  'target',
  'venv',
])

export async function discoverInstructions(
  targetPath: string,
  options: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const homeDirectory = options.homeDirectory ?? homedir()
  const state: DiscoveryState = {
    itemsByRealPath: new Map(),
    scannedRoots: [],
    seenDirectories: new Set(),
    visitedDirectoryCount: 0,
    truncated: false,
    homeDirectory,
    maxDirectories: options.maxDirectories,
  }

  for (const root of await buildSearchRoots(targetPath, options, homeDirectory)) {
    if (state.truncated) break
    await scanPath(root.path, root.maxDepth, state)
  }

  const items = [...state.itemsByRealPath.values()].sort((left, right) =>
    left.displayPath.localeCompare(right.displayPath),
  )
  return { items, scannedRoots: state.scannedRoots, truncated: state.truncated }
}

async function buildSearchRoots(
  targetPath: string,
  options: DiscoveryOptions,
  homeDirectory: string,
): Promise<SearchRoot[]> {
  const roots: SearchRoot[] = []
  const seen = new Set<string>()

  const addRoot = async (path: string, maxDepth: number): Promise<void> => {
    try {
      const resolved = await realpath(resolve(path))
      if (seen.has(resolved)) return
      seen.add(resolved)
      roots.push({ path: resolved, maxDepth })
    } catch {
      return
    }
  }

  await addRoot(targetPath, options.maxDepth)

  for (const path of [
    join(homeDirectory, '.agents'),
    join(homeDirectory, '.claude'),
    join(homeDirectory, '.codex'),
    join(homeDirectory, 'work'),
    join(homeDirectory, 'src'),
    join(homeDirectory, 'code'),
    join(homeDirectory, 'Code'),
    join(homeDirectory, 'Projects'),
    join(homeDirectory, 'Developer'),
  ]) {
    await addRoot(path, options.maxDepth)
  }

  if (options.includeMachineScan) {
    await addRoot(homeDirectory, Math.min(options.maxDepth, 6))
  }

  return roots
}

async function scanPath(path: string, maxDepth: number, state: DiscoveryState): Promise<void> {
  if (state.truncated) return

  let pathStat
  try {
    pathStat = await stat(path)
  } catch {
    return
  }

  if (pathStat.isFile()) {
    await maybeAddInstruction(path, state)
    return
  }

  if (!pathStat.isDirectory()) return
  state.scannedRoots.push(path)
  await scanDirectory(path, maxDepth, 0, state)
}

async function scanDirectory(
  directory: string,
  maxDepth: number,
  depth: number,
  state: DiscoveryState,
): Promise<void> {
  if (state.truncated || depth > maxDepth) return

  let realDirectory: string
  try {
    realDirectory = await realpath(directory)
  } catch {
    return
  }
  if (state.seenDirectories.has(realDirectory)) return
  state.seenDirectories.add(realDirectory)

  state.visitedDirectoryCount += 1
  if (state.visitedDirectoryCount > state.maxDirectories) {
    state.truncated = true
    return
  }

  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (state.truncated) return
    const childPath = join(directory, entry.name)
    if (entry.isFile()) {
      await maybeAddInstruction(childPath, state)
    } else if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue
      await scanDirectory(childPath, maxDepth, depth + 1, state)
    } else if (entry.isSymbolicLink()) {
      await maybeScanSymbolicFile(childPath, state)
    }
  }
}

async function maybeScanSymbolicFile(path: string, state: DiscoveryState): Promise<void> {
  try {
    const linkStat = await lstat(path)
    if (!linkStat.isSymbolicLink()) return
    const target = await stat(path)
    if (target.isFile()) await maybeAddInstruction(path, state)
  } catch {
    return
  }
}

function shouldSkipDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORY_NAMES.has(name)
}

async function maybeAddInstruction(path: string, state: DiscoveryState): Promise<void> {
  const name = basename(path)
  const kind = instructionKind(path, name)
  if (!kind) return

  let realFilePath: string
  let sizeBytes = 0
  try {
    realFilePath = await realpath(path)
    const fileStat = await stat(path)
    sizeBytes = fileStat.size
  } catch {
    return
  }
  if (state.itemsByRealPath.has(realFilePath)) return

  const rootPath = rootPathForInstruction(realFilePath, kind)
  state.itemsByRealPath.set(realFilePath, {
    id: realFilePath,
    path: realFilePath,
    rootPath,
    displayPath: displayPath(realFilePath, state.homeDirectory),
    title: titleForInstruction(realFilePath, kind),
    kind,
    sizeBytes,
  })
}

function instructionKind(path: string, name: string): InstructionKind | null {
  if (ROOT_INSTRUCTION_FILES.has(name)) {
    return name === 'AGENTS.md' ? 'agents-md' : 'claude-md'
  }
  if (name !== 'SKILL.md') return null

  const segments = path.split(sep)
  const agentRootIndex = agentSkillRootIndex(segments)
  if (agentRootIndex === -1) return null
  const rootSegment = segments[agentRootIndex]
  if (rootSegment === '.agents') return 'agent-skill'
  if (rootSegment === '.claude') return 'claude-skill'
  if (rootSegment === '.codex') return 'codex-skill'
  return null
}

function rootPathForInstruction(path: string, kind: InstructionKind): string {
  if (kind === 'agents-md' || kind === 'claude-md') return dirname(path)

  const segments = path.split(sep)
  const agentRootIndex = agentSkillRootIndex(segments)
  if (agentRootIndex === -1) return dirname(path)
  return segments.slice(0, agentRootIndex + 1).join(sep) || sep
}

function agentSkillRootIndex(segments: string[]): number {
  return segments.findIndex((segment, index) => {
    return AGENT_DIRECTORY_NAMES.has(segment) && segments[index + 1] === 'skills'
  })
}

function titleForInstruction(path: string, kind: InstructionKind): string {
  if (kind === 'agents-md') return 'AGENTS.md'
  if (kind === 'claude-md') return 'CLAUDE.md'
  return basename(dirname(path))
}

function displayPath(path: string, homeDirectory: string): string {
  const relativeToHome = relative(homeDirectory, path)
  if (relativeToHome && !relativeToHome.startsWith('..') && !relativeToHome.startsWith(sep)) {
    return join('~', relativeToHome)
  }
  return path
}
