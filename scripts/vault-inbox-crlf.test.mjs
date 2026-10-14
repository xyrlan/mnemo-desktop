// #334's premise, where it can be run: `mnemo` is Python, and a Python that sets its streams
// up as mnemo's `cli/runtime.py` does (encoding only) ends every piped line in `\r\n` on
// Windows. Windows only: anywhere else the pipe carries `\n` and this would prove nothing.
// It lives here, not beside the parser, because `src` is type-checked without Node's types.
import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'
import { parseInboxListing } from '../src/vault/inbox.ts'

const LISTING = `3 staged pages for mnemo-desktop in shared/_inbox/ (median 6d, oldest 7d)

  reference/github-auth-via-gh-cli-not-oauth             demotion       7d  Use 'gh auth login --web' for authentication instead of implementing na…
  reference/dispatch-button-opens-bar-not-auto-dispatch  demotion       7d  Clicking a dispatch button in the UI should open a command entry, not i…
  reference/run-git-commands-yourself                    demotion       6d  Always run git and GitHub CLI commands yourself; never hand off to ano…

nothing was written — this is a listing only.
  (134 more staged for other projects — \`mnemo inbox --all\`)
`

const PRINT = 'import sys\nsys.stdout.reconfigure(encoding="utf-8", errors="replace")\nfor line in sys.stdin.buffer.read().decode("utf-8").split("\\n")[:-1]:\n    print(line)\n'

test.runIf(process.platform === 'win32')('a real Python on Windows prints the listing with \\r\\n, and the Inbox still reads its rows', () => {
  const r = spawnSync('python', ['-c', PRINT], { input: LISTING, encoding: 'utf8' })
  // A Windows machine with no `python` on PATH has nothing to show; CI has one and must run it.
  if (r.error && !process.env.CI) return
  expect(r.error).toBeUndefined()
  expect(r.status).toBe(0)
  expect(r.stdout).toBe(LISTING.replace(/\n/g, '\r\n'))
  const listing = parseInboxListing(r.stdout)
  expect(listing).toEqual(parseInboxListing(LISTING))
  expect(listing.rows.map((row) => row.key)).toEqual([
    'reference/github-auth-via-gh-cli-not-oauth',
    'reference/dispatch-button-opens-bar-not-auto-dispatch',
    'reference/run-git-commands-yourself',
  ])
  expect(listing.other).toBe(134)
})
