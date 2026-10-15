import { useEffect, useState, type JSX } from 'react'
import { useVault, vault } from '../../../vault/app-store'
import { ACTIONS, type VaultAction } from '../../../vault/actions'
import { confidenceTone } from '../../../vault/rules'
import { resolveWikilink } from '../../../vault/search'
import { countLabel } from '../../../vault/ego'
import type { GraphEdge, GraphNode, Page } from '../../../vault/types'
import { basename, dirname } from '../../../path/path'
import { confirm } from '../../ui/confirm'
import { copyText, Dot, ErrorText, Folded, Loading, Markdown, openExternal, openInSystem, Quiet, short, Tabs } from './kit'

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Runs one of the vault's actions in `cwd`; one that changes the vault is confirmed first. */
export async function runAction(a: VaultAction, cwd: string, slug: string): Promise<void> {
  if (a.destructive) {
    const ok = await confirm({ title: `${a.label}?`, body: `Runs ${a.title.replace('<slug>', slug)} in ${cwd ? short(cwd) : '~'}.`, confirm: a.label, danger: true })
    if (!ok) return
  }
  await vault.getState().run(a.id, cwd)
}

function Actions({ page, cwd }: { page: Page; cwd: string }) {
  const log = useVault((s) => s.log)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const inSystem = (path: string) => {
    setFailed(null)
    openInSystem(path).catch((e: unknown) => setFailed(`Could not open ${short(path)}: ${e instanceof Error ? e.message : String(e)}`))
  }
  return (
    <div className="nx-mem-actions">
      {ACTIONS.map((a) => {
        const busy = log.some((e) => e.actionId === a.id && e.result === null)
        return (
          <button
            key={a.id}
            type="button"
            className="nx-btn"
            data-tone={a.destructive ? 'danger' : undefined}
            title={a.title.replace('<slug>', page.slug)}
            disabled={busy || (a.needsPage && !!page.error)}
            onClick={() => void runAction(a, cwd, page.slug)}
          >
            {busy ? `${a.label}…` : a.label}
          </button>
        )
      })}
      <button type="button" className="nx-btn" title={`Open ${short(page.path)} in the system's editor`} disabled={!!page.error} onClick={() => inSystem(page.path)}>
        Edit
      </button>
      <button type="button" className="nx-btn" title={`Open ${short(dirname(page.path))} in the file manager`} onClick={() => inSystem(dirname(page.path))}>
        Open folder
      </button>
      <button type="button" className="nx-btn" title={`Copy ${short(page.path)}`} onClick={() => void copyText(page.path).then(setCopied)}>
        {copied ? 'Copied' : 'Copy path'}
      </button>
      {failed && <ErrorText text={failed} onDismiss={() => setFailed(null)} />}
    </div>
  )
}

/** A `[[wikilink]]` selects its target. The table never reads the tree, so the first link
 *  followed from there reads it. */
export async function followWiki(target: string, from: string): Promise<void> {
  if (!vault.getState().loaded) await vault.getState().load()
  const { tree } = vault.getState()
  const agentDir = tree.find((a) => from.startsWith(a.dir + '/'))?.dir
  const hit = resolveWikilink(tree, target, agentDir)
  if (hit) await vault.getState().select(hit.path)
}

