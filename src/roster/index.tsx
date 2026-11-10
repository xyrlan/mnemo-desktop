// The roster: every session, whole, in the order of attention, children inside their parent
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "One roster"). It is Console's left
// column and the app's one list of sessions. What it shows is worked out in `model.ts`, how
// tightly in `fit.ts`; this file draws it, measures it and keeps the selection in sight.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Figure, Kbd, Label, StateMark } from '../ds'
import { contextMenu, drawsProject, drawsSession, drawsTerminal } from '../menu'
import { OrbitMap } from '../orbit'
import { PendingCard, armedPending } from '../pending'
import { useHosted } from '../runtime'
import { age, sum, tilde, tokens, WORD } from '../world/format'
import { go, openOnStage, select, useRoute } from '../world/route'
import { pendingOf, sessionOf, useWorld, worldStore } from '../world/store'
import type { Pending, Session, World } from '../world/types'
import { fitStep, reveal, startFit, type Fit, type Measured } from './fit'
import { groupStore, toggleGroup, useGroup } from './group'
import { nowOf, plan, projectMarks, shownOrder, wordOf, type Block, type Now } from './model'
import { plainTerminals, terminalName, terminalWord } from './terminals'
import './roster.css'

export { setGroup, toggleGroup, useGroup } from './group'
export { shownOrder, type Group } from './model'

/** The sessions in the order the roster shows them now: `rosterOrder` by attention, the same
 *  sessions project by project after `G`. What a key that walks the roster walks. */
export const rosterShown = (): Session[] => shownOrder(worldStore.getState().world, groupStore.getState().group)

