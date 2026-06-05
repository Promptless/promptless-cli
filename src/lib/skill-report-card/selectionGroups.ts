import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { DiscoveredInstruction } from './types'

export type SelectionGroupKind = 'git-repo' | 'global-location' | 'directory'

export interface SelectionGroup {
  id: string
  kind: SelectionGroupKind
  label: string
  sortLabel: string
  path: string
  items: DiscoveredInstruction[]
  skillCount: number
  rootInstructionCount: number
}

interface GroupSeed {
  id: string
  kind: SelectionGroupKind
  labelPrefix: string | null
  path: string
  sortLabel: string
}

interface KnownLocation {
  id: string
  label: string
  pathSegments: string[]
}

const KNOWN_GLOBAL_LOCATIONS: KnownLocation[] = [
  { id: 'codex-user-skills', label: 'Codex user skills', pathSegments: ['.codex', 'skills'] },
  { id: 'codex-user-instructions', label: 'Codex user instructions', pathSegments: ['.codex'] },
  { id: 'claude-code-user-skills', label: 'Claude Code user skills', pathSegments: ['.claude', 'skills'] },
  { id: 'claude-code-user-instructions', label: 'Claude Code user instructions', pathSegments: ['.claude'] },
  { id: 'agent-user-skills', label: 'Agent user skills', pathSegments: ['.agents', 'skills'] },
  { id: 'agent-user-instructions', label: 'Agent user instructions', pathSegments: ['.agents'] },
]

export function groupInstructionsForSelection(
  items: DiscoveredInstruction[],
  homeDirectory = homedir(),
): SelectionGroup[] {
  const realHomeDirectory = realPathOrResolved(homeDirectory)
  const gitRootCache = new Map<string, string | null>()
  const groupsById = new Map<string, { seed: GroupSeed; items: DiscoveredInstruction[] }>()

  for (const item of items) {
    const seed = groupSeedForItem(item, realHomeDirectory, gitRootCache)
    const existing = groupsById.get(seed.id)
    if (existing) {
      existing.items.push(item)
    } else {
      groupsById.set(seed.id, { seed, items: [item] })
    }
  }

  return [...groupsById.values()]
    .map(({ seed, items: groupItems }) => {
      const skillCount = groupItems.filter((item) => item.kind.endsWith('skill')).length
      const rootInstructionCount = groupItems.length - skillCount
      return {
        id: seed.id,
        kind: seed.kind,
        label: groupLabel(seed, skillCount, rootInstructionCount, realHomeDirectory),
        sortLabel: seed.sortLabel,
        path: seed.path,
        items: groupItems.sort((left, right) => left.displayPath.localeCompare(right.displayPath)),
        skillCount,
        rootInstructionCount,
      }
    })
    .sort((left, right) => left.sortLabel.localeCompare(right.sortLabel))
}

export function groupsForInteractivePrompt(groups: SelectionGroup[]): SelectionGroup[] {
  const skillBearingGroups = groups.filter((group) => group.skillCount > 0)
  return skillBearingGroups.length > 0 ? skillBearingGroups : groups
}

function groupSeedForItem(
  item: DiscoveredInstruction,
  homeDirectory: string,
  gitRootCache: Map<string, string | null>,
): GroupSeed {
  const knownLocation = knownGlobalLocationForItem(item.path, homeDirectory)
  if (knownLocation) {
    const locationPath = join(homeDirectory, ...knownLocation.pathSegments)
    return {
      id: `global:${knownLocation.id}`,
      kind: 'global-location',
      labelPrefix: knownLocation.label,
      path: locationPath,
      sortLabel: `0:${knownLocation.id}`,
    }
  }

  const gitRoot = gitRootForItem(item, gitRootCache)
  if (gitRoot) {
    return {
      id: `repo:${gitRoot}`,
      kind: 'git-repo',
      labelPrefix: null,
      path: gitRoot,
      sortLabel: `1:${displayPath(gitRoot, homeDirectory)}`,
    }
  }

  return {
    id: `directory:${item.rootPath}`,
    kind: 'directory',
    labelPrefix: null,
    path: item.rootPath,
    sortLabel: `2:${displayPath(item.rootPath, homeDirectory)}`,
  }
}

function knownGlobalLocationForItem(path: string, homeDirectory: string): KnownLocation | null {
  const relativeSegments = relative(homeDirectory, path).split(sep)
  if (relativeSegments[0]?.startsWith('..') || relativeSegments[0] === '') return null

  return (
    KNOWN_GLOBAL_LOCATIONS.find((location) =>
      startsWithSegments(relativeSegments, location.pathSegments),
    ) ?? null
  )
}

function gitRootForItem(
  item: DiscoveredInstruction,
  gitRootCache: Map<string, string | null>,
): string | null {
  const directory = dirname(item.path)
  const cached = gitRootCache.get(directory)
  if (cached !== undefined) return cached

  const result = spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
    timeout: 5000,
  })
  const gitRoot = result.status === 0 ? realPathOrResolved(result.stdout.trim()) : null
  gitRootCache.set(directory, gitRoot)
  return gitRoot
}

function groupLabel(
  seed: GroupSeed,
  skillCount: number,
  rootInstructionCount: number,
  homeDirectory: string,
): string {
  const counts = [
    skillCount > 0 ? `${skillCount} skill${plural(skillCount)}` : null,
    rootInstructionCount > 0
      ? `${rootInstructionCount} instruction file${plural(rootInstructionCount)}`
      : null,
  ].filter((value): value is string => value !== null)
  const pathLabel = displayPath(seed.path, homeDirectory)
  const name = seed.labelPrefix ? `${seed.labelPrefix} (${pathLabel})` : pathLabel
  return `${name} (${counts.join(', ')})`
}

function displayPath(path: string, homeDirectory: string): string {
  const relativeToHome = relative(homeDirectory, path)
  if (relativeToHome && !relativeToHome.startsWith('..') && !relativeToHome.startsWith(sep)) {
    return join('~', relativeToHome)
  }
  return path
}

function startsWithSegments(segments: string[], prefix: string[]): boolean {
  return prefix.every((segment, index) => segments[index] === segment)
}

function realPathOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}
