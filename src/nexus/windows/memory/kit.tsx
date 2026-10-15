import { Fragment, useEffect, useRef, type JSX, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { parseBlocks, type Inline } from '../../../vault/md'
import type { Tone } from '../../../vault/rules'
import type { RepoNode } from '../../../fleet/store'
import { chooseRepo } from './repo'

/** `/Users/you/x` → `~/x`. */
export const short = (path: string) => path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')

/** A web page, in the system browser (spec Q6): the core refuses anything but http(s). */
export function openExternal(url: string): void {
  if (!/^https?:\/\//.test(url)) return
  void invoke('browser_open_external', { url }).catch(() => {})
}

/** Puts `text` on the clipboard; false when the page may not. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Esc for what is open inside a window, before the window's own Esc closes it: `handle` returns
 *  true when it closed something. A pending confirmation keeps its Esc. */
export function useInnerEscape(handle: () => boolean): void {
  const ref = useRef(handle)
  ref.current = handle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[data-nx-confirm]')) return
      if (!ref.current()) return
      e.preventDefault()
      e.stopPropagation()
    }
    // On `window`, in capture: ahead of the window's own on `document`.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** Which repo a window reads for. */
export function RepoPicker({ repos, repo, label = 'repo' }: { repos: Pick<RepoNode, 'root' | 'name'>[]; repo: Pick<RepoNode, 'root' | 'name'> | null; label?: string }): JSX.Element {
  if (!repo) return <span className="nx-muted nx-mem-repo">no repo open: runs in ~</span>
  return (
    <label className="nx-mem-repo" title={repo.root}>
      <span className="nx-muted">{label}</span>
      <select className="nx-input nx-mem-select" aria-label="Repo" value={repo.root} onChange={(e) => chooseRepo(e.target.value)}>
        {repos.map((r) => (
          <option key={r.root} value={r.root}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Dot({ tone }: { tone: Tone }): JSX.Element {
  return <i aria-hidden className="nx-mem-dot" data-tone={tone} />
}

/** A read in flight. */
export function Loading({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="nx-mem-quiet nx-mem-loading" role="status">
      {children}
    </div>
  )
}

/** A quiet line: an empty list, a hint. */
export function Quiet({ children }: { children: ReactNode }): JSX.Element {
  return <div className="nx-mem-quiet">{children}</div>
}

/** What a read or a run said when it failed; `onDismiss` adds the ×. */
export function ErrorText({ text, onDismiss }: { text: string; onDismiss?: () => void }): JSX.Element {
  return (
    <div className="nx-mem-error" role="alert">
      <pre>{text}</pre>
      {onDismiss && (
        <button type="button" className="nx-mem-x" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  )
}

export type LinkHandlers = { onWiki(target: string): void; onLink(href: string): void }

function inline(nodes: Inline[], h: LinkHandlers): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>
      case 'code':
        return <code key={i}>{n.text}</code>
      case 'strong':
        return <strong key={i}>{inline(n.children, h)}</strong>
      case 'em':
        return <em key={i}>{inline(n.children, h)}</em>
      case 'wiki':
        return (
          <a key={i} className="nx-md-wiki" href="#" title={n.target} onClick={(e) => (e.preventDefault(), h.onWiki(n.target))}>
            {n.label}
          </a>
        )
      case 'link':
        return (
          <a key={i} href="#" title={n.href} onClick={(e) => (e.preventDefault(), h.onLink(n.href))}>
            {inline(n.children, h)}
          </a>
        )
    }
  })
}

/** A vault page's body, in the ship's look. */
export function Markdown({ text, ...h }: { text: string } & LinkHandlers): JSX.Element {
  return (
    <div className="nx-md">
      {parseBlocks(text).map((b, i) => {
        switch (b.t) {
          case 'heading': {
            // The page title is the header's, so `#` renders one level down.
            const H = `h${Math.min(b.level + 1, 6)}` as 'h2'
            return <H key={i}>{inline(b.children, h)}</H>
          }
          case 'para':
            return <p key={i}>{inline(b.children, h)}</p>
          case 'quote':
            return <blockquote key={i}>{inline(b.children, h)}</blockquote>
          case 'rule':
            return <hr key={i} />
          case 'code':
            return (
              <pre key={i} data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            )
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul'
            return (
              <L key={i}>
                {b.items.map((it, j) => (
                  <li key={j} style={it.depth ? { marginLeft: `${it.depth * 1.2}em` } : undefined}>
                    {inline(it.children, h)}
                  </li>
                ))}
              </L>
            )
          }
        }
      })}
    </div>
  )
}

/** A page's raw frontmatter, folded under its body. */
export function Folded({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <details className="nx-mem-fold">
      <summary>{label}</summary>
      {children}
    </details>
  )
}

/** A row of tabs inside a window. */
export function Tabs<T extends string>({ tabs, on, onPick, label }: { tabs: readonly (readonly [T, string])[]; on: T; onPick(t: T): void; label: string }): JSX.Element {
  return (
    <div className="nx-mem-tabs" role="tablist" aria-label={label}>
      {tabs.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={on === id} className="nx-mem-tab" onClick={() => onPick(id)}>
          {text}
        </button>
      ))}
    </div>
  )
}