/** Console's left column, and the app's one list of sessions. */
export function Roster() {
  const world = useWorld((w) => w)
  const route = useRoute((r) => r)
  const group = useGroup()
  const here = sessionOf(world, route.session) ?? null
  const armed = armedPending(world, route)
  const hosted = useHosted()
  // What is on stage: a session, or a terminal the app holds that is none.
  const onStage = here?.id ?? route.session

  const scroll = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const beam = useRef<HTMLElement>(null)

  // The fitting starts again whenever what is drawn, or the room it has, changed.
  const [epoch, setEpoch] = useState(0)
  const key: unknown[] = [world, onStage, armed?.id ?? null, group, epoch, hosted]
  const [was, setWas] = useState(key)
  const [fit, setFit] = useState<Fit>(startFit)
  if (key.some((v, i) => v !== was[i])) {
    setWas(key)
    setFit(startFit())
  }

  // Before the browser paints: measure this drawing and ask for the next, or, at the drawing
  // to keep, put the beam on the selection.
  const lit = useRef<string | null>(null)
  const sight = useRef<string | null>(null)
  const left = useRef(0)
  useLayoutEffect(() => {
    const sc = scroll.current
    const box = list.current
    if (!sc || !box) return
    if (fit.pass !== 'done') {
      setFit(fitStep(fit, measure(sc, box)))
      return
    }
    const sel = sc.querySelector<HTMLElement>('[data-sel]')
    const bm = beam.current
    if (!sel) {
      if (bm) bm.style.opacity = '0'
      lit.current = sight.current = null
      return
    }
    const topOf = (el: HTMLElement) => el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
    const top = topOf(sel)
    // its open card stays in sight with it
    const next = sel.nextElementSibling as HTMLElement | null
    const own = next?.matches('.roster-card') ? next : sel
    // The list follows the selection: when it changes or the list is regrouped, and after
    // that for as long as the list is where the roster left it. Once he scrolls it himself it
    // stays where he put it.
    const what = `${onStage}|${armed?.id}|${group}`
    const untouched = Math.abs(sc.scrollTop - left.current) < 1 || left.current > sc.scrollHeight - sc.clientHeight
    if (sight.current !== what || untouched) {
      sight.current = what
      // a list that scrolls fades out at its foot (roster.css): the selection stays above that
      const fade = fit.over ? 2.6 * (parseFloat(getComputedStyle(sc).fontSize) || 0) : 0
      sc.scrollTop = reveal(top, topOf(own) + own.offsetHeight + fade, sc.scrollTop, sc.clientHeight, 12)
      left.current = sc.scrollTop
    }
    if (bm) {
      // it slides only from one session to another: the first draw, a resize and a world
      // that moved the rows all put it where it belongs at once
      bm.style.transition = lit.current && lit.current !== onStage ? '' : 'none'
      bm.style.opacity = '1'
      bm.style.transform = `translateY(${top}px) scaleY(${sel.offsetHeight})`
      lit.current = onStage
    }
    // `fit` changes whenever the world, the selection, the grouping or the room does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit])

  useEffect(() => {
    const sc = scroll.current
    if (!sc) return
    const again = () => setEpoch((n) => n + 1)
    let size = `${sc.clientWidth}x${sc.clientHeight}`
    const seen =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const now = `${sc.clientWidth}x${sc.clientHeight}`
            if (now !== size) {
              size = now
              again()
            }
          })
    seen?.observe(sc)
    // a typeface that arrives late changes every height
    const fonts = document.fonts
    fonts?.addEventListener?.('loadingdone', again)
    return () => {
      seen?.disconnect()
      fonts?.removeEventListener?.('loadingdone', again)
    }
  }, [])

  // The roster's own keys, while the focus is inside it and not in a text field. The keys
  // that walk the fleet are the frame's.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    const at = e.target as HTMLElement
    if (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName)) return
    if (e.key === 'g' || e.key === 'G') {
      toggleGroup()
    } else if (e.key === 'Home' || e.key === 'End') {
      const order = shownOrder(world, group)
      const to = e.key === 'Home' ? order[0] : order[order.length - 1]
      if (!to) return
      select(to.id)
    } else return
    e.preventDefault()
  }

  const terminals = plainTerminals(world, hosted)
  const blocks = plan(world, { here, group, density: fit.density, roomy: fit.roomy })
  const marks = projectMarks(world)
  const count = blocks.reduce((n, b) => n + (b.kind === 'band' ? b.count : 0), 0)

  const waits = (s: Session) =>
    pendingOf(world, s.id).map((p) =>
      p.id === armed?.id ? (
        <div key={p.id} className="roster-card" data-kind={p.kind}>
          <PendingCard pending={p} armed />
        </div>
      ) : (
        <Wait key={p.id} pending={p} now={world.at} />
      ),
    )

  const draw = (b: Block) => {
    switch (b.kind) {
      case 'band':
        return (
          <h2 key={b.key} className="roster-band" data-band={b.band ?? undefined} {...(b.project ? drawsProject(b.project) : null)}>
            {b.mark && <span className="roster-proj">{b.mark}</span>}
            <span>{b.label}</span>
            <b className="mn-num">{b.waiting || b.count}</b>
            {b.waiting > 0 && (
              <small>
                <span className="roster-wide">{b.waiting === 1 ? 'answer' : 'answers'} wanted · </span>
                <Kbd>N</Kbd> next
              </small>
            )}
          </h2>
        )
      case 'fold':
        return (
          <article key={b.root.id} className="roster-ent roster-fold" data-state="ended">
            <button type="button" className="roster-main" data-session={b.root.id} {...drawsSession(b.root.id)} onClick={() => openOnStage(b.root.id)}>
              <StateMark state="ended" />
              <span className="roster-title">{b.root.title}</span>
              {b.root.project && <span className="roster-proj">{marks.get(b.root.project)}</span>}
              <span className="roster-age mn-num">{age(b.root.lastAt, world.at)}</span>
            </button>
          </article>
        )
      case 'heap':
        return (
          <article key="heap" className="roster-ent roster-fold roster-heap" data-state="ended">
            <StateMark state="ended" />
            {b.roots.map((r) => (
              <button key={r.id} type="button" className="roster-title" data-session={r.id} {...drawsSession(r.id)} onClick={() => openOnStage(r.id)}>
                {r.title}
              </button>
            ))}
          </article>
        )
      case 'entry': {
        const r = b.root
        return (
          <article key={r.id} className="roster-ent" data-id={r.id} data-state={r.state} data-on={b.on || undefined} data-tight={b.tight || undefined} data-band={b.band}>
            <button type="button" className="roster-main" data-session={r.id} {...drawsSession(r.id)} data-sel={here === r || undefined} aria-current={here === r || undefined} onClick={() => openOnStage(r.id)}>
              <Figure id={r.id} className="roster-fig" />
              <span className="roster-title">{r.title}</span>
              <State session={r} className="roster-st" />
              <span className="roster-now">
                <NowLine now={nowOf(r)} />
              </span>
              <span className="roster-meta">
                {r.project && <span className="roster-proj">{marks.get(r.project)}</span>}
                <span className="roster-pname">{r.project}</span>
                {r.role === 'child' && (
                  <span className="roster-tag" title="A dispatched child whose parent is not in this world">
                    child
                  </span>
                )}
                <span className="roster-gauge">
                  <span className="roster-gauge-k">ctx</span> <Ctx session={r} />
                </span>
                <span className="roster-gauge">
                  <span className="roster-gauge-k">{r.children.length ? 'tree' : 'spent'}</span> <b className="mn-num">{tokens(sum(r.totals.tree))}</b>
                </span>
                {b.tight && b.hidden > 0 && (
                  <span className="roster-gauge roster-gauge-more" title={`${b.hidden} ended ${b.hidden === 1 ? 'child' : 'children'}`}>
                    +<b className="mn-num">{b.hidden}</b> ended
                  </span>
                )}
                <span className="roster-age mn-num">{age(r.lastAt, world.at)}</span>
              </span>
            </button>
            {waits(r)}
            {(b.kids.length > 0 || (b.hidden > 0 && !b.tight)) && (
              <div className="roster-kids">
                {b.kids.map((c) => (
                  <Fragment key={c.id}>
                    <button type="button" className="roster-kid" data-session={c.id} {...drawsSession(c.id)} data-state={c.state} data-sel={here === c || undefined} aria-current={here === c || undefined} onClick={() => openOnStage(c.id)}>
                      <StateMark state={c.state} className="roster-kid-gl" />
                      <span className="roster-kid-title">{c.title}</span>
                      <span className="roster-kid-st">{wordOf(c)}</span>
                      <span className="roster-kid-ctx">
                        <Ctx session={c} />
                      </span>
                      {/* a child's status repeats what waits on it, and the line under it says that */}
                      {!(nowOf(c)?.kind === 'status' && pendingOf(world, c.id).length > 0) && (
                        <span className="roster-kid-now">
                          <NowLine now={nowOf(c)} />
                        </span>
                      )}
                    </button>
                    {waits(c)}
                  </Fragment>
                ))}
                {b.hidden > 0 && !b.tight && (
                  <button type="button" className="roster-kid roster-kid-more" data-state="ended" onClick={() => openOnStage(r.id)}>
                    <StateMark state="ended" className="roster-kid-gl" />
                    <span>
                      {b.hidden} ended {b.hidden === 1 ? 'child' : 'children'}
                    </span>
                  </button>
                )}
              </div>
            )}
          </article>
        )
      }
    }
  }

  return (
    <nav className="roster" data-roster data-group={group} aria-label="Sessions" onKeyDown={onKeyDown} onContextMenu={contextMenu}>
      {/* The map says what it is ("where it stands") itself. */}
      <div className="roster-map">
        <OrbitMap focus={route.session} />
      </div>
      <header className="roster-head">
        <Label>Sessions</Label>
        <b className="mn-num">{count}</b>
        <span className="roster-sp" />
        <button type="button" className="roster-chip" title="G" onClick={toggleGroup}>
          <span>{group === 'project' ? 'By project' : 'By attention'}</span>
          <Kbd>G</Kbd>
        </button>
      </header>
      <div ref={scroll} className="roster-scroll" data-density={fit.density} data-over={fit.over || undefined}>
        <div ref={list} className="roster-list">
          <i ref={beam} className="roster-beam" aria-hidden="true" />
          {blocks.map(draw)}
          {world.sessions.length === 0 && <p className="roster-empty">No sessions yet.</p>}
          {/* The terminals the app holds that are no session, after the sessions. */}
          {terminals.length > 0 && (
            <>
              <h2 className="roster-band" data-band="terminals">
                <span>Terminals</span>
                <b className="mn-num">{terminals.length}</b>
                <small className="roster-wide">held here, no session</small>
              </h2>
              {terminals.map((t) => (
                <article key={t.id} className="roster-ent roster-term" data-terminal={t.id}>
                  <button type="button" className="roster-main" data-session={t.id} {...drawsTerminal(t.id)} data-sel={onStage === t.id || undefined} aria-current={onStage === t.id || undefined} onClick={() => openOnStage(t.id)}>
                    <span className="roster-term-sign mn-mono" aria-hidden="true">
                      &gt;_
                    </span>
                    <span className="roster-title">{terminalName(t)}</span>
                    <span className="roster-term-word">{terminalWord(t)}</span>
                    {t.cwd && <span className="roster-term-cwd mn-mono">{tilde(t.cwd)}</span>}
                  </button>
                </article>
              ))}
            </>
          )}
        </div>
      </div>
    </nav>
  )
}