/** The selected page in full: its header, its actions, its body and its frontmatter. */
export function PageView({ cwd, empty = 'Select a page.' }: { cwd: string; empty?: string }): JSX.Element {
  const page = useVault((s) => s.page)
  const selected = useVault((s) => s.selected)
  if (!selected) return <Quiet>{empty}</Quiet>
  if (!page) return <Loading>reading…</Loading>
  const meta = [
    ['type', page.type],
    ['confidence', page.confidence],
    ['runtime', page.runtime],
    ['modified', page.modified ? day(page.modified) : null],
  ].filter((m): m is [string, string] => !!m[1])
  return (
    <article className="nx-mem-page" data-page={page.path}>
      <header className="nx-mem-page-head">
        <h3 className="nx-mem-page-title" title={short(page.path)}>
          {page.name || basename(page.path)}
        </h3>
        {page.description && <p className="nx-mem-page-desc">{page.description}</p>}
        <div className="nx-mem-meta">
          {meta.map(([k, v]) => (
            <span key={k}>
              {k === 'confidence' && <Dot tone={confidenceTone(v)} />}
              <span className="nx-muted">{k}</span> {v}
            </span>
          ))}
          {page.topics.map((t) => (
            <span key={`t:${t}`} className="nx-mem-chip">
              #{t}
            </span>
          ))}
        </div>
        <Actions page={page} cwd={cwd} />
      </header>
      {page.error ? (
        // A page that cannot be read has nothing else to show: dismissing it closes the page.
        <ErrorText text={page.error} onDismiss={() => vault.getState().deselect()} />
      ) : (
        <div className="nx-mem-page-body">
          <Markdown text={page.body} onWiki={(t) => void followWiki(t, page.path)} onLink={openExternal} />
          {page.frontmatter.length > 0 && (
            <Folded label="frontmatter">
              <table className="nx-mem-fm">
                <tbody>
                  {page.frontmatter.map((f) => (
                    <tr key={f.key}>
                      <td className="nx-muted">{f.key}</td>
                      <td>{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Folded>
          )}
        </div>
      )}
    </article>
  )
}

/** How a neighbour stands to the centre: the links each way, or the topics they share. */
export function relation(center: string, id: string, edges: GraphEdge[]): string {
  const of = edges.filter((e) => (e.source === center && e.target === id) || (e.target === center && e.source === id))
  const parts: string[] = []
  if (of.some((e) => e.kind === 'link' && e.source === center)) parts.push('links to it')
  if (of.some((e) => e.kind === 'link' && e.target === center)) parts.push('links here')
  const topics = of.filter((e) => e.kind === 'topic').map((e) => e.label)
  if (topics.length) parts.push(`shares ${topics.join(', ')}`)
  return parts.join(' · ') || 'nearby'
}

function Neighbour({ node, why }: { node: GraphNode; why: string }) {
  return (
    <button type="button" className="nx-row nx-mem-link" data-neighbour={node.id} title={short(node.id)} onClick={() => void vault.getState().select(node.id)}>
      <Dot tone={node.fires === 0 ? 'muted' : confidenceTone(node.confidence)} />
      <span className="nx-mem-grow">
        <span className="nx-mem-name">{node.label}</span>
        <span className="nx-muted nx-mem-sub">{why}</span>
      </span>
      <span className="nx-muted">{node.fires ? `${node.fires}× fired` : 'never fired'}</span>
    </button>
  )
}

/** The pages the rule at `path` links to and from, and those sharing its rarer topics; a click
 *  selects one. Read only while shown. */
export function Neighbours({ path }: { path: string }): JSX.Element {
  const ego = useVault((s) => s.ego)
  useEffect(() => {
    if (vault.getState().ego?.center !== path) void vault.getState().loadEgo(path)
  }, [path])
  const shown = ego?.center === path ? ego : null
  if (!shown) return <Loading>reading the neighbourhood…</Loading>
  if (shown.error) return <ErrorText text={shown.error} />
  const others = shown.nodes.filter((n) => n.id !== path)
  if (others.length === 0) return <Quiet>No links and no shared topics.</Quiet>
  return (
    <div className="nx-mem-neighbours">
      <div className="nx-muted nx-mem-count">{countLabel(shown)}</div>
      {others.map((n) => (
        <Neighbour key={n.id} node={n} why={relation(path, n.id, shown.edges)} />
      ))}
    </div>
  )
}

type Side = 'page' | 'neighbours'
const SIDES = [
  ['page', 'Page'],
  ['neighbours', 'Neighbours'],
] as const

/** The selected rule beside the health table: its page, or its neighbourhood. */
export function Selected({ cwd, path }: { cwd: string; path: string }): JSX.Element {
  const [side, setSide] = useState<Side>('page')
  return (
    <aside className="nx-mem-side" aria-label="Selected rule">
      <div className="nx-mem-side-bar">
        <Tabs<Side> tabs={SIDES} on={side} onPick={setSide} label="Selected rule" />
        <button type="button" className="nx-mem-x" aria-label="Close the page" title="Close (Esc)" onClick={() => vault.getState().deselect()}>
          ×
        </button>
      </div>
      <div className="nx-mem-side-body">{side === 'page' ? <PageView cwd={cwd} empty="Select a rule." /> : <Neighbours path={path} />}</div>
    </aside>
  )
}
