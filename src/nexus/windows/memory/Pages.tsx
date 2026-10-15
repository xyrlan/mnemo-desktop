import { useEffect, type JSX } from 'react'
import { useVault, vault } from '../../../vault/app-store'
import { filterTree, orderAgents, pageCount, terms } from '../../../vault/search'
import type { Agent } from '../../../vault/types'
import { ErrorText, Loading, Quiet } from './kit'
import { PageView } from './PageView'

/** `expanded` key of the folded `other` section; `/` never occurs in an agent name. */
const OTHER = '/other'

function AgentSection({ agent, open, selected }: { agent: Agent; open: boolean; selected: string | null }) {
  return (
    <section className="nx-mem-agent" data-agent={agent.name}>
      <button type="button" className="nx-mem-agent-head" aria-expanded={open} title={agent.dir} onClick={() => vault.getState().toggle(agent.name, !open)}>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        <span className="nx-mem-grow">{agent.name}</span>
        <span className="nx-muted">{pageCount(agent)}</span>
      </button>
      {open &&
        agent.groups.map((g) => (
          <div key={g.type} className="nx-mem-group">
            <div className="nx-mem-group-type">
              {g.type} <span className="nx-muted">{g.pages.length}</span>
            </div>
            {g.pages.map((p) => (
              <button key={p.path} type="button" className="nx-mem-pick" aria-current={p.path === selected || undefined} onClick={() => void vault.getState().select(p.path)}>
                <span className="nx-mem-name">{p.name}</span>
                {p.description && <span className="nx-muted nx-mem-sub">{p.description}</span>}
              </button>
            ))}
          </div>
        ))}
    </section>
  )
}

/** The vault's pages by agent, searchable, the one picked read in full beside them. */
export function Pages({ cwd, current }: { cwd: string; current: string | undefined }): JSX.Element {
  const tree = useVault((s) => s.tree)
  const loaded = useVault((s) => s.loaded)
  const loading = useVault((s) => s.loading)
  const treeError = useVault((s) => s.treeError)
  const query = useVault((s) => s.query)
  const expanded = useVault((s) => s.expanded)
  const selected = useVault((s) => s.selected)

  useEffect(() => {
    if (!vault.getState().loaded) void vault.getState().load()
  }, [])

  const searching = terms(query).length > 0
  const { main, other } = orderAgents(filterTree(tree, query), current)
  // Searching opens everything that still has a match.
  const isOpen = (a: Agent) => searching || (expanded[a.name] ?? (a.name === current || a.kind === 'shared'))
  const otherOpen = searching || (expanded[OTHER] ?? false)

  return (
    <div className="nx-mem-split">
      <aside className="nx-mem-tree">
        <div className="nx-mem-bar">
          <input
            className="nx-input nx-mem-grow"
            aria-label="Search pages"
            value={query}
            placeholder="Search name, description, body"
            spellCheck={false}
            onChange={(e) => vault.getState().setQuery(e.target.value)}
          />
          <button type="button" className="nx-btn" disabled={loading} title="Re-read the vault" onClick={() => void vault.getState().load()}>
            ↻
          </button>
        </div>
        {!loaded && <Loading>reading the vault…</Loading>}
        {treeError && <ErrorText text={treeError} />}
        {loaded && !treeError && tree.length === 0 && <Quiet>No vault found: `mnemo status` names none, or it holds no pages.</Quiet>}
        {loaded && searching && main.length + other.length === 0 && tree.length > 0 && <Quiet>No page matches.</Quiet>}
        {main.map((a) => (
          <AgentSection key={a.name} agent={a} open={isOpen(a)} selected={selected} />
        ))}
        {other.length > 0 && (
          <section className="nx-mem-agent nx-mem-other">
            <button type="button" className="nx-mem-agent-head" aria-expanded={otherOpen} onClick={() => vault.getState().toggle(OTHER, !otherOpen)}>
              <span aria-hidden>{otherOpen ? '▾' : '▸'}</span>
              <span className="nx-mem-grow nx-muted">other</span>
              <span className="nx-muted">{other.length} agents</span>
            </button>
            {otherOpen && other.map((a) => <AgentSection key={a.name} agent={a} open={searching || (expanded[a.name] ?? false)} selected={selected} />)}
          </section>
        )}
      </aside>
      <div className="nx-mem-main">
        <PageView cwd={cwd} />
      </div>
    </div>
  )
}
