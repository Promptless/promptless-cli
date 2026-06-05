import { writeFileSync } from 'node:fs'
import type { Finding, InstructionScore, SkillReportCard } from './types'

const SEVERITY_ORDER: Record<Finding['severity'], number> = {
  blocker: 0,
  'should-fix': 1,
  'nice-to-have': 2,
}

export function writeHtmlReport(report: SkillReportCard): void {
  writeFileSync(report.htmlPath, renderHtmlReport(report), 'utf-8')
}

export function formatTerminalSummary(report: SkillReportCard): string {
  const topFindings = allFindings(report.scores).slice(0, 5)
  const lines = [
    '',
    'Promptless Skill Report Card',
    '',
    `Overall: ${report.summary.grade}  ${report.summary.score}/100`,
    '',
    'Reviewed:',
    `  ${report.summary.skillCount} skills`,
    `  ${report.summary.rootInstructionCount} root instruction files`,
    `  ${report.discovery.scannedRoots.length} scanned roots${report.discovery.truncated ? ' (scan capped)' : ''}`,
    '',
    'Findings:',
    `  ${report.summary.blockerCount} blocker${plural(report.summary.blockerCount)}`,
    `  ${report.summary.shouldFixCount} should fix`,
    `  ${report.summary.niceToHaveCount} nice to have`,
  ]

  if (topFindings.length > 0) {
    lines.push('', 'Top issues:')
    topFindings.forEach((finding, index) => {
      lines.push(
        `${index + 1}. ${severityLabel(finding.severity).padEnd(10)} ${finding.path}`,
        `   ${finding.title}`,
      )
    })
  } else {
    lines.push('', 'No findings above the report-card threshold.')
  }

  lines.push('', `HTML report: ${report.htmlPath}`, '')
  return lines.join('\n')
}

export function renderHtmlReport(report: SkillReportCard): string {
  const findings = allFindings(report.scores)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Promptless Skill Report Card</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #15171a;
      --muted: #606874;
      --line: #dfe3e8;
      --blocker: #b42318;
      --should: #9a5b00;
      --nice: #386641;
      --accent: #1f6feb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 20px 56px;
    }
    header {
      display: flex;
      gap: 24px;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--line);
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 30px; line-height: 1.15; }
    h2 { margin: 30px 0 12px; font-size: 18px; }
    h3 { font-size: 15px; }
    .meta { color: var(--muted); margin-top: 6px; }
    .grade {
      min-width: 140px;
      padding: 16px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      text-align: center;
    }
    .grade strong { display: block; font-size: 38px; line-height: 1; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }
    .metric, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .metric strong {
      display: block;
      font-size: 24px;
      margin-top: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
      background: #fbfcfd;
    }
    tr:last-child td { border-bottom: 0; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      word-break: break-word;
    }
    .finding {
      background: var(--panel);
      border: 1px solid var(--line);
      border-left-width: 4px;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 10px;
    }
    .finding.blocker { border-left-color: var(--blocker); }
    .finding.should-fix { border-left-color: var(--should); }
    .finding.nice-to-have { border-left-color: var(--nice); }
    .label {
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
      margin-right: 8px;
    }
    .blocker .label { color: var(--blocker); }
    .should-fix .label { color: var(--should); }
    .nice-to-have .label { color: var(--nice); }
    .small { color: var(--muted); font-size: 12px; }
    @media (max-width: 760px) {
      header { display: block; }
      .grade { margin-top: 16px; text-align: left; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table { font-size: 13px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Promptless Skill Report Card</h1>
        <p class="meta">Generated ${escapeHtml(report.generatedAt)} for <code>${escapeHtml(report.targetPath)}</code></p>
      </div>
      <div class="grade">
        <strong>${escapeHtml(report.summary.grade)}</strong>
        <span>${report.summary.score}/100</span>
      </div>
    </header>

    <section class="grid" aria-label="Summary">
      ${metric('Skills', String(report.summary.skillCount))}
      ${metric('Root Files', String(report.summary.rootInstructionCount))}
      ${metric('Blockers', String(report.summary.blockerCount))}
      ${metric('Should Fix', String(report.summary.shouldFixCount))}
    </section>

    <section>
      <h2>Instruction Scores</h2>
      <table>
        <thead>
          <tr><th>Instruction</th><th>Kind</th><th>Score</th><th>Verdict</th><th>Findings</th></tr>
        </thead>
        <tbody>
          ${report.scores.map(renderScoreRow).join('\n')}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Findings</h2>
      ${findings.length === 0 ? '<div class="panel">No findings above the report-card threshold.</div>' : findings.map(renderFinding).join('\n')}
    </section>

    <section>
      <h2>Run Details</h2>
      <div class="panel">
        <p><strong>Scanned roots:</strong> ${report.discovery.scannedRoots.length}${report.discovery.truncated ? ' (scan capped)' : ''}</p>
        <p><strong>skill-validator:</strong> ${
          report.validator.skippedReason
            ? `skipped, ${escapeHtml(report.validator.skippedReason)}`
            : report.validator.available
              ? `available, checked ${report.validator.checkedCount} skills`
              : 'not found on PATH; skipped'
        }</p>
        <p><strong>LLM review:</strong> ${
          report.llm ? `${escapeHtml(report.llm.provider)}${report.llm.rawSummary ? ` — ${escapeHtml(report.llm.rawSummary)}` : ''}` : 'not run'
        }</p>
        <p class="small">skill-validator is used as an internal component when available. Promptless scoring adds governance, safety, portability, and report-card presentation.</p>
      </div>
    </section>
  </main>
</body>
</html>`
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function renderScoreRow(score: InstructionScore): string {
  return `<tr>
    <td><code>${escapeHtml(score.instruction.displayPath)}</code></td>
    <td>${escapeHtml(score.instruction.kind)}</td>
    <td>${escapeHtml(score.grade)} ${score.score}/100</td>
    <td>${escapeHtml(score.verdict)}</td>
    <td>${score.findings.length}</td>
  </tr>`
}

function renderFinding(finding: Finding): string {
  const line = finding.line ? `:${finding.line}` : ''
  return `<article class="finding ${finding.severity}">
    <div><span class="label">${escapeHtml(severityLabel(finding.severity))}</span><span class="small">${escapeHtml(finding.source)} · ${escapeHtml(finding.dimension)}</span></div>
    <h3>${escapeHtml(finding.title)}</h3>
    <p>${escapeHtml(finding.message)}</p>
    <p class="small"><code>${escapeHtml(finding.path)}${line}</code></p>
    ${finding.remediation ? `<p><strong>Fix:</strong> ${escapeHtml(finding.remediation)}</p>` : ''}
  </article>`
}

function allFindings(scores: InstructionScore[]): Finding[] {
  return scores
    .flatMap((score) => score.findings)
    .sort((left, right) => {
      const severitySort = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      if (severitySort !== 0) return severitySort
      return left.path.localeCompare(right.path)
    })
}

function severityLabel(severity: Finding['severity']): string {
  if (severity === 'should-fix') return 'Should fix'
  if (severity === 'nice-to-have') return 'Nice'
  return 'Blocker'
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
