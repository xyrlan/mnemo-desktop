// The gallery: every primitive of the design system in every state, on the synthetic world.
// It is how the system is seen and photographed (the preview scenarios `next-ds*`), one page
// to a screen at 2560x1440, 1920x1080 and 1366x768. Nothing here is the product: a view never
// imports this file.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import '@fontsource-variable/jura'
import { age, sum, tokens } from '../world/format'
import { sampleWorld } from '../world/sample'
import { childrenOf, roots } from '../world/store'
import { STATE_ORDER, type Context, type Session, type SessionState } from '../world/types'
import crystalStill from './art/crystal-still.jpg'
import latticeStill from './art/lattice-still.jpg'
import { galleryPage, galleryStill, PAGES, type GalleryPage } from './flag'
import { ContextCurve, Empty, Figure, Full, HOT, Kbd, Label, Lattice, Mark, Meter, Pill, Ring, SpentBar, SpentByKind, SpentRow, Starfield, StateMark, compactionNote, type LatticeHandle } from './index'
import './tokens.css'
import './gallery.css'

const MEANING: Record<SessionState, string> = {
  need: 'It waits for you: a question, a permission, a block.',
  working: 'It is acting on its own.',
  ready: 'It is over, and a pull request it opened is still open.',
  stalled: 'It stopped without finishing.',
  idle: 'It is live and its turn is over, with nothing asked.',
  ended: 'No process, nothing waiting.',
}

const HUES: [string, string, string][] = [
  ['--need', '#ffb020', 'needs you'],
  ['--working', '#7dd3fc', 'working'],
  ['--ready', '#34d399', 'ready to merge'],
  ['--stalled', '#f87171', 'stalled'],
  ['--memory', '#c4b5fd', "mnemo's memory"],
]
const INKS: [string, string][] = [
  ['--ink', 'names, numbers, what is lit'],
  ['--ink-2', 'sentences'],
  ['--ink-3', 'labels, what is beside the point'],
  ['--ink-4', 'what had not happened yet'],
  ['--line-2', 'a rule you should see'],
  ['--line', 'a rule you should not'],
]

function Specimen({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className="mn-gallery-specimen" data-wide={wide || undefined}>
      <header>
        <Label>{title}</Label>
        {note && <p>{note}</p>}
      </header>
      {children}
    </section>
  )
}

const Caption = ({ children }: { children: ReactNode }) => <span className="mn-gallery-caption">{children}</span>

function Identity({ lit }: { lit: number }) {
  const [handle, setHandle] = useState<LatticeHandle | null>(null)
  return (
    <div className="mn-gallery-page" data-page="identity">
      <Specimen title="The lattice" note="mnemo's centre piece, drawn live from geometry. It turns at rest and stops with the window; a node lights when mnemo hands a rule to a session.">
        <div className="mn-gallery-lattice">
          <Lattice pulse={lit || undefined} onReady={setHandle} />
        </div>
        <footer>
          <Caption>
            <Kbd>L</Kbd> lights a node · {handle?.spines ?? '–'} spines · two shells
          </Caption>
        </footer>
        <figure className="mn-gallery-still">
          <img src={latticeStill} alt="" />
          <Caption>the generated still it follows</Caption>
        </figure>
      </Specimen>
      <div className="mn-gallery-stack">
        <Specimen title="The mark" note="The nested memory crystal in hairlines, after its generated still. It keeps as much of the crystal as its size can carry.">
          <div className="mn-gallery-mark">
            <figure>
              <img src={crystalStill} alt="" />
              <Caption>the still (art/crystal-still.jpg)</Caption>
            </figure>
            <figure>
              <Mark size="100%" detail={3} />
              <Caption>the mark, whole</Caption>
            </figure>
            <div className="mn-gallery-row" data-align="end">
              {[14, 18, 24, 32, 48, 72].map((size) => (
                <figure key={size}>
                  <Mark size={size} />
                  <Caption>{size}</Caption>
                </figure>
              ))}
              <figure className="mn-gallery-wordmark">
                <span>
                  <Mark size="1.5em" /> <strong>MNEMO</strong>
                </span>
                <Caption>in the top bar</Caption>
              </figure>
            </div>
          </div>
        </Specimen>
        <Specimen title="Type" note="Jura for names and numbers, Geist for sentences, JetBrains Mono for what a terminal printed.">
          <div className="mn-gallery-type">
            <p className="mn-gallery-display">Idempotent retries 0123456789</p>
            <p className="mn-gallery-text">The migration is written and tested on a copy. I need one decision from you before running the backfill.</p>
            <p className="mn-mono">17:53 ● Read src/lib/cache.ts 121ms</p>
          </div>
        </Specimen>
        <Specimen title="The ground" note="Black, and white in six weights. Colour is a signal: one hue to a state, one for memory.">
          <div className="mn-gallery-swatches">
            {INKS.map(([token, use]) => (
              <span key={token}>
                <i style={{ background: `var(${token})` }} />
                <b className="mn-mono">{token}</b>
                <Caption>{use}</Caption>
              </span>
            ))}
            {HUES.map(([token, hex, use]) => (
              <span key={token}>
                <i style={{ background: `var(${token})` }} />
                <b className="mn-mono">{hex}</b>
                <Caption>{use}</Caption>
              </span>
            ))}
          </div>
        </Specimen>
      </div>
    </div>
  )
}

