// What the system panels (memory, learned, accounts, setup, settings) all draw with, so five
// panels read as one hand: a button, a destructive button that asks in place, a choice among a
// few, a notice, a quiet line. Styles are in kit.css under the `sp-` prefix.
//
// The ship asked "are you sure" in a modal over its windows. The new front has no modals: a
// destructive button says what a second press will do, and waits a few seconds for it.

import { Fragment, useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { Label } from '../../ds'
import { useArm } from '../../vault/useArm'
import { parseBlocks, type Inline } from '../../vault/md'
import type { Tone } from '../../vault/rules'
import { go, routeStore, type PanelId } from '../../world/route'
import './kit.css'

/** `/Users/you/x` → `~/x`, on every system's home. */
export const short = (path: string) =>
  path
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')
    .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/, '~')

/** What something said when it failed, as a sentence can carry it. */
export const say = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** `1 page`, `3 pages`. */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Puts `text` on the clipboard; false when the page may not. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Opens another panel, and closes the one that is open: what the host's `openPanel` and
 *  `closePanel` do, asked of the route itself so a panel's views do not import the host that
 *  imports them. */
export const openPanel = (id: PanelId): void => go({ panel: id, command: false })
export const closePanel = (): void => go({ panel: null })

/** Whether a key was typed where a panel must leave it alone: a text field, or a terminal. */
export function typedElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('.xterm, [data-terminal]')) return true
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target as HTMLElement).isContentEditable
}

/** Esc for what is open inside a panel, before the host's own Esc closes the panel: `handle`
 *  answers true when it closed something. Never taken from a terminal. Caught on `window` in
 *  capture, ahead of the host's listener, which leaves a prevented Esc alone. */
