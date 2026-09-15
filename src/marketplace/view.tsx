import { useEffect, useState, type FormEvent } from 'react'
import { store, useApp } from '../layout/app-store'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { marketplace, useMarketplace } from './app-store'
import { ALL, newKey } from './store'
import { IDLE } from './cards'
import { importCwd } from './cwd'
import { busy, IDLE_PUBLISH, localDate } from './publish'
import { countStandings, groupBySource, STANDINGS, typeSummary, type RepoRules, type RuleSet } from './types'
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

function Output({ ok, head, output, onDismiss }: { ok: boolean; head: string; output: string; onDismiss?: () => void }) {
  return (
    <div className={`mk-output ${ok ? 'mk-output-ok' : 'mk-output-error'}`}>
      <div className="mk-output-head">
        <span>{head}</span>
        {onDismiss && (
          <button title="Dismiss" onClick={onDismiss}>
            ×
          </button>
        )}
      </div>
      <pre>{output || '(no output)'}</pre>
    </div>
  )
}

/** Publish's output, then Open PR behind a confirmation that spells out every step. */
function PublishFlow({ repo }: { repo: RepoRules }) {
  const p = useMarketplace((s) => s.publish[repo.root] ?? IDLE_PUBLISH)
  const m = marketplace.getState()
  const onTeamBranch = !!repo.branch?.startsWith('team-rules/') && repo.branch !== repo.default_branch
  const canOpen = repo.uncommitted && (p.status === 'idle' || ((p.status === 'published' || p.status === 'opened') && p.ok))
  const date = localDate()
  return (
    <>
      {p.status === 'publishing' && <div className="mk-empty">running mnemo publish…</div>}
      {(p.status === 'published' || p.status === 'confirming' || p.status === 'opening') && p.output && (
        <Output
          ok={p.status !== 'published' || p.ok}
          head={p.status === 'published' && !p.ok ? 'mnemo publish failed' : 'mnemo publish'}
          output={p.output}
          onDismiss={p.status === 'published' ? () => m.dismissPublish(repo.root) : undefined}
        />
      )}
      {p.status === 'opened' && (
        <Output
          ok={p.ok}
          head={p.ok ? `pushed ${p.branch}` : 'Open PR failed'}
          output={p.output}
          onDismiss={() => m.dismissPublish(repo.root)}
        />
      )}
      {p.status === 'opened' && p.ok && p.url && (
        <div className="mk-pr-link">
          PR{' '}
          <button className="mk-link" title="Open in a browser pane" onClick={() => store.getState().openView('browser', { url: p.url }, 'auto')}>
            {p.url}
          </button>
        </div>
      )}
      {canOpen && (
        <div className="mk-repo-line">
          <span className="mk-count">{SHARE}/ has uncommitted changes</span>
          <button onClick={() => m.askOpenPr(repo.root)}>Open PR</button>
        </div>
      )}
      {p.status === 'confirming' && (
        <div className="mk-confirm">
          <ol>
            {onTeamBranch ? (
              <li>
                commit {SHARE}/ only on <b>{repo.branch}</b> and push it (its PR picks the commit up)
              </li>
            ) : (
              <>
                <li>
                  <code>git checkout -b team-rules/{date}</code> from <b>origin/{repo.default_branch ?? '<default branch>'}</b> (your other changes come along, uncommitted)
                </li>
                <li>commit {SHARE}/ only</li>
                <li>push the branch to origin</li>
                <li>
                  <code>gh pr create</code> against {repo.default_branch ?? 'the default branch'}
                </li>
              </>
            )}
          </ol>
          <div className="mk-confirm-actions">
            <button className="mk-primary" onClick={() => void m.openPr(repo.root, date)}>
              Confirm
            </button>
            <button onClick={() => m.cancelOpenPr(repo.root)}>Cancel</button>
          </div>
        </div>
      )}
      {p.status === 'opening' && <div className="mk-empty">branching, committing, pushing, opening the PR…</div>}
    </>
  )
}

