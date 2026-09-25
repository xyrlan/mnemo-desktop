import { tauriFs, type Entry } from '../editor/client'
import { tauriExplorer } from '../explorer/client'

/** What the composer's `/` and `@` menus offer: Claude Code's commands and the skills and
 *  commands on disk for the worktree, and the worktree's files. */

export type SlashCommand = {
  name: string
  description?: string
  argumentHint?: string
  kind: 'command' | 'skill'
  /** Where it comes from: Claude Code itself, the worktree's `.claude/`, or `~/.claude/`. */
  source: 'built-in' | 'project' | 'personal'
}

/** What the catalog reads. Every call rejects with what the backend said. */
export type CatalogClient = {
  list(dir: string): Promise<Entry[]>
  read(path: string): Promise<string>
  home(): Promise<string>
  /** Every file git would show in the worktree, relative to it. */
  files(root: string): Promise<string[]>
}

export const tauriCatalog: CatalogClient = {
  list: (dir) => tauriFs.list(dir),
  read: (path) => tauriFs.read(path),
  home: () => tauriFs.home(),
  files: (root) => tauriExplorer.files(root),
}

const builtIn = (name: string, description: string, argumentHint?: string): SlashCommand => ({
  name,
  description,
  kind: 'command',
  source: 'built-in',
  ...(argumentHint ? { argumentHint } : {}),
})

/** Claude Code's own commands a person types, as 2.1.282 describes them (its internal and
 *  account-plumbing ones left out). */
export const BUILT_IN_COMMANDS: SlashCommand[] = [
  builtIn('add-dir', 'Add a new working directory', '<path>'),
  builtIn('btw', 'Ask a quick side question without interrupting the main conversation', '<question>'),
  builtIn('clear', 'Start a new session with empty context; the previous one stays resumable'),
  builtIn('compact', 'Free up context by summarizing the conversation so far', '[instructions]'),
  builtIn('config', 'Open settings'),
  builtIn('context', 'Visualize current context usage as a colored grid'),
  builtIn('copy', "Copy Claude's last response to the clipboard", '[N]'),
  builtIn('diff', 'View uncommitted changes'),
  builtIn('effort', 'Set effort level for model usage', '[level]'),
  builtIn('export', 'Export the current conversation to a file or clipboard', '[file]'),
  builtIn('goal', 'Set a goal Claude checks before stopping', '<goal>'),
  builtIn('help', 'Show help and available commands'),
  builtIn('hooks', 'View hook configurations for tool events'),
  builtIn('init', 'Initialize a new CLAUDE.md file with codebase documentation'),
  builtIn('mcp', 'Manage MCP servers'),
  builtIn('memory', 'Edit CLAUDE.md files and memory settings'),
  builtIn('model', 'Set the AI model for Claude Code', '[model]'),
  builtIn('output-style', 'List output styles or switch to one', '[style]'),
  builtIn('permissions', 'Manage allow and deny tool permission rules'),
  builtIn('plan', 'Enable plan mode or view the current session plan'),
  builtIn('plugin', 'Manage Claude Code plugins'),
  builtIn('resume', 'Resume a previous conversation'),
  builtIn('review', 'Review a pull request', '[pr]'),
  builtIn('security-review', 'Complete a security review of the pending changes on the current branch'),
  builtIn('skills', 'List available skills'),
  builtIn('status', 'Show version, model, account, API connectivity and tool statuses'),
  builtIn('tasks', 'View and manage everything running in the background'),
  builtIn('usage', 'Show session cost, plan usage, and activity stats'),
]

/** `description:` and `argument-hint:` from a markdown file's front matter. */
export function frontMatter(text: string): { name?: string; description?: string; argumentHint?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  const out: { name?: string; description?: string; argumentHint?: string } = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const value = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2')
    if (!value || value === '|' || value === '>') continue
    if (kv[1] === 'name') out.name = value
    else if (kv[1] === 'description') out.description = value
    else if (kv[1] === 'argument-hint') out.argumentHint = value
  }
  return out
}

/** Beyond this many files per folder, the rest are offered by name without being read. */
const READ_AT_MOST = 80

const tryList = (c: CatalogClient, dir: string) => c.list(dir).catch(() => [] as Entry[])
const tryRead = (c: CatalogClient, path: string) => c.read(path).catch(() => '')