function Sessions({ sessions }: { sessions: Session[] }) {
  const staged = [sessions.find((s) => (s.context.percent ?? 0) < 40), sessions.find((s) => (s.context.percent ?? 0) >= 60 && (s.context.percent ?? 0) < 80), sessions.find((s) => (s.context.percent ?? 0) >= 80)].filter((s): s is Session => !!s)
  return (
    <div className="mn-gallery-page" data-page="sessions">
      <Specimen title="A state" note="A shape first, a word second, a colour third. The two that are alive move: one beckons, one echoes.">
        <div className="mn-gallery-states">
          {STATE_ORDER.map((state) => (
            <div key={state} data-state={state}>
              <span className="mn-gallery-big">
                <StateMark state={state} />
              </span>
              <StateMark state={state} />
              <StateMark state={state} word />
              <Caption>{MEANING[state]}</Caption>
            </div>
          ))}
        </div>
        <footer className="mn-gallery-grey">
          <Caption>On a grey screen</Caption>
          {STATE_ORDER.map((state) => (
            <StateMark key={state} state={state} word />
          ))}
        </footer>
      </Specimen>
      <Specimen title="A session's figure" note="A constellation worked out from its id: the same wherever the session appears, and no other session's.">
        <div className="mn-gallery-figures">
          {sessions.map((s) => (
            <div key={s.id} data-state={s.state}>
              <Figure id={s.id} size="3em" />
              <span>
                <b>{s.title}</b>
                <StateMark state={s.state} word />
              </span>
            </div>
          ))}
        </div>
      </Specimen>
      <div className="mn-gallery-stack">
        <Specimen title="At every size" note="From a child's row to the stage, inside its context ring.">
          <div className="mn-gallery-sizes mn-gallery-fill">
            <div className="mn-gallery-row" data-align="end">
              {[sessions[2], sessions[4]].flatMap((s) =>
                [14, 18, 22, 30, 44].map((size) => (
                  <figure key={s.id + size}>
                    <Figure id={s.id} size={size} />
                    <Caption>{size}</Caption>
                  </figure>
                )),
              )}
            </div>
            <div className="mn-gallery-row" data-align="end" data-spread>
              {staged.map((s) => (
                <figure key={s.id}>
                  <Ring value={(s.context.percent ?? 0) / 100} size="7em" stroke={2.2} ticks hot={(s.context.percent ?? 0) / 100 >= HOT}>
                    <Figure id={s.id} size="54%" />
                  </Ring>
                  <Caption>on stage, {s.context.percent}% full</Caption>
                </figure>
              ))}
            </div>
          </div>
        </Specimen>
        <Specimen title="Keys" note="A key the maintainer can press, wherever it is named.">
          <div className="mn-gallery-row mn-gallery-fill">
            {['↑', '↓', '←', '→', 'Q', 'N', '1', '9', 'R', 'H', 'C', 'T', 'Enter', ';', 'Esc'].map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
            <span className="mn-gallery-chord">
              <Kbd>Alt</Kbd>
              <Kbd>N</Kbd>
              <Caption>in a terminal</Caption>
            </span>
          </div>
        </Specimen>
        <Specimen title="Labels and pills" note="A label over a section or a number. A pill is a tag, or a button when it does something.">
          <div className="mn-gallery-row mn-gallery-fill">
            <Label>Context and tokens</Label>
            <span className="mn-gallery-figure-number">
              <Label>Spent</Label>
              <b className="mn-num">67M</b>
            </span>
          </div>
          <div className="mn-gallery-row mn-gallery-fill">
            <Pill>main</Pill>
            <Pill onClick={() => {}}>Console</Pill>
            <Pill active onClick={() => {}}>
              Orbit
            </Pill>
            <Pill tone="need">
              5 wait for you <Kbd>N</Kbd>
            </Pill>
            <Pill tone="memory">4 given by mnemo</Pill>
            <Pill active>
              By attention <Kbd>G</Kbd>
            </Pill>
          </div>
        </Specimen>
      </div>
    </div>
  )
}

function Readings({ sessions, now }: { sessions: Session[]; now: number }) {
  const byFalls = (n: number) => sessions.find((s) => s.context.compactions.length === n) ?? sessions[0]
  const never = byFalls(0)
  const once = byFalls(1)
  const thrice = byFalls(3)
  const moment = once.context.series.length ? once.context.series[0][0] + (once.context.series[once.context.series.length - 1][0] - once.context.series[0][0]) * 0.36 : null
  const few: Context = { tokens: 14_000, window: 200_000, percent: 7, series: [[now - 60_000, 14_000]], compactions: [] }
  const world = useMemo(() => sampleWorld(), [])
  const parent = roots(world).find((s) => childrenOf(world, s).length > 2) ?? sessions[0]
  const family = [parent, ...childrenOf(world, parent)]
  const account = world.accounts.find((a) => a.limits.length) ?? null
  const longest = [...sessions].sort((a, b) => b.title.length - a.title.length)[0]
  return (
    <div className="mn-gallery-page" data-page="readings">
      <Specimen title="The context curve" note="How full the window was, over the session. A compaction is a cliff, with what it took down to what.">
        <div className="mn-gallery-curves">
          <figure>
            <Caption>one compaction</Caption>
            <ContextCurve context={once.context} now={now} />
            <Empty>{compactionNote(once.context, now)}</Empty>
          </figure>
          <figure>
            <Caption>three</Caption>
            <ContextCurve context={thrice.context} now={now} />
            <Empty>{compactionNote(thrice.context, now)}</Empty>
          </figure>
          <figure>
            <Caption>never compacted</Caption>
            <ContextCurve context={never.context} now={now} />
            <Empty>{compactionNote(never.context, now)}</Empty>
          </figure>
          <figure>
            <Caption>as of {moment == null ? 'then' : `${age(moment, now)} ago`}: the rest had not happened</Caption>
            <ContextCurve context={once.context} now={now} at={moment} />
          </figure>
          <figure>
            <Caption>a session that has just begun</Caption>
            <ContextCurve context={few} now={now} />
          </figure>
        </div>
      </Specimen>
      <div className="mn-gallery-stack">
        <Specimen title="Spent by kind" note="One bar split four ways, and a row to each kind. Thinking is said under the output it is part of.">
          <div className="mn-gallery-spent">
            <SpentByKind tokens={parent.totals.own} />
          </div>
          <div className="mn-gallery-bars">
            {family.slice(1, 3).map((s) => (
              <span key={s.id}>
                <Full value={s.title} />
                <SpentBar tokens={s.totals.own} />
                <b className="mn-num">{tokens(sum(s.totals.own))}</b>
              </span>
            ))}
            <span>
              <Full value="A session that spent nothing" />
              <SpentBar tokens={null} />
              <b className="mn-num">0</b>
            </span>
          </div>
        </Specimen>
        <Specimen title="A row" note="The same row for anything measured against a whole.">
          <div className="mn-gallery-rowset">
            <div className="mn-gallery-rows" style={{ ['--mn-row-label' as string]: '19em' }}>
              <Label>Its tree, a button to each</Label>
              {family.map((s) => (
                <SpentRow key={s.id} label={s.title} value={sum(s.totals.own)} of={sum(parent.totals.tree)} lead={<StateMark state={s.state} />} selected={s === parent} onClick={() => {}} />
              ))}
            </div>
            <div className="mn-gallery-rows" style={{ ['--mn-row-label' as string]: '14em' }}>
              <Label>Its sub-agents, a note under each</Label>
              {parent.tokens.subagents.map((a) => (
                <SpentRow key={a.id} label={a.description} value={sum(a.tokens)} of={sum(parent.totals.own)} note={`${a.agentType ?? 'agent'} · ${a.calls} calls`} />
              ))}
            </div>
            {account && (
              <div className="mn-gallery-rows" style={{ ['--mn-row-label' as string]: '12em' }}>
                <Label>A plan's windows, one switched off</Label>
                {account.limits.map((l, i) => (
                  <SpentRow key={l.kind + (l.model ?? '')} label={`${l.kind.replace(/_/g, ' ')}${l.model ? `, ${l.model}` : ''}`} value={l.percent} of={100} text={`${Math.round(l.percent)}%`} off={!l.active || i === account.limits.length - 1} />
                ))}
              </div>
            )}
          </div>
        </Specimen>
      </div>
      <div className="mn-gallery-stack">
        <Specimen title="A meter" note="A thin bar. Hot when it is nearly full; ruled in tenths where it is the context gauge.">
          <div className="mn-gallery-meters mn-gallery-fill">
            {[0, 0.09, 0.47, 0.83, 1].map((v) => (
              <span key={v}>
                <Meter value={v} width="100%" hot={v >= HOT} label="context" />
                <b className="mn-num">{Math.round(v * 100)}%</b>
              </span>
            ))}
            {[0.12, 0.64, 0.83].map((v) => (
              <span key={`t${v}`}>
                <Meter value={v} width="100%" ticks hot={v >= HOT} label="context" />
                <b className="mn-num">{Math.round(v * 100)}%</b>
              </span>
            ))}
          </div>
        </Specimen>
        <Specimen title="A ring" note="The same reading, round: with a number, a figure or nothing in its middle.">
          <div className="mn-gallery-row mn-gallery-fill" data-align="end" data-spread>
            <Ring value={0.31} size={16} />
            <Ring value={0.64} size={24} />
            <Ring value={0.83} size={24} hot />
            <Ring value={0} size="3.4em">
              <b className="mn-num">0</b>
            </Ring>
            <Ring value={0.47} size="3.4em">
              <b className="mn-num">47</b>
            </Ring>
            <Ring value={1} size="3.4em" hot>
              <b className="mn-num">100</b>
            </Ring>
            <Ring value={0.83} size="5.4em" stroke={2.2} ticks hot>
              <b className="mn-num mn-gallery-ring-number">83</b>
            </Ring>
          </div>
        </Specimen>
        <Specimen title="A full value" note="No tooltip. What does not fit is cut, and opens where it stands: a click, or Enter with focus on it.">
          <div className="mn-gallery-fulls mn-gallery-fill">
            <Caption>cut</Caption>
            <Full value={`${longest.title}: ${longest.recap?.text ?? longest.said?.text ?? ''}`} />
            <Caption>a path keeps its end</Caption>
            <Full value="~/work/atlas-api/src/services/billing/webhooks/handlers/idempotency-key-store.ts" keep="end" className="mn-mono" />
            <Caption>fits</Caption>
            <Full value="src/lib/cache.ts" keep="end" className="mn-mono" />
          </div>
        </Specimen>
        <Specimen title="Nothing there" note="An empty list says what is not there, in a sentence.">
          <div className="mn-gallery-empties">
            <Empty>It sent no sub-agent.</Empty>
            <Empty>Nothing waits for you.</Empty>
          </div>
        </Specimen>
      </div>
    </div>
  )
}

export default function Gallery() {
  const [page, setPage] = useState<GalleryPage>(() => galleryPage() ?? PAGES[0])
  const [still, setStill] = useState(galleryStill)
  const [lit, setLit] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const world = useMemo(() => sampleWorld(), [])
  // keys are the gallery's only while focus is inside it
  useEffect(() => root.current?.focus(), [])
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'l' || e.altKey || e.ctrlKey || e.metaKey) return
    e.stopPropagation()
    setLit((n) => n + 7)
  }
  return (
    <div ref={root} className="mn mn-gallery" data-gallery={page} data-motion={still ? 'reduced' : undefined} tabIndex={-1} onKeyDown={onKeyDown}>
      <Starfield />
      <header className="mn-gallery-bar">
        <Mark size="1.6em" />
        <strong>MNEMO</strong>
        <Label>Design system</Label>
        <span className="mn-gallery-gap" />
        {PAGES.map((p) => (
          <Pill key={p} active={p === page} onClick={() => setPage(p)}>
            {p}
          </Pill>
        ))}
        <Pill onClick={() => setStill((s) => !s)}>{`Motion ${still ? 'reduced' : 'full'}`}</Pill>
        <Label>Sample world</Label>
      </header>
      {page === 'identity' && <Identity lit={lit} />}
      {page === 'sessions' && <Sessions sessions={world.sessions} />}
      {page === 'readings' && <Readings sessions={world.sessions} now={world.at} />}
    </div>
  )
}