export function useInnerEscape(handle: () => boolean): void {
  const ref = useRef(handle)
  ref.current = handle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (e.target instanceof Element && e.target.closest('.xterm, [data-terminal]')) return
      // An armed button is let go first, by its own listener; the command line, open over the
      // panel, closes before anything in it.
      if (document.querySelector('.sp-btn[data-armed]') || routeStore.getState().route.command) return
      if (ref.current()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

type BtnProps = ComponentProps<'button'> & { tone?: 'go' | 'danger' | 'memory'; small?: boolean }

/** A button. `go` is the one that moves things on, `danger` the one that takes something away. */
export function Btn({ tone, small, className, type = 'button', ...rest }: BtnProps) {
  return <button type={type} className={`sp-btn ${className ?? ''}`} data-tone={tone} data-small={small || undefined} {...rest} />
}

/** A button for something that cannot be taken back: the first press arms it and it says
 *  `sure`; a second press within a few seconds does it. Anything else lets it go. */
export function ArmBtn({ children, sure, onConfirm, tone = 'danger', ...rest }: Omit<BtnProps, 'onClick'> & { sure: ReactNode; onConfirm(): void }) {
  const arm = useArm()
  const armed = arm.armed === 'on'
  const disarm = useRef(arm.disarm)
  disarm.current = arm.disarm
  // Esc lets an armed button go before it closes anything else. On `window`, in capture: a
  // button pressed in WebKit does not take the focus, so its own key handler would never hear it.
  useEffect(() => {
    if (!armed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      disarm.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [armed])
  return (
    <Btn
      {...rest}
      tone={tone}
      data-armed={armed || undefined}
      onBlur={() => arm.disarm()}
      onClick={() => {
        if (arm.press('on')) onConfirm()
      }}
    >
      {armed ? sure : children}
    </Btn>
  )
}

/** A choice among a few, as a row of buttons; the chosen one is pressed. */
export function Seg<T extends string | boolean>({ label, value, options, onPick, disabled }: { label: string; value: T; options: readonly { value: T; label: string }[]; onPick(v: T): void; disabled?: boolean }) {
  return (
    <div className="sp-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="sp-seg-btn" aria-pressed={o.value === value} disabled={disabled} onClick={() => o.value !== value && onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The tabs of a panel, each with the number it would show. */
export function Tabs<T extends string>({ tabs, on, onPick, label }: { tabs: readonly { id: T; name: string; count?: number | null; tone?: 'need' | 'memory' }[]; on: T; onPick(t: T): void; label: string }) {
  return (
    <div className="sp-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={on === t.id} className="sp-tab" onClick={() => onPick(t.id)}>
          {t.name}
          {t.count != null && (
            <span className="sp-tab-count mn-num" data-tone={t.count > 0 ? t.tone : undefined}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** A text field. */
export function Field({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={`sp-input ${className ?? ''}`} spellCheck={false} autoComplete="off" {...rest} />
}

/** A section: its small heading, a number beside it, what it holds. */
export function Section({ title, count: n, aside, children, className }: { title: string; count?: number | string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`sp-section ${className ?? ''}`}>
      <header className="sp-section-head">
        <Label>{title}</Label>
        {n !== undefined && <span className="sp-section-count mn-num">{n}</span>}
        {aside && <span className="sp-end">{aside}</span>}
      </header>
      {children}
    </section>
  )
}

/** A quiet line: an empty list, a hint. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="sp-quiet">{children}</p>
}

/** A read in flight. */
export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="sp-quiet sp-loading" role="status">
      {children}
    </p>
  )
}

/** What a read or an action said: `bad` when it failed, `ok` when it went through. `onDismiss`
 *  adds the way to put it away; `children` its actions. */
export function Notice({ tone, text, onDismiss, children }: { tone: 'bad' | 'ok' | 'info'; text: ReactNode; onDismiss?: () => void; children?: ReactNode }) {
  return (
    <div className="sp-notice" data-tone={tone} role={tone === 'bad' ? 'alert' : 'status'}>
      <span className="sp-notice-mark" aria-hidden="true">
        {tone === 'bad' ? '▲' : tone === 'ok' ? '✓' : '·'}
      </span>
      <div className="sp-notice-text">{text}</div>
      {children}
      {onDismiss && (
        <button type="button" className="sp-x" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  )
}

/** What a terminal printed. */
export function Out({ children, tone }: { children: ReactNode; tone?: 'bad' }) {
  return (
    <pre className="sp-out" data-tone={tone}>
      {children}
    </pre>
  )
}

const TONE_GLYPH: Record<Tone, string> = { ok: '●', accent: '◐', muted: '○', bad: '✕', warn: '◇' }

/** A tone as a shape first: full for sound, half for sound elsewhere, hollow for a guess, a
 *  cross for refused, a diamond for anything that wants a look. */
export function ToneMark({ tone }: { tone: Tone }) {
  return (
    <i className="sp-tone" data-tone={tone} aria-hidden="true">
      {TONE_GLYPH[tone]}
    </i>
  )
}

/** A bar `value` (0 to 1) long that says its number to a screen reader. */
export function Progress({ value, label, tone }: { value: number; label: string; tone?: 'ok' | 'warn' | 'bad' | 'memory' | 'unknown' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <span className="sp-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-tone={tone}>
      <i style={{ transform: `scaleX(${pct / 100})` }} />
    </span>
  )
}

/** Which repo a panel reads for: one press each while they fit in a row, a list past that. */
export function RepoPicker({ repos, repo, onPick }: { repos: readonly { root: string; name: string }[]; repo: { root: string; name: string } | null; onPick(root: string): void }) {
  if (!repo) return <span className="sp-quiet sp-repo">no repo known yet</span>
  if (repos.length <= 5) {
    return (
      <div className="sp-seg sp-repo" role="group" aria-label="Repo">
        {repos.map((r) => (
          <button key={r.root} type="button" className="sp-seg-btn" aria-pressed={r.root === repo.root} title={short(r.root)} onClick={() => r.root !== repo.root && onPick(r.root)}>
            {r.name}
          </button>
        ))}
      </div>
    )
  }
  return (
    <label className="sp-repo">
      <Label>repo</Label>
      <select className="sp-input sp-select" aria-label="Repo" value={repo.root} onChange={(e) => onPick(e.target.value)}>
        {repos.map((r) => (
          <option key={r.root} value={r.root}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
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
          <button key={i} type="button" className="sp-md-wiki" data-wiki={n.target} onClick={() => h.onWiki(n.target)}>
            {n.label}
          </button>
        )
      case 'link':
        return (
          <button key={i} type="button" className="sp-md-link" data-href={n.href} onClick={() => h.onLink(n.href)}>
            {inline(n.children, h)}
          </button>
        )
    }
  })
}

/** A vault page's body. The page's text is parsed into a tree (`vault/md.ts`) and drawn as
 *  elements, so none of it reaches the page as HTML. */
export function Markdown({ text, ...h }: { text: string } & LinkHandlers) {
  return (
    <div className="sp-md">
      {parseBlocks(text).map((b, i) => {
        switch (b.t) {
          case 'heading': {
            // The page's title is the header's, so `#` is drawn one level down.
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