/** `<dir>/commands/*.md` (one folder down as `folder:name`) and `<dir>/skills/<name>/SKILL.md`. */
async function commandsIn(c: CatalogClient, dir: string, source: SlashCommand['source']): Promise<SlashCommand[]> {
  const found: { name: string; path: string; kind: SlashCommand['kind'] }[] = []
  const commands = `${dir}/commands`
  for (const e of await tryList(c, commands)) {
    if (!e.is_dir && e.name.endsWith('.md')) found.push({ name: e.name.slice(0, -3), path: `${commands}/${e.name}`, kind: 'command' })
    else if (e.is_dir) {
      for (const f of await tryList(c, `${commands}/${e.name}`)) {
        if (!f.is_dir && f.name.endsWith('.md')) found.push({ name: `${e.name}:${f.name.slice(0, -3)}`, path: `${commands}/${e.name}/${f.name}`, kind: 'command' })
      }
    }
  }
  const skills = `${dir}/skills`
  for (const e of await tryList(c, skills)) {
    if (e.is_dir) found.push({ name: e.name, path: `${skills}/${e.name}/SKILL.md`, kind: 'skill' })
  }
  return Promise.all(
    found.map(async (f, i) => {
      const meta = i < READ_AT_MOST ? frontMatter(await tryRead(c, f.path)) : {}
      const out: SlashCommand = { name: f.kind === 'skill' ? (meta.name ?? f.name) : f.name, kind: f.kind, source }
      if (meta.description) out.description = meta.description
      if (meta.argumentHint) out.argumentHint = meta.argumentHint
      return out
    }),
  )
}

/** Every command for a session in `cwd`: the worktree's own first, then the person's, then Claude
 *  Code's; a name comes once, from the first of those that has it, as Claude Code resolves it. */
export async function loadCommands(cwd: string | null, c: CatalogClient = tauriCatalog): Promise<SlashCommand[]> {
  const home = await c.home().catch(() => null)
  const [project, personal] = await Promise.all([
    cwd ? commandsIn(c, `${cwd.replace(/\/+$/, '')}/.claude`, 'project') : Promise.resolve([]),
    home ? commandsIn(c, `${home}/.claude`, 'personal') : Promise.resolve([]),
  ])
  const seen = new Set<string>()
  const out: SlashCommand[] = []
  for (const cmd of [...project, ...personal, ...BUILT_IN_COMMANDS]) {
    if (seen.has(cmd.name)) continue
    seen.add(cmd.name)
    out.push(cmd)
  }
  return out
}

/** Commands whose name starts with `query`, then those that only contain it; each group in
 *  catalog order, so the worktree's own come before Claude Code's. */
export function filterCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase()
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q))
  const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))
  return [...starts, ...contains]
}

/** How well `path` matches `q` (lower-cased), lower is better; null when it does not. */
function fileScore(path: string, q: string): number | null {
  const lower = path.toLowerCase()
  const base = lower.slice(lower.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (base === q) return 0
  if (dot > 0 && base.slice(0, dot) === q) return 1
  if (base.startsWith(q)) return 2
  if (base.includes(q)) return 3
  if (lower.includes(q)) return 4
  // The letters in order, anywhere: `srcapp` finds `src/App.tsx`.
  let at = 0
  for (const ch of lower) if (ch === q[at]) at++
  return at === q.length ? 5 : null
}

/** How many files the `@` menu lists. */
export const FILE_MATCHES = 50

/** The worktree's files best matching `query`: name matches before path matches, shallow and
 *  short paths first. */
export function filterFiles(files: readonly string[], query: string, limit = FILE_MATCHES): string[] {
  const q = query.toLowerCase()
  const depth = (p: string) => p.split('/').length
  const scored: [string, number][] = []
  for (const f of files) {
    const s = q ? fileScore(f, q) : 0
    if (s !== null) scored.push([f, s])
  }
  scored.sort(([a, sa], [b, sb]) => sa - sb || depth(a) - depth(b) || a.length - b.length || a.localeCompare(b))
  return scored.slice(0, limit).map(([f]) => f)
}

/** How long a worktree's catalogs are trusted before the next `/` or `@` reads them again. */
export const FRESH_MS = 30_000

/** The catalogs, read once per worktree and kept a while. */
export function makeCatalogCache(c: CatalogClient = tauriCatalog, now: () => number = Date.now) {
  const kept = new Map<string, { at: number; value: Promise<unknown> }>()
  function read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = kept.get(key)
    if (hit && now() - hit.at < FRESH_MS) return hit.value as Promise<T>
    const value = load()
    kept.set(key, { at: now(), value })
    // A failed read is not kept: the next keystroke tries again.
    value.catch(() => {
      if (kept.get(key)?.value === value) kept.delete(key)
    })
    return value
  }
  return {
    commands: (cwd: string | null) => read(`commands:${cwd ?? ''}`, () => loadCommands(cwd, c)),
    files: (cwd: string) => read(`files:${cwd}`, () => c.files(cwd)),
  }
}

export type CatalogCache = ReturnType<typeof makeCatalogCache>

/** The app's one cache, shared by every composer. */
export const catalog: CatalogCache = makeCatalogCache()
