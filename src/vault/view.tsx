import { useEffect, useRef, useState } from 'react'
import { ChevronRight, CircleCheck, CircleX, Library, LoaderCircle } from 'lucide-react'
import { cn } from '@/ui/cn'
import { store, useApp } from '../layout/app-store'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { importCwd } from '../marketplace/cwd'
import { useVault, vault } from './app-store'
import { agentForCwd, filterTree, orderAgents, pageCount, terms } from './search'
import { decisionsFor, parseWhy } from './why'
import { HealthTable } from './HealthTable'
import { ErrorLine } from './ErrorLine'
import { InboxView } from './InboxView'
import { PageView, short } from './PageView'
import { Dismiss, EMPTY, Loading, Refresh, SearchInput } from './ui'
import type { LogEntry } from './store'
import type { Agent } from './types'
import './vault.css'

/** An agent's (or `other`'s) header row: caret, name, count. */
const HEAD = 'vt-agent-head group flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left transition-colors hover:bg-accent/50'

/** `expanded` key of the folded `other` section; `/` never occurs in an agent name. */
const OTHER = '/other'

function Caret({ open }: { open: boolean }) {
  return <ChevronRight aria-hidden className={cn('vt-caret size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
}

function AgentSection({ agent, open, selected }: { agent: Agent; open: boolean; selected: string | null }) {
  return (
    <section className="vt-agent">
      <button type="button" className={HEAD} aria-expanded={open} onClick={() => vault.getState().toggle(agent.name, !open)} title={agent.dir}>
        <Caret open={open} />
        <span className="vt-agent-name min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{agent.name}</span>
        <span className="vt-count text-[11px] text-muted-foreground/70 tabular-nums">{pageCount(agent)}</span>
      </button>
      {open &&
        agent.groups.map((g) => (
          <div key={g.type} className="vt-group pb-1 pl-4">
            <div className="vt-group-type flex items-center gap-1 px-1.5 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {g.type} <span className="vt-count ml-0.5 font-normal text-muted-foreground/60 tabular-nums">{g.pages.length}</span>
            </div>
            {g.pages.map((p) => (
              <button
                key={p.path}
                type="button"
                className={cn(
                  'vt-row flex w-full min-w-0 flex-col items-stretch rounded-md px-2 py-1 text-left transition-colors',
                  p.path === selected ? 'vt-selected bg-accent text-foreground shadow-[inset_2px_0_0_var(--brand)]' : 'hover:bg-accent/50',
                )}
                onClick={() => void vault.getState().select(p.path)}
              >
                <span className="vt-row-name truncate text-[12px] text-foreground">{p.name}</span>
                {p.description && <span className="vt-row-desc truncate text-[11px] text-muted-foreground">{p.description}</span>}
              </button>
            ))}
          </div>
        ))}
    </section>
  )
}

function Tree({ current }: { current: string | undefined }) {
  const tree = useVault((s) => s.tree)
  const query = useVault((s) => s.query)
  const expanded = useVault((s) => s.expanded)
  const selected = useVault((s) => s.selected)
  const searching = terms(query).length > 0
  const { main, other } = orderAgents(filterTree(tree, query), current)
  // Searching opens everything that still has a match.
  const isOpen = (a: Agent) => searching || (expanded[a.name] ?? (a.name === current || a.kind === 'shared'))
  const otherOpen = searching || (expanded[OTHER] ?? false)
  return (
    <div className="vt-tree min-h-0 flex-1 overflow-auto px-1.5 pb-2">
      {main.map((a) => (
        <AgentSection key={a.name} agent={a} open={isOpen(a)} selected={selected} />
      ))}
      {other.length > 0 && (
        <section className="vt-other mt-1.5 border-t border-border pt-1.5">
          <button type="button" className={HEAD} aria-expanded={otherOpen} onClick={() => vault.getState().toggle(OTHER, !otherOpen)}>
            <Caret open={otherOpen} />
            <span className="vt-agent-name min-w-0 flex-1 truncate text-[13px] font-medium text-muted-foreground">other</span>
            <span className="vt-count text-[11px] text-muted-foreground/70">{other.length} agents</span>
          </button>
          {otherOpen && (
            <div className="pl-3">
              {other.map((a) => (
                <AgentSection key={a.name} agent={a} open={searching || (expanded[a.name] ?? false)} selected={selected} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function WhyList({ entry }: { entry: LogEntry }) {
  const all = parseWhy(entry.result?.stdout ?? '')
  if (!all) return null
  const { shown, matched } = decisionsFor(all, entry.slug ?? undefined)
  const note = matched
    ? `${shown.length} of ${all.length} decisions mention ${entry.slug}`
    : `${all.length} recent decisions${entry.slug ? `, none mention ${entry.slug}` : ''}`
  return (
    <div className="vt-why mt-1.5 font-mono text-[11px]">
      <div className="vt-why-note pb-0.5 text-muted-foreground">{note}</div>
      {shown.map((d, i) => (
        <div key={i} className="vt-why-row flex flex-wrap gap-x-3 gap-y-0.5 py-px">
          <span className="vt-why-ts text-muted-foreground tabular-nums">{d.ts.replace('T', ' ').slice(0, 19)}</span>
          {d.emitted.length ? (
            <span className="vt-why-fired text-status-success">
              fired {d.emitted.map((e, j) => (d.scores[j] === undefined ? e : `${e} (${d.scores[j].toFixed(1)})`)).join(', ')}
            </span>
          ) : (
            <span className="vt-why-silent text-status-warning">{d.silence_reason ?? 'silent'}</span>
          )}
          {d.candidates.length > 0 && (
            <span className="vt-why-cands truncate text-muted-foreground">
              {d.candidates
                .slice(0, 3)
                .map(([c, s]) => `${c} ${s.toFixed(1)}`)
                .join(' · ')}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/** What a run printed, in monospace. */
const OUT = 'm-0 mt-1.5 max-h-[220px] overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words'

/** Every action run from this pane, newest last: its command, where, how it ended, what it printed. */
function Log() {
  const log = useVault((s) => s.log)
  const end = useRef<HTMLDivElement>(null)
  // Braced: in Chromium `scrollIntoView` returns a promise, which React would call as the cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [log])
  if (log.length === 0) return null
  return (
    <div className="vt-log flex max-h-[35%] shrink-0 flex-col gap-1.5 overflow-auto border-t border-border bg-sidebar/40 px-3 py-2">
      {log.map((e) => {
        const r = e.result
        const ok = r?.code === 0
        const why = e.actionId === 'why' && r && parseWhy(r.stdout)
        const Icon = !r ? LoaderCircle : ok ? CircleCheck : CircleX
        return (
          <div key={e.id} className={cn('vt-log-entry rounded-md border border-border bg-card px-2.5 py-1.5', r && (ok ? 'vt-ok' : 'vt-fail'))}>
            <div className="vt-log-head flex items-center gap-2 text-[11px] text-muted-foreground">
              <Icon aria-hidden className={cn('size-3.5 shrink-0', !r ? 'animate-spin' : ok ? 'text-status-success' : 'text-destructive')} />
              <span className="vt-log-line min-w-0 flex-1 truncate font-mono text-foreground">$ {e.line}</span>
              <span className="truncate font-mono">{e.cwd ? short(e.cwd) : '~'}</span>
              <span className={cn('vt-log-status whitespace-nowrap tabular-nums', r && (ok ? 'text-status-success' : 'text-destructive'))}>
                {r ? (r.code === null ? 'not run' : `exit ${r.code}`) : 'running…'}
              </span>
              <Dismiss onClick={() => vault.getState().dismiss(e.id)} className="-my-1 size-5" />
            </div>
            {why ? <WhyList entry={e} /> : r?.stdout.trim() && <pre className={cn(OUT, 'text-foreground')}>{r.stdout.trimEnd()}</pre>}
            {r?.stderr.trim() && <pre className={cn('vt-error', OUT, 'text-destructive')}>{r.stderr.trimEnd()}</pre>}
          </div>
        )
      })}
      <div ref={end} />
    </div>
  )
}

const MODES = [
  ['health', 'Health'],
  ['pages', 'Pages'],
  ['inbox', 'Inbox'],
] as const

function VaultPane(_: PaneViewProps) {
  const loaded = useVault((s) => s.loaded)
  const loading = useVault((s) => s.loading)
  const treeError = useVault((s) => s.treeError)
  // The store keeps the error until a read succeeds, so dismissing hides it here until the next read.
  const [dismissed, setDismissed] = useState(false)
  const tree = useVault((s) => s.tree)
  const agents = useVault((s) => s.agents)
  const query = useVault((s) => s.query)
  const mode = useVault((s) => s.mode)
  const root = useVault((s) => s.health?.root ?? null)
  const cwd = useApp(importCwd)
  // The table never reads the tree: its agents, as `repo`, name the current repo too.
  const current = agentForCwd(cwd, tree.length ? tree : agents.map((name) => ({ name, kind: name === 'shared' ? 'shared' : 'repo' })))

  useEffect(() => {
    if (mode === 'pages' && !vault.getState().loaded) void vault.getState().load()
  }, [mode])
  useEffect(() => {
    if (loading) setDismissed(false)
  }, [loading])

  return (
    <div className="pane-body vault flex min-h-0 flex-col bg-background text-foreground" data-ui>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Library aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[13px] font-medium">Vault</span>
        <div className="vt-modes ml-2 inline-flex h-7 items-center rounded-lg bg-muted p-[3px]" role="tablist" aria-label="Vault screens">
          {MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={cn(
                'inline-flex h-full items-center rounded-md border border-transparent px-2.5 text-[12px] font-medium transition-all',
                mode === m ? 'vt-mode-on bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => vault.getState().setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        {root && (
          <span className="vt-root ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={root}>
            {short(root)}
          </span>
        )}
      </div>
      {mode === 'health' ? (
        <HealthTable cwd={cwd} current={current} />
      ) : mode === 'inbox' ? (
        <InboxView cwd={cwd} />
      ) : (
        <div className="vt-main flex min-h-0 flex-1">
          <aside className="vt-side flex max-w-[420px] min-w-[220px] basis-[34%] flex-col border-r border-border">
            <div className="vt-bar flex items-center gap-1 px-3 py-2">
              <SearchInput
                className="min-w-0 flex-1"
                value={query}
                placeholder="Search name, description, body"
                onChange={(q) => vault.getState().setQuery(q)}
                onKeyDown={(e) => e.key === 'Escape' && vault.getState().setQuery('')}
              />
              <Refresh title="Re-read the vault" busy={loading} onClick={() => void vault.getState().load()} />
            </div>
            {!loaded && <Loading className="px-3">reading the vault…</Loading>}
            {treeError && !dismissed && <ErrorLine text={treeError} onDismiss={() => setDismissed(true)} className="mx-3 mb-2" />}
            {loaded && !treeError && tree.length === 0 && (
              <div className={cn('vt-empty', EMPTY, 'px-3')}>No vault found: `mnemo status` names none, or it holds no pages.</div>
            )}
            <Tree current={current} />
          </aside>
          <PageView cwd={cwd} />
        </div>
      )}
      <Log />
    </div>
  )
}

registerPaneView('vault', VaultPane)

const open = (mode?: 'health' | 'pages' | 'inbox') => () => {
  if (mode) vault.getState().setMode(mode)
  store.getState().openView('vault', {}, 'auto', 'vault')
}

register({ id: 'vault.open', title: 'Open vault', run: open() })
register({ id: 'vault.health', title: 'Open vault health: rules by heat, what needs review', run: open('health') })
register({ id: 'vault.pages', title: 'Open vault pages by agent', run: open('pages') })
register({ id: 'vault.inbox', title: 'Open vault inbox: review, promote or drop staged pages', run: open('inbox') })
