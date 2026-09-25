// adapted from stablyai/orca src/renderer/src/components/native-chat/native-chat-tool-run-label.ts
// (and the shared run-sentence, tool-icon and run-outcome rules it reads, which are not vendored)
import type { DiffHunk, ToolOutcome } from './types'
import type { ToolCard } from './stream'

/** What kind of work a call is: the run's sentence counts calls by it, and its glyph shows it. */
export type ToolCategory = 'read' | 'search' | 'list' | 'command' | 'edit' | 'web' | 'mcp' | 'todo' | 'other'

const CATEGORY: Record<string, ToolCategory> = {
  Read: 'read',
  NotebookRead: 'read',
  Grep: 'search',
  Glob: 'search',
  ToolSearch: 'search',
  LS: 'list',
  Bash: 'command',
  BashOutput: 'command',
  KillShell: 'command',
  KillBash: 'command',
  Monitor: 'command',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  WebFetch: 'web',
  WebSearch: 'web',
  TodoWrite: 'todo',
  TaskCreate: 'todo',
  TaskUpdate: 'todo',
}

export function toolCategory(name: string): ToolCategory {
  if (name.startsWith('mcp__')) return 'mcp'
  return CATEGORY[name] ?? 'other'
}

/** `mcp__mnemo__read_mnemo_rule` → `mnemo · read_mnemo_rule`. */
export function toolLabel(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? `${m[1]} · ${m[2]}` : name
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)))

