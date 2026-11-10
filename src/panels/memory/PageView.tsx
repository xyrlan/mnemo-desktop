// One page of the vault in full: what it is, where it lives, why it wants a look, what can be
// done to it, its body, its frontmatter; and the pages around it.

import { useEffect, useMemo, useState } from 'react'
import { basename, dirname } from '../../path/path'
import { actionById } from '../../vault/actions'
import { useVault, vault } from '../../vault/app-store'
import { countLabel } from '../../vault/ego'
import { BADGE_LABEL, BADGE_TITLE, confidenceTone, withStale } from '../../vault/rules'
import { resolveWikilink } from '../../vault/search'
import type { GraphNode, Page } from '../../vault/types'
import { actions } from '../../world/actions'
import { ArmBtn, Btn, copyText, Loading, Markdown, Notice, Quiet, short, Tabs, ToneMark } from './kit'
import { relation, staleRows } from './model'

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Opens a link or a file outside the app, and says why when it could not. */
async function outside(target: string, fail: (why: string) => void): Promise<void> {
  const r = await actions().external(target)
  if (!r.ok) fail(r.why)
}

/** A `[[wikilink]]` selects its target. The rules table never reads the tree, so the first link
 *  followed from there reads it. */
export async function followWiki(target: string, from: string): Promise<void> {
  if (!vault.getState().loaded) await vault.getState().load()
  const { tree } = vault.getState()
  const agentDir = tree.find((a) => from.startsWith(a.dir + '/'))?.dir
  const hit = resolveWikilink(tree, target, agentDir)
  if (hit) await vault.getState().select(hit.path)
}

/** What can be done to the page: ask why it fired or did not, disable it (asked twice), open it
 *  in the system's editor, open its folder, copy its path. */
function PageActions({ page, cwd }: { page: Page; cwd: string }) {
  const log = useVault((s) => s.log)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const busy = (id: string) => log.some((e) => e.actionId === id && e.result === null)
  const disable = actionById('disable')!
  return (
    <>
      <div className="sp-wrap memory-page-acts">
        <Btn small disabled={busy('why')} onClick={() => void vault.getState().run('why', cwd)}>
          {busy('why') ? 'Why…' : 'Why'}
        </Btn>
        <Btn small disabled={!!page.error} onClick={() => void outside(page.path, setFailed)}>
          Edit
        </Btn>
        <Btn small onClick={() => void outside(dirname(page.path), setFailed)}>
          Open folder
        </Btn>
        <Btn small onClick={() => void copyText(page.path).then(setCopied)}>
          {copied ? 'Copied' : 'Copy path'}
        </Btn>
        <ArmBtn small className="sp-end" disabled={busy('disable') || !!page.error} sure={`Disable ${page.slug}? Press again`} onConfirm={() => void vault.getState().run(disable.id, cwd)}>
          {busy('disable') ? 'Disabling…' : disable.label}
        </ArmBtn>
      </div>
      {failed && <Notice tone="bad" text={failed} onDismiss={() => setFailed(null)} />}
    </>
  )
}

