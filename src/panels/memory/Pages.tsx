// The vault's pages by agent, searchable, the picked one read in full beside them.

import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { useVault, vault } from '../../vault/app-store'
import { filterTree, orderAgents, pageCount, terms } from '../../vault/search'
import type { Agent, PageInfo } from '../../vault/types'
import { Btn, Field, Loading, Notice, Quiet, typedElsewhere } from './kit'
import { step } from './model'
import { PageView } from './PageView'

/** `expanded` key of the folded `other` section; `/` never occurs in an agent name. */
const OTHER = '/other'

function Pick({ page, selected }: { page: PageInfo; selected: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])
  return (
    <button ref={ref} type="button" className="memory-pick" data-pick={page.slug} aria-current={selected || undefined} onClick={() => void vault.getState().select(page.path)}>
      <span className="sp-name">{page.name}</span>
      {page.description && <span className="sp-dim memory-sub">{page.description}</span>}
    </button>
  )
}

function AgentSection({ agent, open, selected, here }: { agent: Agent; open: boolean; selected: string | null; here: boolean }) {
  return (
    <section className="memory-agent" data-agent={agent.name}>
      <button type="button" className="memory-agent-head" aria-expanded={open} onClick={() => vault.getState().toggle(agent.name, !open)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="sp-name sp-grow sp-clip">{agent.name}</span>
        {here && <span className="memory-here">this repo</span>}
        <span className="sp-dim mn-num">{pageCount(agent)}</span>
      </button>
      {open &&
        agent.groups.map((g) => (
          <div key={g.type} className="memory-group">
            <div className="mn-label memory-group-type">
              {g.type} <span className="mn-num">{g.pages.length}</span>
            </div>
            {g.pages.map((p) => (
              <Pick key={p.path} page={p} selected={p.path === selected} />
            ))}
          </div>
        ))}
    </section>
  )
}

/** `current` is the agent of the repo the panel is on: its pages come first, open. */
export function Pages({ cwd, current }: { cwd: string; current: string | undefined }) {
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
  const { main, other } = useMemo(() => orderAgents(filterTree(tree, query), current), [tree, query, current])
  // Searching opens everything that still has a match.
  const isOpen = (a: Agent) => searching || (expanded[a.name] ?? (a.name === current || a.kind === 'shared'))
  const otherOpen = searching || (expanded[OTHER] ?? false)
  // The pages on screen, in the order they are drawn: what ↑↓ walk.
  const visible = [...main.filter(isOpen), ...(otherOpen ? other.filter((a) => searching || (expanded[a.name] ?? false)) : [])].flatMap((a) => a.groups.flatMap((g) => g.pages))

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const inSearch = e.target instanceof HTMLInputElement && e.target.dataset.filter !== undefined
    if (!inSearch && typedElsewhere(e.target)) return
    const next = step(visible, selected, e.key === 'ArrowDown' ? 1 : -1)
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    void vault.getState().select(next.path)
  }

  return (
    <div className="memory-split memory-pages" onKeyDown={onKeyDown}>
      <aside className="memory-tree">
        <div className="sp-row memory-bar">
          <Field className="sp-grow" type="text" data-filter="" aria-label="Search pages" value={query} placeholder="Search name, description, body" onChange={(e) => vault.getState().setQuery(e.target.value)} />
          <Btn small disabled={loading} onClick={() => void vault.getState().load()}>
            Read again
          </Btn>
        </div>
        <div className="memory-tree-body">
          {!loaded && <Loading>reading the vault…</Loading>}
          {treeError && <Notice tone="bad" text={treeError} />}
          {loaded && !treeError && tree.length === 0 && <Quiet>No vault found: `mnemo status` names none, or it holds no pages.</Quiet>}
          {loaded && searching && main.length + other.length === 0 && tree.length > 0 && <Quiet>No page matches.</Quiet>}
          {main.map((a) => (
            <AgentSection key={a.name} agent={a} open={isOpen(a)} selected={selected} here={a.name === current} />
          ))}
          {other.length > 0 && (
            <section className="memory-agent memory-other">
              <button type="button" className="memory-agent-head" aria-expanded={otherOpen} onClick={() => vault.getState().toggle(OTHER, !otherOpen)}>
                <span aria-hidden="true">{otherOpen ? '▾' : '▸'}</span>
                <span className="sp-name sp-grow sp-dim">other</span>
                <span className="sp-dim mn-num">{other.length} agents</span>
              </button>
              {otherOpen && other.map((a) => <AgentSection key={a.name} agent={a} open={searching || (expanded[a.name] ?? false)} selected={selected} here={false} />)}
            </section>
          )}
        </div>
      </aside>
      <div className="memory-main">
        <PageView cwd={cwd} />
      </div>
    </div>
  )
}
