/** What a snapshot's `errors` lines (`Snapshot.errors`, `HomeSnapshot.errors`) say, in words a
 *  person can act on (#367). The lines are the backend's: `claude agents …`, `mnemo sessions …`
 *  and `gh pr list …` failures, a JSON that did not parse, `history (…)`, each named by account
 *  when it is not the default one (`mission::on_account_error`). */

/** Which data the line is missing: where it is shown. */
export type ErrorSource = 'sessions' | 'children' | 'prs' | 'history' | 'other'

export type SnapshotError = {
  source: ErrorSource
  /** What could not be read, and what to do about it. */
  text: string
  /** The line as the backend said it. */
  detail: string
}

const ACCOUNT = /^account ([^:]+): /
/** A program that is not there: unix's `No such file or directory`, Windows' `cannot find the
 *  file`, a shell's `command not found`. */
const MISSING = /os error 2\b|no such file or directory|cannot find the file|command not found|program not found/i
const LOGGED_OUT = /gh auth login|not logged in|authentication|HTTP 401/i
const OFFLINE = /error connecting|could not resolve|dial tcp|no such host|network is unreachable|timed? ?out/i

const WHAT: Record<ErrorSource, string> = {
  sessions: 'Claude sessions could not be listed',
  children: 'Background children could not be listed',
  prs: 'Pull requests could not be read',
  history: "Claude's history could not be read",
  other: 'Something could not be read',
}

function sourceOf(line: string): ErrorSource {
  if (/^(claude\b|agents json)/.test(line)) return 'sessions'
  if (/^(mnemo\b|sessions json)/.test(line)) return 'children'
  if (/^(gh\b|prs json)/.test(line)) return 'prs'
  if (/^history\b/.test(line)) return 'history'
  return 'other'
}

/** What to do, when the line says enough to know. */
function hint(source: ErrorSource, line: string): string | null {
  if (MISSING.test(line)) {
    if (source === 'sessions') return '`claude` was not found. Install Claude Code, or check that `claude --version` works in a new terminal, then restart the app.'
    if (source === 'children') return '`mnemo` was not found. Install mnemo, or check that `mnemo --version` works in a new terminal, then restart the app.'
    if (source === 'prs') return 'the GitHub CLI (gh) was not found. Install it from https://cli.github.com, then restart the app.'
  }
  if (source === 'prs' && LOGGED_OUT.test(line)) return 'gh is not logged in. Run `gh auth login` in a terminal.'
  if (source === 'prs' && OFFLINE.test(line)) return 'GitHub could not be reached. Check the connection; it is read again on its own.'
  return null
}

export function explainError(line: string): SnapshotError {
  const m = line.match(ACCOUNT)
  const account = m?.[1] ?? null
  const rest = m ? line.slice(m[0].length) : line
  const source = sourceOf(rest)
  const what = `${WHAT[source]}${account ? ` on account ${account}` : ''}`
  return { source, text: `${what}: ${hint(source, rest) ?? rest}`, detail: line }
}

/** The lines of `errors` from `sources`, explained, each said once. */
export function explainErrors(errors: readonly string[], sources: readonly ErrorSource[]): SnapshotError[] {
  const out: SnapshotError[] = []
  for (const line of errors) {
    const e = explainError(line)
    if (sources.includes(e.source) && !out.some((o) => o.text === e.text)) out.push(e)
  }
  return out
}
