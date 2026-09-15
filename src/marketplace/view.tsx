import { useEffect, useState, type FormEvent } from 'react'
import { store, useApp } from '../layout/app-store'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { marketplace, useMarketplace } from './app-store'
import { ALL } from './store'
import { IDLE } from './cards'
import { importCwd } from './cwd'
import { groupBySource, typeSummary, type RuleSet } from './types'
import { promptSource } from './UrlPrompt'
import './marketplace.css'

const short = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')

function SetCard({ set, cwd }: { set: RuleSet; cwd: string | undefined }) {
  const card = useMarketplace((s) => s.cards[set.path] ?? IDLE)
  const importing = card.status === 'importing'
  return (
    <article className={`mk-card mk-card-${card.status}`}>
      <div className="mk-card-head">
        <span className="mk-name">{set.name}</span>
        <span className="mk-count">
          {set.rule_count} {set.rule_count === 1 ? 'rule' : 'rules'}
        </span>
        <button
          className="mk-import"
          disabled={importing || !cwd || set.rule_count === 0}
          title={cwd ? `mnemo import into ${cwd}` : 'Open a terminal in the project to import into'}
          onClick={() => cwd && void marketplace.getState().importSet(set.path, cwd)}
        >
          {importing ? 'importing…' : 'Import'}
        </button>
      </div>
      {set.description && <div className="mk-desc">{set.description}</div>}
      <div className="mk-meta">
        {typeSummary(set.types) && <span>{typeSummary(set.types)}</span>}
        {set.last_commit && <span title={set.last_commit}>updated {set.last_commit.slice(0, 10)}</span>}
        {set.projects.length > 0 && <span>from {set.projects.join(', ')}</span>}
      </div>
      {set.topics.length > 0 && (
        <div className="mk-topics">
          {set.topics.map((t) => (
            <span key={t} className="mk-topic">
              {t}
            </span>
          ))}
        </div>
      )}
      {(card.status === 'ok' || card.status === 'error') && (
        <div className="mk-output">
          <div className="mk-output-head">
            <span>
              {card.status === 'ok' ? 'imported' : 'import failed'} in {short(card.cwd)}
            </span>
            <button title="Dismiss" onClick={() => marketplace.getState().dismiss(set.path)}>
              ×
            </button>
          </div>
          <pre>{card.output || '(no output)'}</pre>
        </div>
      )}
    </article>
  )
}

function MarketplacePane(_: PaneViewProps) {
  const sets = useMarketplace((s) => s.sets)
  const loaded = useMarketplace((s) => s.loaded)
  const loading = useMarketplace((s) => s.loading)
  const refreshing = useMarketplace((s) => s.refreshing)
  const listError = useMarketplace((s) => s.listError)
  const cwd = useApp(importCwd)
  const [url, setUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!marketplace.getState().loaded) void marketplace.getState().load()
  }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim() || adding) return
    setAdding(true)
    const err = await marketplace.getState().addSource(url)
    setAdding(false)
    setAddError(err)
    if (!err) setUrl('')
  }

  const groups = groupBySource(sets)
  return (
    <div className="pane-body marketplace">
      <form className="mk-bar" onSubmit={add}>
        <input
          value={url}
          placeholder="Add a source: git URL of a repo with .mnemo-shared/"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => {
            setUrl(e.target.value)
            setAddError(null)
          }}
        />
        <button type="submit" disabled={adding || !url.trim()}>
          {adding ? 'adding…' : 'Add'}
        </button>
        <button type="button" title="Fetch every source" disabled={!!refreshing[ALL]} onClick={() => void marketplace.getState().refresh()}>
          {refreshing[ALL] ? 'fetching…' : '↻ all'}
        </button>
      </form>
      {addError && <div className="mk-error mk-banner">{addError}</div>}
      {listError && <div className="mk-error mk-banner">{listError}</div>}
      <div className="mk-target">
        import into{' '}
        {cwd ? <span title={cwd}>{short(cwd)}</span> : <span className="mk-error">no project: open a terminal in the repo first</span>}
      </div>
      <div className="mk-list">
        {!loaded && loading && <div className="mk-empty">cloning sources…</div>}
        {loaded && groups.length === 0 && <div className="mk-empty">No sources. Add a git URL above.</div>}
        {groups.map((g) => (
          <section key={g.source} className="mk-source">
            <header className="mk-source-head">
              <span className="mk-source-url" title={g.source}>
                {g.source}
              </span>
              <button
                title="Fetch this source"
                disabled={!!refreshing[g.source] || !!refreshing[ALL]}
                onClick={() => void marketplace.getState().refresh(g.source)}
              >
                {refreshing[g.source] ? 'fetching…' : '↻'}
              </button>
              <button title="Remove this source" onClick={() => void marketplace.getState().removeSource(g.source)}>
                ×
              </button>
            </header>
            {g.sets.map((set) =>
              set.error ? (
                <pre key={`${set.source}:error`} className="mk-error mk-source-error">
                  {set.error}
                </pre>
              ) : (
                <SetCard key={set.path} set={set} cwd={cwd} />
              ),
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

registerPaneView('marketplace', MarketplacePane)

const openMarketplace = () => store.getState().openView('marketplace', {}, 'split-row', 'marketplace')

register({ id: 'marketplace.open', title: 'Open marketplace', run: openMarketplace })

register({
  id: 'marketplace.import-from-url',
  title: 'Import rules from git URL…',
  run: () =>
    promptSource(async (url) => {
      const err = await marketplace.getState().addSource(url)
      if (err) return err
      if (!Object.values(store.getState().panes).some((p) => p.view === 'marketplace')) openMarketplace()
      return null
    }),
})
