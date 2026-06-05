import { strict as assert } from 'node:assert'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverInstructions } from './discovery'
import { estimateLlmUsage } from './providers'
import { formatTerminalSummary, writeHtmlReport } from './render'
import { loadInstructions, scoreInstructions, summarizeScores } from './scoring'
import type { SkillReportCard } from './types'
import { runSkillValidator } from './validator'

test('discovers root instructions and hidden skill directories', async () => {
  const root = makeTempDirectory()
  try {
    writeFileSync(join(root, 'AGENTS.md'), 'Run tests before committing.\n', 'utf-8')
    mkdirSync(join(root, '.agents', 'skills', 'review-docs'), { recursive: true })
    writeFileSync(join(root, '.agents', 'skills', 'review-docs', 'SKILL.md'), goodSkill(), 'utf-8')

    const discovery = await discoverInstructions(root, {
      includeMachineScan: false,
      maxDepth: 5,
      maxDirectories: 100,
      homeDirectory: join(root, 'home'),
    })

    assert.equal(discovery.items.length, 2)
    assert.deepEqual(
      discovery.items.map((item) => item.kind).sort(),
      ['agent-skill', 'agents-md'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('skips generated worktree and plugin cache copies during broad scans', async () => {
  const root = makeTempDirectory()
  try {
    const homeDirectory = join(root, 'home')
    const projectDirectory = join(homeDirectory, 'project')
    const codexSkillDirectory = join(homeDirectory, '.codex', 'skills', 'personal')
    const worktreeSkillDirectory = join(
      homeDirectory,
      '.codex',
      'worktrees',
      'c5f4',
      'project',
      '.agents',
      'skills',
      'copied',
    )
    const pluginSkillDirectory = join(
      homeDirectory,
      '.claude',
      'plugins',
      'cache',
      'vendor',
      '1.0.0',
      '.claude',
      'skills',
      'cached',
    )
    const codexTempSkillDirectory = join(
      homeDirectory,
      '.codex',
      '.tmp',
      'plugins',
      'vendor',
      'skills',
      'cached',
    )
    const customerRepoSkillDirectory = join(
      homeDirectory,
      '.codex',
      'customer-repos',
      'acme',
      '.agents',
      'skills',
      'copied',
    )
    mkdirSync(projectDirectory, { recursive: true })
    mkdirSync(codexSkillDirectory, { recursive: true })
    mkdirSync(worktreeSkillDirectory, { recursive: true })
    mkdirSync(pluginSkillDirectory, { recursive: true })
    mkdirSync(codexTempSkillDirectory, { recursive: true })
    mkdirSync(customerRepoSkillDirectory, { recursive: true })
    writeFileSync(join(projectDirectory, 'AGENTS.md'), 'Run tests before committing.\n', 'utf-8')
    writeFileSync(join(codexSkillDirectory, 'SKILL.md'), goodSkill(), 'utf-8')
    writeFileSync(join(worktreeSkillDirectory, 'SKILL.md'), unsafeSkill(), 'utf-8')
    writeFileSync(join(pluginSkillDirectory, 'SKILL.md'), unsafeSkill(), 'utf-8')
    writeFileSync(join(codexTempSkillDirectory, 'SKILL.md'), unsafeSkill(), 'utf-8')
    writeFileSync(join(customerRepoSkillDirectory, 'SKILL.md'), unsafeSkill(), 'utf-8')

    const discovery = await discoverInstructions(projectDirectory, {
      includeMachineScan: true,
      maxDepth: 8,
      maxDirectories: 1000,
      homeDirectory,
    })

    assert.equal(discovery.items.some((item) => item.path.includes('/.codex/worktrees/')), false)
    assert.equal(discovery.items.some((item) => item.path.includes('/.codex/.tmp/')), false)
    assert.equal(discovery.items.some((item) => item.path.includes('/.codex/customer-repos/')), false)
    assert.equal(discovery.items.some((item) => item.path.includes('/.claude/plugins/cache/')), false)
    assert.ok(discovery.items.some((item) => item.path.endsWith('/project/AGENTS.md')))
    assert.ok(discovery.items.some((item) => item.path.endsWith('/.codex/skills/personal/SKILL.md')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('keeps explicit targets inside generated worktree paths', async () => {
  const root = makeTempDirectory()
  try {
    const homeDirectory = join(root, 'home')
    const worktreeProject = join(homeDirectory, '.codex', 'worktrees', 'c5f4', 'project')
    mkdirSync(worktreeProject, { recursive: true })
    writeFileSync(join(worktreeProject, 'AGENTS.md'), 'Run tests before committing.\n', 'utf-8')

    const discovery = await discoverInstructions(worktreeProject, {
      includeMachineScan: false,
      maxDepth: 4,
      maxDirectories: 100,
      homeDirectory,
    })

    assert.deepEqual(
      discovery.items.map((item) => item.displayPath),
      ['~/.codex/worktrees/c5f4/project/AGENTS.md'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('scores unsafe and stale skills below strong skills', () => {
  const root = makeTempDirectory()
  try {
    mkdirSync(join(root, '.agents', 'skills', 'good'), { recursive: true })
    mkdirSync(join(root, '.agents', 'skills', 'unsafe'), { recursive: true })
    const goodPath = join(root, '.agents', 'skills', 'good', 'SKILL.md')
    const unsafePath = join(root, '.agents', 'skills', 'unsafe', 'SKILL.md')
    writeFileSync(goodPath, goodSkill(), 'utf-8')
    writeFileSync(unsafePath, unsafeSkill(), 'utf-8')

    const loaded = loadInstructions([
      {
        id: goodPath,
        path: goodPath,
        rootPath: join(root, '.agents'),
        displayPath: goodPath,
        title: 'good',
        kind: 'agent-skill',
        sizeBytes: 1,
      },
      {
        id: unsafePath,
        path: unsafePath,
        rootPath: join(root, '.agents'),
        displayPath: unsafePath,
        title: 'unsafe',
        kind: 'agent-skill',
        sizeBytes: 1,
      },
    ])

    const scores = scoreInstructions(loaded, [])
    const goodScore = scores.find((score) => score.instruction.path === goodPath)
    const unsafeScore = scores.find((score) => score.instruction.path === unsafePath)

    assert.ok(goodScore)
    assert.ok(unsafeScore)
    assert.equal(goodScore.verdict, 'ship')
    assert.equal(unsafeScore.verdict, 'block')
    assert.ok(unsafeScore.score < goodScore.score)
    assert.ok(unsafeScore.findings.some((finding) => finding.dimension === 'safety'))
    assert.ok(summarizeScores(scores).score <= 84)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('renders terminal and HTML reports', () => {
  const root = makeTempDirectory()
  try {
    const skillPath = join(root, 'SKILL.md')
    const htmlPath = join(root, 'report.html')
    writeFileSync(skillPath, goodSkill(), 'utf-8')
    const loaded = loadInstructions([
      {
        id: skillPath,
        path: skillPath,
        rootPath: root,
        displayPath: skillPath,
        title: 'good',
        kind: 'agent-skill',
        sizeBytes: 1,
      },
    ])
    const scores = scoreInstructions(loaded, [])
    const report: SkillReportCard = {
      schemaVersion: 'promptless.skill-report-card.v1',
      generatedAt: '2026-06-05T00:00:00.000Z',
      targetPath: root,
      htmlPath,
      discovery: { items: [], scannedRoots: [root], truncated: false },
      selectedInstructions: loaded,
      scores,
      summary: summarizeScores(scores),
      validator: { available: false, checkedCount: 0, findings: [] },
      llm: null,
    }

    const terminal = formatTerminalSummary(report)
    writeHtmlReport(report)
    const html = readFileSync(htmlPath, 'utf-8')

    assert.match(terminal, /Promptless Skill Report Card/)
    assert.match(terminal, /HTML report:/)
    assert.match(html, /Instruction Scores/)
    assert.match(html, /skill-validator/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('estimates LLM usage from selected content', () => {
  const root = makeTempDirectory()
  try {
    const skillPath = join(root, 'SKILL.md')
    writeFileSync(skillPath, goodSkill(), 'utf-8')
    const loaded = loadInstructions([
      {
        id: skillPath,
        path: skillPath,
        rootPath: root,
        displayPath: skillPath,
        title: 'good',
        kind: 'agent-skill',
        sizeBytes: 1,
      },
    ])

    const estimate = estimateLlmUsage(loaded)
    assert.ok(estimate.inputTokens > loaded[0].estimatedTokens)
    assert.ok(estimate.outputTokens >= 1200)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parses skill-validator level fields without turning passes into findings', () => {
  const root = makeTempDirectory()
  const originalPath = process.env.PATH
  try {
    const binDirectory = join(root, 'bin')
    const skillDirectory = join(root, '.agents', 'skills', 'good')
    mkdirSync(binDirectory, { recursive: true })
    mkdirSync(skillDirectory, { recursive: true })
    const validatorPath = join(binDirectory, 'skill-validator')
    const skillPath = join(skillDirectory, 'SKILL.md')
    writeFileSync(skillPath, goodSkill(), 'utf-8')
    writeFileSync(
      validatorPath,
      `#!/usr/bin/env node
console.log(JSON.stringify({
  results: [
    { level: "pass", category: "Structure", message: "SKILL.md found" },
    { level: "warning", category: "Links", message: "optional reference missing" }
  ]
}))
`,
      'utf-8',
    )
    chmodSync(validatorPath, 0o755)
    process.env.PATH = `${binDirectory}:${originalPath ?? ''}`

    const loaded = loadInstructions([
      {
        id: skillPath,
        path: skillPath,
        rootPath: join(root, '.agents'),
        displayPath: skillPath,
        title: 'good',
        kind: 'agent-skill',
        sizeBytes: 1,
      },
    ])

    const summary = runSkillValidator(loaded)
    assert.equal(summary.available, true)
    assert.equal(summary.checkedCount, 1)
    assert.equal(summary.findings.length, 1)
    assert.equal(summary.findings[0].title, 'Links')
  } finally {
    process.env.PATH = originalPath
    rmSync(root, { recursive: true, force: true })
  }
})

function makeTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'promptless-skill-report-card-test-'))
}

function goodSkill(): string {
  return `---
description: Use when reviewing documentation changes for accuracy and style.
---

## Workflow

1. Read the changed documentation.
2. Check claims against linked sources.
3. Verify formatting and local commands.

## Output

Return concrete findings with file paths, severity, and remediation.
`
}

function unsafeSkill(): string {
  return `---
description: Deploy production fixes.
---

Run rm -rf dist and push --force when deployment gets stuck.

TODO: replace this old workflow later.
`
}
