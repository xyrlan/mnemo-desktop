import { pollWhileShown } from '../shell/while-shown'
import type { JarvisClient, JarvisProject } from './client'
import { canonicalProject } from './routing'

/** The state of the projects, kept fresh in the background so the brain answers "como tá tudo?"
 *  with no tool call (jarvis-situation, #503): what runs (sessions, the children mnemo dispatched),
 *  what waits (open PRs and their CI, open issues), of every known project, read through the read
 *  tools `jarvis_tool` already runs. The loop hands `text` to the brain with a request when it
 *  changed since the brain last saw it.
 *
 *  It reads the text those tools write (`src-tauri/src/jarvis_tools/mnemo.rs` `sessions`,
 *  `gh.rs` `pr_lines`/`issue_lines`, and `gh pr checks`' own lines) and folds it into a few
 *  lines: who needs the maintainer first, then one line per project with something on it, then
 *  the quiet ones in one line. A read that fails shows its part as unknown ("?"), never the last
 *  one it got. */

export type Situation = {
  /** The panorama in a few short lines, for the brain; '' until a refresh has read something. */
  text(): string
  /** When `text` last changed, ms since the epoch; null while it is ''. */
  changedAt(): number | null
  /** Reads it all again now; resolves once `text` is current. Never rejects. */
  refresh(): Promise<void>
  /** Keeps it fresh from now on; the function returned stops that. */
  start(): () => void
}

/** The budget: it goes into the conversation each time it changes. Some 250 tokens at most. */
export const MAX_LINES = 8
export const MAX_CHARS = 1000
/** One line's most; a longer one ends in '…'. */
export const LINE_CHARS = 220

/** How often the sessions are read: the desktop's own poll, local and free. */
export const SESSIONS_EVERY_MS = 30_000
/** How often GitHub is read. Each read costs per project one `gh pr list`, one `gh issue list` and
 *  one `gh pr checks` per open PR (at most `CHECKS_MAX`), each about one point of GitHub's 5000 an
 *  hour: ten projects at 7 points, every 5 minutes, is 840 an hour, a sixth of the budget, which
 *  leaves the rest to the desktop's own poll and to `gh` in the terminal. */
export const GITHUB_EVERY_MS = 5 * 60_000
/** The PRs per project whose CI is read; the rest are listed without it. */
export const CHECKS_MAX = 5
/** Projects read from GitHub at once. */
const PROJECTS_AT_ONCE = 3

type Parent = { id: string; name: string; status: string; waitingFor: string }
type Child = { id: string; what: string; state: string; needs: string }
type Sessions = { ok: true; byRepo: Map<string, { name: string; parents: Parent[]; children: Child[] }> } | { ok: false }
type Pr = { number: number; draft: boolean; ci: 'ok' | 'falhou' | 'rodando' | 'sem CI' | '?' | null }
type Github = { name: string; prs: Pr[] | null; issues: number | null }

const key = (name: string) => name.trim().toLowerCase()

/** `list_sessions`' text: `## repo` headings, each with `- parent …` and `- child …` lines. */
export function parseSessions(out: string): Map<string, { name: string; parents: Parent[]; children: Child[] }> {
  const byRepo = new Map<string, { name: string; parents: Parent[]; children: Child[] }>()
  let repo: { name: string; parents: Parent[]; children: Child[] } | null = null
  for (const line of out.split('\n').map((l) => l.trimEnd())) {
    const head = /^## (.+)$/.exec(line)
    if (head) {
      repo = { name: head[1].trim(), parents: [], children: [] }
      byRepo.set(key(repo.name), repo)
      continue
    }
    if (!repo) continue
    const p = /^- parent (\S+)(?: "(.*?)")?: (\S+?)(?: \((.*?)\))?, in /.exec(line)
    if (p) {
      repo.parents.push({ id: p[1], name: p[2] ?? '', status: p[3], waitingFor: p[4] ?? '' })
      continue
    }
    const c = /^- child (\S+)(?: "(.*)")?: (.*)$/.exec(line)
    if (c) {
      const about = c[3].split('; ')
      const needs = about.find((a) => a.startsWith('needs '))?.slice('needs '.length) ?? ''
      repo.children.push({ id: c[1], what: c[2] ?? '', state: about[0].trim(), needs })
    }
  }
  return byRepo
}

/** `gh_pr_list`'s text: `#12 title (branch; draft; by login; updated …)` per PR. */
export function parsePrs(out: string): Pr[] {
  const prs: Pr[] = []
  for (const line of out.split('\n')) {
    const m = /^#(\d+) /.exec(line.trim())
    if (!m) continue
    // `draft` follows the branch, and only `by …` and `updated …` come after it.
    const draft = /; draft(?:; by [^;]*)?(?:; updated [\d-]*)?\)\s*$/.test(line)
    prs.push({ number: Number(m[1]), draft, ci: null })
  }
  return prs
}

