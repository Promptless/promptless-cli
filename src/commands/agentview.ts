import TurndownService from 'turndown'

const HELP = `promptless agentview — fetch a docs page and show what a coding agent sees

usage:
  promptless agentview <url>

arguments:
  <url>                 HTTP/HTTPS URL of the page to fetch

options:
  -o, --output <file>  Write markdown to a file instead of stdout
  -h, --help           Show this help

examples:
  promptless agentview https://docs.example.com/guide
  promptless agentview https://docs.example.com/api -o api-docs.md
`

function extractMainContent(html: string): string {
  // Prefer <main>, fall back to <article>, then <body>
  const main = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/i)
  if (main) return main[1]
  const article = html.match(/<article\b[^>]*>([\s\S]*)<\/article>/i)
  if (article) return article[1]
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)
  return body ? body[1] : html
}

async function _run(argv: string[]): Promise<void> {
  let url: string | undefined
  let outputFile: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP)
      process.exit(0)
    } else if ((arg === '-o' || arg === '--output') && i + 1 < argv.length) {
      outputFile = argv[++i]
    } else if (!arg.startsWith('-')) {
      url = arg
    } else {
      process.stderr.write(`promptless agentview: unknown option ${arg}\n`)
      process.exit(2)
    }
  }

  if (!url) {
    process.stderr.write(HELP)
    process.exit(2)
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    process.stderr.write(`promptless agentview: invalid URL: ${url}\n`)
    process.exit(2)
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    process.stderr.write(`promptless agentview: only http/https URLs are supported\n`)
    process.exit(2)
  }

  process.stderr.write(`Fetching ${url} ...\n`)

  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'promptless-agentview/0.1' },
      redirect: 'follow',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`promptless agentview: fetch failed: ${msg}\n`)
    process.exit(1)
  }

  if (!res.ok) {
    process.stderr.write(`promptless agentview: HTTP ${res.status} ${res.statusText}\n`)
    process.exit(1)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    process.stderr.write(`promptless agentview: warning: content-type is "${contentType}"\n`)
  }

  const html = await res.text()
  const content = extractMainContent(html)

  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
  })

  // Strip chrome — keep only the readable doc content
  td.remove(['script', 'style', 'nav', 'noscript', 'iframe', 'aside', 'header', 'footer'])

  const markdown = td.turndown(content)

  if (outputFile) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(outputFile, markdown + '\n', 'utf8')
    process.stderr.write(`Saved to ${outputFile}\n`)
    process.exit(0)
  }

  process.stdout.write(markdown + '\n')
  process.exit(0)
}

export function runAgentView(argv: string[]): never {
  void _run(argv).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`promptless agentview: ${msg}\n`)
    process.exit(1)
  })
  return undefined as never
}
