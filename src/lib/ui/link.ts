// OSC 8 hyperlinks carry the exact target out of band, so a URL that the
// terminal wraps stays clickable as one link. Escape layout from PostHog's
// link helpers (MIT, github.com/PostHog/wizard src/ui/tui/primitives/link-helpers.ts).

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)
const OSC_8 = `${ESC}]8;;`

interface LinkStream {
  isTTY?: boolean
}

/**
 * Render `url` for `stream` (stderr by default). On a TTY the result is an
 * OSC 8 hyperlink showing `label`; terminals without OSC 8 support show the
 * label as plain text. Off a TTY, or with `TERM=dumb`, the result is plain
 * text that still contains the full URL.
 */
export function link(url: string, label: string = url, stream: LinkStream = process.stderr): string {
  if (stream.isTTY !== true || process.env.TERM === 'dumb') {
    return label === url ? url : `${label} (${url})`
  }
  return `${OSC_8}${url}${BEL}${label}${OSC_8}${BEL}`
}
