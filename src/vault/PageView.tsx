import { store } from '../layout/app-store'
import { useVault, vault } from './app-store'
import { ACTIONS, type VaultAction } from './actions'
import { resolveWikilink } from './search'
import { Markdown } from './Markdown'
import { useArm } from './useArm'
import type { Page } from './types'

export const short = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')
const basename = (p: string) => p.split('/').pop() ?? p
const dirname = (p: string) => p.replace(/\/[^/]*$/, '') || '/'
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function ActionBar({ page, cwd }: { page: Page; cwd: string | undefined }) {
  const log = useVault((s) => s.log)
  const { armed, press } = useArm()
  const click = (a: VaultAction) => {
    if (a.destructive && !press(a.id)) return
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

/** Opens `path` in the editor pane, or its folder in the editor's file tree. */
export const openInEditor = (path: string, folder = false) =>
  store.getState().openView('editor', folder ? { path, root: dirname(path) } : { path }, 'auto', basename(path))

/** A `[[wikilink]]` on the page selects its target. The table never reads the tree, so the
 *  first link clicked there reads it. */
async function followWiki(target: string, from: string) {
  if (!vault.getState().loaded) await vault.getState().load()
  const { tree } = vault.getState()
  const agentDir = tree.find((a) => from.startsWith(a.dir + '/'))?.dir
  const hit = resolveWikilink(tree, target, agentDir)
  if (hit) await vault.getState().select(hit.path)
}

export function PageView({ cwd, empty = 'Select a page.' }: { cwd: string | undefined; empty?: string }) {
  const page = useVault((s) => s.page)
  const selected = useVault((s) => s.selected)
  if (!selected) return <div className="vt-page vt-empty">{empty}</div>
  if (!page) return <div className="vt-page vt-empty">reading…</div>
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
          <button title={`Open ${short(page.path)} in the editor`} disabled={!!page.error} onClick={() => openInEditor(page.path)}>
            Edit
          </button>
          <button title={`Open ${short(dirname(page.path))} in the file tree`} onClick={() => openInEditor(page.path, true)}>
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
            onWiki={(target) => void followWiki(target, page.path)}
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
