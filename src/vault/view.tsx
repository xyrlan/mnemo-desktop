import { useEffect, useRef, useState } from 'react'
import { store, useApp } from '../layout/app-store'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { importCwd } from '../marketplace/cwd'
import { useVault, vault } from './app-store'
import { ACTIONS, type VaultAction } from './actions'
import { agentForCwd, filterTree, orderAgents, pageCount, resolveWikilink, terms } from './search'
import { decisionsFor, parseWhy } from './why'
import { Markdown } from './Markdown'
import type { LogEntry } from './store'
import type { Agent, Page } from './types'
import './vault.css'

const short = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')
const basename = (p: string) => p.split('/').pop() ?? p
const dirname = (p: string) => p.replace(/\/[^/]*$/, '') || '/'
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/** `expanded` key of the folded `other` section; `/` never occurs in an agent name. */
const OTHER = '/other'

function AgentSection({ agent, open, selected }: { agent: Agent; open: boolean; selected: string | null }) {
  return (
    <section className="vt-agent">
      <button className="vt-agent-head" onClick={() => vault.getState().toggle(agent.name, !open)} title={agent.dir}>
        <span className="vt-caret">{open ? '▾' : '▸'}</span>
        <span className="vt-agent-name">{agent.name}</span>
        <span className="vt-count">{pageCount(agent)}</span>
      </button>
      {open &&
        agent.groups.map((g) => (
          <div key={g.type} className="vt-group">
            <div className="vt-group-type">
              {g.type} <span className="vt-count">{g.pages.length}</span>
            </div>
            {g.pages.map((p) => (
              <button
                key={p.path}
                className={`vt-row${p.path === selected ? ' vt-selected' : ''}`}
                onClick={() => void vault.getState().select(p.path)}
              >
                <span className="vt-row-name">{p.name}</span>
                {p.description && <span className="vt-row-desc">{p.description}</span>}
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
    <div className="vt-tree">
      {main.map((a) => (
        <AgentSection key={a.name} agent={a} open={isOpen(a)} selected={selected} />
      ))}
      {other.length > 0 && (
        <section className="vt-other">
          <button className="vt-agent-head" onClick={() => vault.getState().toggle(OTHER, !otherOpen)}>
            <span className="vt-caret">{otherOpen ? '▾' : '▸'}</span>
            <span className="vt-agent-name">other</span>
            <span className="vt-count">{other.length} agents</span>
          </button>
          {otherOpen &&
            other.map((a) => <AgentSection key={a.name} agent={a} open={searching || (expanded[a.name] ?? false)} selected={selected} />)}
        </section>
      )}
    </div>
  )
}

function ActionBar({ page, cwd }: { page: Page; cwd: string | undefined }) {
  const log = useVault((s) => s.log)
  const [armed, setArmed] = useState<string | null>(null)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const click = (a: VaultAction) => {
    // Destructive actions ask once, like the mission pane's stop.
    if (a.destructive && armed !== a.id) {
      setArmed(a.id)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setArmed(null), 4000)
      return
    }
    setArmed(null)
    void vault.getState().run(a.id, cwd ?? '')
  }
  return (
    <div className="vt-actions">
      {ACTIONS.map((a) => {
        const busy = log.some((e) => e.actionId === a.id && e.result === null)
        return (
          <button
            key={a.id}
            className={`${a.destructive ? 'vt-destructive' : ''}${armed === a.id ? ' vt-armed' : ''}`}
            title={a.title.replace('<slug>', page.slug)}
            disabled={busy || (a.needsPage && !!page.error)}
            onClick={() => click(a)}
          >
            {busy ? `${a.label}…` : armed === a.id ? `really ${a.label.toLowerCase()}?` : a.label}
          </button>
        )
      })}
      <span className="vt-cwd" title={cwd ?? 'no terminal open: runs in your home directory'}>
        in {cwd ? short(cwd) : '~'}
      </span>
    </div>
  )
}

function PageView({ cwd }: { cwd: string | undefined }) {
  const page = useVault((s) => s.page)
  const selected = useVault((s) => s.selected)
  const tree = useVault((s) => s.tree)
  if (!selected) return <div className="vt-page vt-empty">Select a page.</div>
  if (!page) return <div className="vt-page vt-empty">reading…</div>
  const agentDir = tree.find((a) => page.path.startsWith(a.dir + '/'))?.dir
  const edit = (props: Record<string, unknown>) => store.getState().openView('editor', props, 'auto', basename(page.path))
  const meta = [
    ['type', page.type],
    ['confidence', page.confidence],
    ['runtime', page.runtime],
    ['modified', page.modified ? day(page.modified) : null],
  ].filter((m): m is [string, string] => !!m[1])
  return (
    <div className="vt-page">
      <header className="vt-page-head">
        <div className="vt-title-row">
          <span className="vt-title">{page.name || basename(page.path)}</span>
          <button title={`Open ${short(page.path)} in the editor`} disabled={!!page.error} onClick={() => edit({ path: page.path })}>
            Edit
          </button>
          <button title={`Open ${short(dirname(page.path))} in the file tree`} onClick={() => edit({ path: page.path, root: dirname(page.path) })}>
            Open folder
          </button>
        </div>
        {page.description && <div className="vt-desc">{page.description}</div>}
        <div className="vt-meta">
          {meta.map(([k, v]) => (
            <span key={k}>
              <span className="vt-meta-key">{k}</span> {v}
            </span>
          ))}
          {page.topics.map((t) => (
            <span key={`t:${t}`} className="vt-topic">
              {t}
            </span>
          ))}
        </div>
        <ActionBar page={page} cwd={cwd} />
      </header>
      {page.error ? (
        <pre className="vt-error vt-page-error">{page.error}</pre>
      ) : (
        <div className="vt-body">
          <Markdown
            text={page.body}
            onWiki={(target) => {
              const hit = resolveWikilink(tree, target, agentDir)
              if (hit) void vault.getState().select(hit.path)
            }}
            onLink={(href) => {
              if (/^https?:\/\//.test(href)) store.getState().openView('browser', { url: href }, 'auto')
            }}
          />
          {page.frontmatter.length > 0 && (
            <details className="vt-frontmatter">
              <summary>frontmatter</summary>
              <table>
                <tbody>
                  {page.frontmatter.map((f) => (
                    <tr key={f.key}>
                      <td>{f.key}</td>
                      <td>{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
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
    <div className="vt-why">
      <div className="vt-why-note">{note}</div>
      {shown.map((d, i) => (
        <div key={i} className="vt-why-row">
          <span className="vt-why-ts">{d.ts.replace('T', ' ').slice(0, 19)}</span>
          {d.emitted.length ? (
            <span className="vt-why-fired">
              fired {d.emitted.map((e, j) => (d.scores[j] === undefined ? e : `${e} (${d.scores[j].toFixed(1)})`)).join(', ')}
            </span>
          ) : (
            <span className="vt-why-silent">{d.silence_reason ?? 'silent'}</span>
          )}
          {d.candidates.length > 0 && (
            <span className="vt-why-cands">
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

function Log() {
  const log = useVault((s) => s.log)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [log])
  if (log.length === 0) return null
  return (
    <div className="vt-log">
      {log.map((e) => {
        const r = e.result
        const why = e.actionId === 'why' && r && parseWhy(r.stdout)
        return (
          <div key={e.id} className={`vt-log-entry${r ? (r.code === 0 ? ' vt-ok' : ' vt-fail') : ''}`}>
            <div className="vt-log-head">
              <span className="vt-log-line">$ {e.line}</span>
              <span>{e.cwd ? short(e.cwd) : '~'}</span>
              <span className="vt-log-status">{r ? (r.code === null ? 'not run' : `exit ${r.code}`) : 'running…'}</span>
              <button title="Dismiss" onClick={() => vault.getState().dismiss(e.id)}>
                ×
              </button>
            </div>
            {why ? <WhyList entry={e} /> : r?.stdout.trim() && <pre>{r.stdout.trimEnd()}</pre>}
            {r?.stderr.trim() && <pre className="vt-error">{r.stderr.trimEnd()}</pre>}
          </div>
        )
      })}
      <div ref={end} />
    </div>
  )
}

function VaultPane(_: PaneViewProps) {
  const loaded = useVault((s) => s.loaded)
  const loading = useVault((s) => s.loading)
  const treeError = useVault((s) => s.treeError)
  const tree = useVault((s) => s.tree)
  const query = useVault((s) => s.query)
  const cwd = useApp(importCwd)
  const current = agentForCwd(cwd, tree)

  useEffect(() => {
    if (!vault.getState().loaded) void vault.getState().load()
  }, [])

  return (
    <div className="pane-body vault">
      <div className="vt-main">
        <aside className="vt-side">
          <div className="vt-bar">
            <input
              value={query}
              placeholder="Search name, description, body"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => vault.getState().setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && vault.getState().setQuery('')}
            />
            <button title="Re-read the vault" disabled={loading} onClick={() => void vault.getState().load()}>
              {loading ? '…' : '↻'}
            </button>
          </div>
          {!loaded && <div className="vt-empty">reading the vault…</div>}
          {treeError && <pre className="vt-error">{treeError}</pre>}
          {loaded && !treeError && tree.length === 0 && (
            <div className="vt-empty">No vault found: `mnemo status` names none, or it holds no pages.</div>
          )}
          <Tree current={current} />
        </aside>
        <PageView cwd={cwd} />
      </div>
      <Log />
    </div>
  )
}

registerPaneView('vault', VaultPane)

register({ id: 'vault.open', title: 'Open vault', run: () => store.getState().openView('vault', {}, 'auto', 'vault') })
