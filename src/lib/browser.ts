import { spawn } from 'node:child_process'

/**
 * Open `url` in the default browser. Failures are ignored: every caller also
 * prints the URL, so the user can open it by hand.
 */
export function openInBrowser(url: string): void {
  let cmd: string
  let args: string[]
  if (process.platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    // A missing launcher surfaces as an async 'error' event, not a throw.
    child.on('error', () => {})
    child.unref()
  } catch {
    // If the launcher isn't available we just leave the printed URL for the user.
  }
}