/** What this drawing of the list takes, against the room it has. */
function measure(scroll: HTMLElement, list: HTMLElement): Measured {
  const heights = new Map<string, number>()
  list.querySelectorAll<HTMLElement>('.roster-ent[data-id]').forEach((el) => heights.set(el.dataset.id ?? '', el.offsetHeight))
  const free = scroll.clientHeight - list.offsetHeight
  return { fits: free >= -1, free, heights }
}

/** A state as its shape and its word; the word is the session's own when it earned one. */
function State({ session, className }: { session: Session; className?: string }) {
  const word = wordOf(session)
  return (
    <span className={className} data-state={session.state}>
      <StateMark state={session.state} />
      {/* the mark already says the state's own word to a screen reader */}
      <span className="roster-word" aria-hidden={word === WORD[session.state] || undefined}>
        {word}
      </span>
    </span>
  )
}

function NowLine({ now }: { now: Now | null }) {
  if (!now) return <span className="roster-none">nothing recorded yet</span>
  return (
    <>
      <span className="roster-k">{now.kind}</span>
      {now.tool ? (
        <>
          <b className="mn-mono">{now.tool}</b> <span className="mn-mono roster-target">{now.text}</span>
        </>
      ) : (
        now.text
      )}
    </>
  )
}

/** How full the context is: a ticked bar and its number. Brighter from 80%, never another hue. */
function Ctx({ session }: { session: Session }) {
  const percent = session.context.percent
  if (percent == null) {
    return (
      <>
        <span className="roster-ctx" data-none>
          <i />
        </span>
        <b className="mn-num">–</b>
      </>
    )
  }
  const p = Math.max(0, Math.min(100, percent))
  const hot = p >= 80 || undefined
  return (
    <>
      <span className="roster-ctx" data-hot={hot}>
        <i style={{ transform: `scaleX(${(p / 100).toFixed(3)})` }} />
      </span>
      <b className="mn-num" data-hot={hot}>
        {Math.round(p)}%
      </b>
    </>
  )
}

