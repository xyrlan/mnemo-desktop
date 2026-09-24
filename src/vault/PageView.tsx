import type { ReactNode } from 'react'
import { ChevronRight, FileText, FolderOpen, SquarePen } from 'lucide-react'
import { Badge, Button } from '@/ui'
import { cn } from '@/ui/cn'
import { store } from '../layout/app-store'
import { useVault, vault } from './app-store'
import { ACTIONS, type VaultAction } from './actions'
import { resolveWikilink } from './search'
import { Markdown } from './Markdown'
import { ErrorLine } from './ErrorLine'
import { useArm } from './useArm'
import { confidenceTone } from './rules'
import { Dot, EMPTY, Loading } from './ui'
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
    <div className="vt-actions flex flex-wrap items-center gap-1 pt-1">
      {ACTIONS.map((a) => {
        const busy = log.some((e) => e.actionId === a.id && e.result === null)
        return (
          <Button
            key={a.id}
            type="button"
            variant="outline"
            size="xs"
            className={cn('text-[11px] font-normal', a.destructive && 'text-destructive/90 hover:text-destructive', armed === a.id && 'border-destructive/60 bg-destructive/15 text-destructive hover:bg-destructive/20 dark:border-destructive/60 dark:bg-destructive/15')}
            title={a.title.replace('<slug>', page.slug)}
            disabled={busy || (a.needsPage && !!page.error)}
            onClick={() => click(a)}
          >
            {busy ? `${a.label}…` : armed === a.id ? `really ${a.label.toLowerCase()}?` : a.label}
          </Button>
        )
      })}
      <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground" title={cwd ?? 'no terminal open: runs in your home directory'}>
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

/** The page's frame: header on top, the body scrolling under it. */
const PAGE = 'vt-page flex min-h-0 min-w-0 flex-1 flex-col'

export function PageView({ cwd, empty = 'Select a page.' }: { cwd: string | undefined; empty?: string }) {
  const page = useVault((s) => s.page)
  const selected = useVault((s) => s.selected)
  if (!selected) return <div className={cn(PAGE, EMPTY, 'vt-empty')}>{empty}</div>
  if (!page) return <Loading className={PAGE}>reading…</Loading>
  const meta = [
    ['type', page.type],
    ['confidence', page.confidence],
    ['runtime', page.runtime],
    ['modified', page.modified ? day(page.modified) : null],
  ].filter((m): m is [string, string] => !!m[1])
  return (
    <div className={PAGE}>
      <header className="vt-page-head flex flex-col gap-1.5 border-b border-border px-3 pt-2.5 pb-2">
        <div className="vt-title-row flex items-center gap-1">
          <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="vt-title min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{page.name || basename(page.path)}</span>
          <Button type="button" variant="ghost" size="xs" className="text-muted-foreground hover:text-foreground" title={`Open ${short(page.path)} in the editor`} disabled={!!page.error} onClick={() => openInEditor(page.path)}>
            <SquarePen />
            Edit
          </Button>
          <Button type="button" variant="ghost" size="xs" className="text-muted-foreground hover:text-foreground" title={`Open ${short(dirname(page.path))} in the file tree`} onClick={() => openInEditor(page.path, true)}>
            <FolderOpen />
            Open folder
          </Button>
        </div>
        {page.description && <div className="vt-desc text-[13px] leading-snug text-muted-foreground">{page.description}</div>}
        <div className="vt-meta flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground">
          {meta.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1">
              {k === 'confidence' && <Dot tone={confidenceTone(v)} />}
              <span className="vt-meta-key text-muted-foreground">{k}</span> {v}
            </span>
          ))}
          {page.topics.map((t) => (
            <Badge key={`t:${t}`} variant="outline" className="vt-topic h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
              {t}
            </Badge>
          ))}
        </div>
        <ActionBar page={page} cwd={cwd} />
      </header>
      {page.error ? (
        <div className="vt-page-error p-3">
          {/* A page that cannot be read has nothing else to show: dismissing it closes the page. */}
          <ErrorLine text={page.error} onDismiss={() => vault.getState().deselect()} />
        </div>
      ) : (
        <div className="vt-body min-h-0 flex-1 overflow-auto px-3 pt-1 pb-4">
          <Markdown
            text={page.body}
            onWiki={(target) => void followWiki(target, page.path)}
            onLink={(href) => {
              if (/^https?:\/\//.test(href)) store.getState().openView('browser', { url: href }, 'auto')
            }}
          />
          {page.frontmatter.length > 0 && (
            <Frontmatter>
              <table className="mt-1 border-collapse text-[11px]">
                <tbody>
                  {page.frontmatter.map((f) => (
                    <tr key={f.key}>
                      <td className="py-px pr-3 align-top font-mono whitespace-nowrap text-muted-foreground">{f.key}</td>
                      <td className="py-px align-top break-words text-foreground">{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frontmatter>
          )}
        </div>
      )}
    </div>
  )
}

/** A page's raw frontmatter, folded under its body. */
export function Frontmatter({ children }: { children: ReactNode }) {
  return (
    <details className="vt-frontmatter group mt-4 rounded-md border border-border/60 px-2 py-1 text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3 transition-transform group-open:rotate-90" />
        frontmatter
      </summary>
      {children}
    </details>
  )
}