/** One clause of the sentence: past tense once settled, present while live. */
function clause(category: ToolCategory, n: number, live: boolean): string {
  switch (category) {
    case 'read':
      return live ? plural(n, 'Reading 1 file', 'Reading # files') : plural(n, 'Read 1 file', 'Read # files')
    case 'search':
      return live ? plural(n, 'Searching 1 time', 'Searching # times') : plural(n, 'Searched 1 time', 'Searched # times')
    case 'list':
      return live ? plural(n, 'Listing 1 directory', 'Listing # directories') : plural(n, 'Listed 1 directory', 'Listed # directories')
    case 'command':
      return live ? plural(n, 'Running 1 command', 'Running # commands') : plural(n, 'Ran 1 command', 'Ran # commands')
    case 'edit':
      return live ? plural(n, 'Editing 1 file', 'Editing # files') : plural(n, 'Edited 1 file', 'Edited # files')
    case 'web':
      return live ? plural(n, 'Reading the web 1 time', 'Reading the web # times') : plural(n, 'Read the web 1 time', 'Read the web # times')
    case 'mcp':
      return live ? plural(n, 'Using 1 integration', 'Using # integrations') : plural(n, 'Used 1 integration', 'Used # integrations')
    case 'todo':
      return live ? plural(n, 'Updating the plan', 'Updating the plan # times') : plural(n, 'Updated the plan', 'Updated the plan # times')
    case 'other':
      return live ? plural(n, 'Using 1 tool', 'Using # tools') : plural(n, 'Used 1 tool', 'Used # tools')
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** `A`, `A and b`, `A, b, and c`: one clause per category, in the order the run first did it. */
function join(clauses: string[]): string {
  const [first, ...rest] = clauses
  const tail = rest.map(lower)
  if (!tail.length) return first
  if (tail.length === 1) return `${first} and ${tail[0]}`
  return `${[first, ...tail.slice(0, -1)].join(', ')}, and ${tail.at(-1)}`
}

/** The one line a run reads as. A lone command, settled, is its own command: `git push` says
 *  more than "Ran 1 command". Not while live: then the command is the preview beside the
 *  sentence, and the header must not change shape when a second call joins. */
export function runSentence(tools: readonly ToolCard[], live: boolean): string {
  if (tools.length === 1 && !live && toolCategory(tools[0].name) === 'command') {
    const command = tools[0].input.command
    if (typeof command === 'string' && command.trim()) return command.trim().split('\n')[0]
  }
  const counts = new Map<ToolCategory, number>()
  for (const t of tools) {
    const c = toolCategory(t.name)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return join([...counts].map(([c, n]) => clause(c, n, live)))
}

/** The glyph over a run: its calls' one category, else the generic tool. */
export function runCategory(tools: readonly ToolCard[]): ToolCategory {
  const first = toolCategory(tools[0]?.name ?? '')
  return tools.every((t) => toolCategory(t.name) === first) ? first : 'other'
}

/** A call that did not do what it was asked: it failed, was denied, or was interrupted. */
export function failed(o: ToolOutcome | null): boolean {
  return !!o && (o.kind === 'error' || o.kind === 'denied' || (o.kind === 'bash' && o.interrupted))
}

/** How a settled run ended: only a run whose every call came back, none of them failing, is
 *  marked done. */
export function runOutcome(tools: readonly ToolCard[]): { succeeded: boolean; failedCount: number } {
  const failedCount = tools.filter((t) => failed(t.outcome)).length
  return { succeeded: failedCount === 0 && tools.every((t) => t.outcome !== null), failedCount }
}

/** `path` from inside `cwd` as the worktree names it (`src/app.ts`); anything else as it is. */
export function relativeTo(path: string, cwd: string | null | undefined): string {
  if (!cwd) return path
  const root = cwd.replace(/\/+$/, '')
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/** What a call is doing, for the live line: `Running git status`, `Reading src/app.ts`. */
export function describeCall(t: ToolCard, cwd?: string | null): string {
  const what = relativeTo(t.summary, cwd) || toolLabel(t.name)
  switch (toolCategory(t.name)) {
    case 'command':
      return `Running ${what}`
    case 'read':
      return `Reading ${what}`
    case 'search':
      return `Searching ${what}`
    case 'list':
      return `Listing ${what}`
    case 'edit':
      return `Editing ${what}`
    case 'web':
      return `Reading ${what}`
    default:
      return `${toolLabel(t.name)} ${t.summary}`.trim()
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : null)
const lines = (s: string) => s.replace(/\n$/, '').split('\n')

/** The change an Edit, MultiEdit or Write asks to make, before it has been made: what a
 *  permission prompt is about. Numbered from 1 on both sides, since the call cannot say where
 *  in the file it lands; `null` for any other call. */
export function proposedHunks(name: string, input: Record<string, unknown>): DiffHunk[] | null {
  const hunk = (old: string, next: string): DiffHunk => {
    const o = old ? lines(old) : []
    const n = next ? lines(next) : []
    return { oldStart: o.length ? 1 : 0, oldLines: o.length, newStart: n.length ? 1 : 0, newLines: n.length, lines: [...o.map((l) => '-' + l), ...n.map((l) => '+' + l)] }
  }
  if (name === 'Edit') {
    const old = str(input.old_string)
    const next = str(input.new_string)
    return old === null || next === null ? null : [hunk(old, next)]
  }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    const hs = input.edits.flatMap((e) => {
      const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : {}
      const old = str(o.old_string)
      const next = str(o.new_string)
      return old === null || next === null ? [] : [hunk(old, next)]
    })
    return hs.length ? hs : null
  }
  if (name === 'Write') {
    const content = str(input.content)
    return content === null ? null : [hunk('', content)]
  }
  return null
}

/** What an approval is for, in words: the command, the file, the page. */
export function approvalSummary(t: ToolCard, cwd?: string | null): string {
  const cmd = str(t.input.command)
  if (cmd) return cmd.trim().split('\n')[0]
  return relativeTo(t.summary, cwd) || toolLabel(t.name)
}

/** The rest of what an approval allows, when there is more than its summary shows: a command's
 *  other lines, an edit's change, a tool's input. */
export function approvalDetail(t: ToolCard): string | undefined {
  const cmd = str(t.input.command)
  if (cmd) {
    const more = cmd.trim().split('\n')
    const description = str(t.input.description)
    const parts = [description, more.length > 1 ? cmd.trim() : null].filter((p): p is string => !!p)
    return parts.length ? parts.join('\n\n') : undefined
  }
  const hunks = proposedHunks(t.name, t.input)
  if (hunks) return hunks.flatMap((h) => h.lines).join('\n')
  const keys = Object.keys(t.input)
  if (!keys.length) return undefined
  const json = JSON.stringify(t.input, null, 2)
  return json.length > 4000 ? `${json.slice(0, 4000)}\n…` : json
}

/** The questions of an AskUserQuestion call, each with its option labels. */
export function askQuestions(input: Record<string, unknown>): { question: string; options: string[] }[] {
  if (!Array.isArray(input.questions)) return []
  return input.questions.flatMap((q) => {
    const o = q && typeof q === 'object' ? (q as Record<string, unknown>) : null
    const question = o && str(o.question)
    if (!o || !question) return []
    const options = Array.isArray(o.options)
      ? o.options.flatMap((x) => {
          if (typeof x === 'string') return [x]
          const label = x && typeof x === 'object' ? str((x as Record<string, unknown>).label) : null
          return label ? [label] : []
        })
      : []
    return [{ question, options }]
  })
}