/** The selected page in full. */
export function PageView({ cwd, empty = 'Pick a page to read it.' }: { cwd: string; empty?: string }) {
  const page = useVault((s) => s.page)
  const selected = useVault((s) => s.selected)
  const rules = useVault((s) => s.rules)
  const stale = useVault((s) => s.stale)
  // What the table knows of the page as a rule: its badges, and the reasons behind them.
  const row = useMemo(() => (selected ? withStale(rules, staleRows(stale)).find((r) => r.path === selected) : undefined), [rules, stale, selected])
  if (!selected) return <Quiet>{empty}</Quiet>
  if (!page) return <Loading>reading the page…</Loading>
  const meta = [
    ['type', page.type],
    ['confidence', page.confidence],
    ['runtime', page.runtime],
    ['modified', page.modified ? day(page.modified) : null],
  ].filter((m): m is [string, string] => !!m[1])
  return (
    <article className="memory-page" data-page={page.path}>
      <header className="memory-page-head">
        <h3 className="memory-page-title">{page.name || basename(page.path)}</h3>
        {page.description && <p className="memory-page-desc">{page.description}</p>}
        <div className="sp-wrap memory-meta">
          {meta.map(([k, v]) => (
            <span key={k} className="memory-meta-item">
              <span className="mn-label">{k}</span> {k === 'confidence' && <ToneMark tone={confidenceTone(v)} />} {v}
            </span>
          ))}
          {page.topics.map((t) => (
            <span key={`t:${t}`} className="sp-tag">
              #{t}
            </span>
          ))}
        </div>
        <div className="sp-mono sp-dim memory-page-path">{short(page.path)}</div>
        {row && row.badges.length > 0 && (
          <ul className="memory-reasons" data-reasons="">
            {row.badges.map((b) => (
              <li key={b}>
                <span className="sp-tag" data-tone="need">
                  {BADGE_LABEL[b]}
                </span>
                <span>{BADGE_TITLE[b]}</span>
              </li>
            ))}
            {row.reasons.map((r) => (
              <li key={r} className="sp-dim">
                {r}
              </li>
            ))}
          </ul>
        )}
        <PageActions page={page} cwd={cwd} />
      </header>
      {page.error ? (
        // A page that cannot be read has nothing else to show: dismissing it closes the page.
        <Notice tone="bad" text={page.error} onDismiss={() => vault.getState().deselect()} />
      ) : (
        <div className="memory-page-body">
          <Markdown text={page.body} onWiki={(t) => void followWiki(t, page.path)} onLink={(href) => void actions().external(href)} />
          {page.frontmatter.length > 0 && (
            <details className="sp-fold">
              <summary>frontmatter</summary>
              <dl className="memory-fm">
                {page.frontmatter.map((f) => (
                  <div key={f.key}>
                    <dt>{f.key}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      )}
    </article>
  )
}

function Neighbour({ node, why }: { node: GraphNode; why: string }) {
  return (
    <button type="button" className="memory-neighbour" data-neighbour={node.id} onClick={() => void vault.getState().select(node.id)}>
      <ToneMark tone={node.fires === 0 ? 'muted' : confidenceTone(node.confidence)} />
      <span className="sp-grow">
        <span className="sp-name">{node.label}</span>
        <span className="sp-dim memory-sub">{why}</span>
      </span>
      <span className="sp-dim mn-num">{node.fires ? `${node.fires}× fired` : 'never fired'}</span>
    </button>
  )
}

/** The pages the rule at `path` links to and from, and those sharing its rarer topics; a press
 *  selects one. Read only while shown. */
export function Neighbours({ path }: { path: string }) {
  const ego = useVault((s) => s.ego)
  useEffect(() => {
    if (vault.getState().ego?.center !== path) void vault.getState().loadEgo(path)
  }, [path])
  const shown = ego?.center === path ? ego : null
  if (!shown) return <Loading>reading the neighbourhood…</Loading>
  if (shown.error) return <Notice tone="bad" text={shown.error} />
  const others = shown.nodes.filter((n) => n.id !== path)
  if (others.length === 0) return <Quiet>No links and no shared topics.</Quiet>
  return (
    <div className="memory-neighbours">
      <div className="mn-label">{countLabel(shown)}</div>
      {others.map((n) => (
        <Neighbour key={n.id} node={n} why={relation(path, n.id, shown.edges)} />
      ))}
    </div>
  )
}

type Side = 'page' | 'neighbours'
const SIDES = [
  { id: 'page', name: 'Page' },
  { id: 'neighbours', name: 'Neighbours' },
] as const

/** The selected rule beside the table: its page, or its neighbourhood. */
export function Selected({ cwd, path }: { cwd: string; path: string }) {
  const [side, setSide] = useState<Side>('page')
  return (
    <aside className="memory-side" aria-label="Selected rule">
      <div className="sp-row memory-side-bar">
        <Tabs<Side> tabs={SIDES} on={side} onPick={setSide} label="Selected rule" />
        <button type="button" className="sp-x sp-end" aria-label="Close the page" onClick={() => vault.getState().deselect()}>
          ×
        </button>
      </div>
      <div className="memory-side-body">{side === 'page' ? <PageView cwd={cwd} empty="Pick a rule." /> : <Neighbours path={path} />}</div>
    </aside>
  )
}
