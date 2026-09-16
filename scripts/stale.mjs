/** Is the bundle in /Applications behind the repo, and how the reminder reads (#88).
 *  Pure: the caller does the git and the stat, so this can be tested without either. */

/** `2026-09-15 10:49`, local time — the reminder is read next to "I merged just now". */
export function when(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}

/** The short sha out of `mnemo-desktop 0.1.0 (9f3ab21, built 2026-09-15 13:49 UTC)`. */
export function shaOfVersionLine(line) {
  return /\(([0-9a-f]{7,40}),/.exec(line || '')?.[1] ?? null
}

/**
 * The line to print, or null to say nothing.
 * @param installed  null when /Applications/mnemo.app is not there — then we stay quiet, the
 *   maintainer may simply not run the app from /Applications. `behind` is how many commits of
 *   `main` the installed build is missing, or null when nothing in the bundle said which
 *   commit it is (a bundle installed before this script existed): then `at` vs. `mainAt` is
 *   all we have, which is what the issue asked for.
 * @param mainAt  when the tip of main was committed.
 */
export function staleReminder(installed, mainAt) {
  if (!installed) return null
  const { at, behind } = installed
  if (behind === 0) return null
  if (behind === null && !(at < mainAt)) return null
  const count = behind === null ? '' : ` (${behind} commit${behind === 1 ? '' : 's'})`
  return `bundle installed at ${when(at)} is behind main${count}; run \`pnpm run install-app\``
}