/** `gh_issue_list`'s text: one `#12 title …` line per issue. */
export function countIssues(out: string): number {
  return out.split('\n').filter((l) => /^#\d+ /.test(l.trim())).length
}

/** `gh pr checks`' lines (`name<TAB>state<TAB>…`), folded: one failing fails it, one running
 *  keeps it running, else it passed. */
export function ciOf(out: string): Pr['ci'] {
  const states = out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => (l.includes('\t') ? l.split('\t')[1] : l.trim().split(/\s+/)[1] ?? '').trim().toLowerCase())
  if (states.some((s) => s === 'fail' || s === 'cancel')) return 'falhou'
  if (states.some((s) => s === 'pending')) return 'rodando'
  if (states.length && states.every((s) => s === 'pass' || s === 'skipping')) return 'ok'
  return '?'
}

/** How a state is said for one, and for more: `2 ocupadas`, `2 bloqueados`. */
const PARENT: Record<string, [string, string]> = { busy: ['ocupada', 'ocupadas'], idle: ['ociosa', 'ociosas'], waiting: ['esperando', 'esperando'] }
const CHILD: Record<string, [string, string]> = { working: ['trabalhando', 'trabalhando'], blocked: ['bloqueado', 'bloqueados'], idle: ['parado', 'parados'] }
/** A child in these states has finished: what it left shows as its PR. */
const FINISHED = new Set(['done', 'stopped'])