/** What waits, on one line. A text that opens with its own kind ("permission: …") is said
 *  without it: the line is already labelled. */
export function waitText(p: Pending): string {
  const text = p.text.replace(/\s+/g, ' ').trim()
  const rest = text.toLowerCase().startsWith(p.kind + ':') ? text.slice(p.kind.length + 1).trim() : ''
  return rest || text
}

const CI: Record<string, string> = { green: '✓', red: '✕', running: '◌' }

/** A waiting item that is not open: one line under its session. Choosing it opens it. */
function Wait({ pending: p, now }: { pending: Pending; now: World['at'] }) {
  const n = p.choices.length
  return (
    <button type="button" className="roster-wait" data-kind={p.kind} data-wait={p.id} {...drawsSession(p.session)} onClick={() => go({ view: 'console', session: p.session, pending: p.id, panel: null })}>
      <span className="roster-wait-kind">{p.kind}</span>
      {p.pr && (
        <>
          <span className="roster-wait-pr mn-mono">#{p.pr.number}</span>
          <span className="roster-ci" data-ci={p.pr.ci ?? 'none'} title={p.pr.ci ? `checks ${p.pr.ci}` : 'no checks'}>
            <i aria-hidden="true">{CI[p.pr.ci ?? ''] ?? '–'}</i>
            <span className="roster-wide">{p.pr.ci ?? 'no checks'}</span>
          </span>
        </>
      )}
      <span className="roster-wait-text">{waitText(p)}</span>
      <span className="roster-wait-n roster-wide">
        {n} {n === 1 ? 'choice' : 'choices'}
      </span>
      <span className="roster-age mn-num">{age(p.since, now) || 'now'}</span>
    </button>
  )
}