const SHARE = '.mnemo-shared'

/** The focused pane's repo as the first source: its working copy's tree, each rule
 *  badged against the local vault, with Publish and Open PR. */
function RepoSection({ cwd }: { cwd: string | undefined }) {
  const repo = useMarketplace((s) => s.repo)
  const loading = useMarketplace((s) => s.repoLoading)
  const flow = useMarketplace((s) => (repo ? (s.publish[repo.root] ?? IDLE_PUBLISH) : IDLE_PUBLISH))
  const newCard = useMarketplace((s) => (repo ? (s.cards[newKey(repo.root)] ?? IDLE) : IDLE))
  const m = marketplace.getState()

  useEffect(() => {
    void marketplace.getState().loadRepo(cwd)
  }, [cwd])

  const ready = repo && !repo.error
  const counts = countStandings(repo?.rules ?? [])
  const publishButton = ready && (
    <button disabled={busy(flow)} title={`mnemo publish in ${repo.root}`} onClick={() => void m.publishRepo(repo.root)}>
      {flow.status === 'publishing' ? 'publishing…' : 'Publish'}
    </button>
  )

  return (
    <section className="mk-source mk-repo">
      <header className="mk-source-head">
        <span className="mk-repo-label">this repo</span>
        <span className="mk-source-url" title={repo?.root}>
          {ready ? `${repo.name}${repo.branch ? ` · ${repo.branch}` : ''}` : ''}
        </span>
        <button title="Read the tree again" disabled={!cwd || loading} onClick={() => void m.loadRepo(cwd)}>
          {loading ? 'reading…' : '↻'}
        </button>
        {ready && repo.rules.length > 0 && publishButton}
      </header>
      {!cwd && <div className="mk-empty">open a terminal in a repo to see its team rules</div>}
      {cwd && !repo && loading && <div className="mk-empty">reading {short(cwd)}…</div>}
      {repo?.error && <pre className="mk-error mk-source-error">{repo.error}</pre>}
      {ready && repo.rules.length === 0 && (
        <div className="mk-repo-line">
          <span className="mk-count">no team rules published yet</span>
          {publishButton}
        </div>
      )}
      {ready && repo.set && repo.rules.length > 0 && (
        <>
          <SetCard set={repo.set} cwd={cwd} />
          <div className="mk-repo-line">
            <span className="mk-count">
              {repo.vault
                ? STANDINGS.filter((k) => counts[k] > 0)
                    .map((k) => `${counts[k]} ${k}`)
                    .join(' · ')
                : 'no mnemo vault found: rules are not compared'}
            </span>
            {counts.new > 0 && (
              <button
                disabled={!cwd || newCard.status === 'importing'}
                title={`mnemo import of the ${counts.new} new ${counts.new === 1 ? 'rule' : 'rules'} into ${cwd}`}
                onClick={() => cwd && void m.importNew(repo.root, cwd)}
              >
                {newCard.status === 'importing' ? 'importing…' : 'Import all new'}
              </button>
            )}
          </div>
          {(newCard.status === 'ok' || newCard.status === 'error') && (
            <Output
              ok={newCard.status === 'ok'}
              head={`${newCard.status === 'ok' ? 'imported' : 'import failed'} in ${short(newCard.cwd)}`}
              output={newCard.output}
              onDismiss={() => m.dismiss(newKey(repo.root))}
            />
          )}
          <ul className="mk-rules">
            {repo.rules.map((r) => (
              <li key={r.rel} className="mk-rule" title={r.rel}>
                {r.standing && <span className={`mk-badge mk-badge-${r.standing}`}>{r.standing}</span>}
                <span className="mk-rule-slug">{r.slug}</span>
                <span className="mk-rule-type">{r.page_type}</span>
                {r.description && <span className="mk-rule-desc">{r.description}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {ready && <PublishFlow repo={repo} />}
    </section>
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
        <RepoSection cwd={cwd} />
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

const openMarketplace = () => store.getState().openView('marketplace', {}, 'auto', 'marketplace')

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