/** `n` things of `kinds`, as `3 filhos (2 trabalhando, 1 parado)`. */
function counted(n: number, one: string, many: string, kinds: string[], words: Record<string, [string, string]>): string {
  const by = new Map<string, number>()
  for (const k of kinds) by.set(k, (by.get(k) ?? 0) + 1)
  const parts = [...by].map(([k, c]) => `${c} ${words[k]?.[c === 1 ? 0 : 1] ?? k}`)
  return `${n} ${n === 1 ? one : many} (${parts.join(', ')})`
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

/** What a parent or child is called in a line: its name, else the start of its id. */
const called = (name: string, id: string) => (name ? `"${clip(name, 40)}"` : id.slice(0, 8))

/** The mark of a repository `list_sessions` shows that is none of the known projects (a session
 *  started in `C:\Windows\System32`, say): the brain can report what the panorama shows of it,
 *  and read nothing more, since every read tool takes a project. */
export const OUTSIDE = '(fora dos projetos do James)'

/** The panorama from what was read: the budget's lines at most. `projects`, the known ones, marks
 *  the repositories that are none of them `OUTSIDE`; null while they are not known yet. */
export function compose(sessions: Sessions | null, github: Github[] | 'failed' | null, projects: JarvisProject[] | null = null): string {
  const lines: string[] = []
  const repos = new Map<string, { name: string; parents: Parent[]; children: Child[]; gh: Github | null }>()
  if (sessions?.ok)
    for (const r of sessions.byRepo.values()) {
      // Named as the loop names it: a project's alias is the project.
      const k = projects ? canonicalProject(r.name, projects) : key(r.name)
      const outside = projects !== null && !projects.some((p) => key(p.name) === k)
      const children = r.children.filter((c) => !FINISHED.has(c.state))
      const had = repos.get(k)
      if (had) {
        had.parents.push(...r.parents)
        had.children.push(...children)
      } else repos.set(k, { name: outside ? `${r.name} ${OUTSIDE}` : r.name, parents: [...r.parents], children, gh: null })
    }
  if (Array.isArray(github))
    for (const g of github) {
      const r = repos.get(key(g.name))
      if (r) r.gh = g
      else repos.set(key(g.name), { name: g.name, parents: [], children: [], gh: g })
    }

  const needs: string[] = []
  const busy: { line: string; weight: number }[] = []
  const quiet: string[] = []
  for (const r of repos.values()) {
    const here: string[] = []
    for (const p of r.parents) if (p.status === 'waiting') here.push(`sessão ${called(p.name, p.id)} esperando${p.waitingFor ? ` (${p.waitingFor})` : ''}`)
    for (const c of r.children)
      if (c.needs) here.push(`filho ${called(c.what, c.id)} precisa de ${c.needs}`)
      else if (c.state === 'blocked') here.push(`filho ${called(c.what, c.id)} bloqueado`)
    if (here.length) needs.push(`${r.name}: ${here.join(', ')}`)

    const parts: string[] = []
    if (r.parents.length) parts.push(counted(r.parents.length, 'sessão', 'sessões', r.parents.map((p) => p.status), PARENT))
    if (r.children.length) parts.push(counted(r.children.length, 'filho', 'filhos', r.children.map((c) => c.state), CHILD))
    const g = r.gh
    if (g) {
      if (g.prs === null) parts.push('PRs: ? (gh falhou)')
      else if (g.prs.length)
        parts.push(`${g.prs.length === 1 ? 'PR' : `${g.prs.length} PRs`}: ${g.prs.map((p) => `#${p.number} ${p.draft ? 'rascunho' : p.ci ? `CI ${p.ci}` : 'CI não lido'}`).join(', ')}`)
      if (g.issues === null) parts.push('issues: ? (gh falhou)')
      else if (g.issues) parts.push(`${g.issues} ${g.issues === 1 ? 'issue aberta' : 'issues abertas'}`)
    }
    if (!parts.length) {
      quiet.push(r.name)
      continue
    }
    const weight = here.length * 100 + r.parents.length + r.children.length + (g?.prs?.length ?? 0)
    busy.push({ line: `${r.name}: ${parts.join('; ')}.`, weight })
  }

  if (needs.length) lines.push(`Precisa de você — ${needs.join('; ')}.`)
  if (sessions && !sessions.ok) lines.push('Sessões: ? (não consegui ler).')
  if (github === 'failed') lines.push('GitHub: ? (não consegui ler os projetos).')
  busy.sort((a, b) => b.weight - a.weight || a.line.localeCompare(b.line))
  lines.push(...busy.map((b) => b.line))
  if (quiet.length) lines.push(`Sem nada aberto: ${quiet.sort().join(', ')}.`)
  if (!lines.length) return sessions || github ? 'Nada rodando, nada aberto.' : ''

  const out: string[] = []
  let size = 0
  for (const [i, raw] of lines.entries()) {
    const line = clip(raw, LINE_CHARS)
    const left = lines.length - i - 1
    const note = left ? `(+${left} ${left === 1 ? 'linha' : 'linhas'} fora deste resumo)` : ''
    // Room is kept for the note of what did not fit, whenever more follows.
    if (out.length + 1 + (left ? 1 : 0) > MAX_LINES || size + line.length + 1 + (left ? note.length + 1 : 0) > MAX_CHARS) {
      const rest = lines.length - i
      out.push(`(+${rest} ${rest === 1 ? 'linha' : 'linhas'} fora deste resumo)`)
      break
    }
    out.push(line)
    size += line.length + 1
  }
  return out.join('\n')
}

/** `f` over `items`, `n` at a time, in order. */
async function inTurns<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await f(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

/** One read at a time of a kind: a call while one runs waits for it, then reads again, so what it
 *  resolves with was read after it was asked. */
function serial(read: () => Promise<void>): () => Promise<void> {
  let last: Promise<void> = Promise.resolve()
  return () => (last = last.then(read).catch(() => {}))
}

export function createSituation(client: JarvisClient, now: () => number): Situation {
  let sessions: Sessions | null = null
  let github: Github[] | 'failed' | null = null
  let known: JarvisProject[] | null = null
  let text = ''
  let at: number | null = null

  const update = () => {
    const next = compose(sessions, github, known)
    if (next === text) return
    // Once read, `compose` is never '' again: `at` stays null only until then.
    text = next
    at = now()
  }

  const readSessions = serial(async () => {
    try {
      sessions = { ok: true, byRepo: parseSessions(await client.tool('list_sessions', {})) }
    } catch {
      sessions = { ok: false }
    }
    update()
  })

  const ciRead = async (project: string, pr: Pr): Promise<Pr> => {
    try {
      return { ...pr, ci: ciOf(await client.tool('gh_pr_checks', { project, number: pr.number })) }
    } catch (e) {
      return { ...pr, ci: /no checks reported/i.test(String(e)) ? 'sem CI' : '?' }
    }
  }

  const readProject = async (name: string): Promise<Github> => {
    const [prs, issues] = await Promise.all([
      client.tool('gh_pr_list', { project: name }).then(parsePrs, () => null),
      client.tool('gh_issue_list', { project: name }).then(countIssues, () => null),
    ])
    if (!prs) return { name, prs, issues }
    const read = new Set(prs.filter((p) => !p.draft).slice(0, CHECKS_MAX).map((p) => p.number))
    const withCi = await Promise.all(prs.map((p) => (read.has(p.number) ? ciRead(name, p) : Promise.resolve(p))))
    return { name, prs: withCi, issues }
  }

  const readGithub = serial(async () => {
    try {
      const projects = await client.projects()
      // The projects are config, not state: a failed read keeps the last known for the mark.
      known = projects
      github = await inTurns(projects, PROJECTS_AT_ONCE, (p) => readProject(p.name))
    } catch {
      github = 'failed'
    }
    update()
  })

  const refresh = async () => {
    await Promise.all([readSessions(), readGithub()])
  }

  return {
    text: () => text,
    changedAt: () => at,
    refresh,
    start: () => {
      // Both read at once. James is heard while the window is hidden (the orb, hands-free), so
      // a hidden window keeps the same beat.
      const s = pollWhileShown(readSessions, SESSIONS_EVERY_MS, { hiddenMs: SESSIONS_EVERY_MS })
      const g = pollWhileShown(readGithub, GITHUB_EVERY_MS, { hiddenMs: GITHUB_EVERY_MS })
      return () => {
        s()
        g()
      }
    },
  }
}
