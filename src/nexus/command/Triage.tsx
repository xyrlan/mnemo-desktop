import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useArm } from '../../cockpit/actions'
import { tauriMission } from '../../mission/client'
import { captainWait } from '../ship-scene/words'
import { SHIP_SPRITES, SPRITES } from '../sprites'
import type { CaptainNeed, Need, Ship, ShipAction, ShipRobot, TriageProps } from '../ship-types'
import { captainById, captainLabel, repoNameOf, robotById } from './find'

/** How long "all settled" shows before the card closes itself. */
export const SETTLED_MS = 1_100
/** How long "always" waits for its second press: the app's two-press confirmation (`useArm`). */
export const ALWAYS_MS = 4_000
/** How many of the child's timeline lines the card shows. */
const LAST_LINES = 4

/** A card, pinned by `id` (the robot's or the captain's). A robot's is answered here; a captain's
 *  only opens: a parent's prompt is answered in its own terminal (the hidden-attach answers,
 *  `cockpit/approve.ts` and `mission/ask.ts`, reach a dispatched child by its job id only). */
export type Card = { id: string; label: string; crumbs: string[]; title: string } & (
  | { kind: 'robot'; robot: ShipRobot; need: Need }
  | { kind: 'captain'; wait: CaptainNeed }
)
type RobotCard = Extract<Card, { kind: 'robot' }>

const truthy = (c: string | null): c is string => !!c

/** The name of the deck or dock a captain sits on. */
const placeOf = (ship: Ship, id: string): string | null =>
  ship.decks.find((d) => [...d.captains, ...d.quiet].some((c) => c.id === id))?.name ?? ship.docks.find((d) => d.captains.some((c) => c.id === id))?.name ?? null

/** One card per bridge exception that needs a decision, in the bridge's order. */
export function cardsOf(ship: Ship): Card[] {
  const out: Card[] = []
  for (const x of ship.bridge.exceptions) {
    if (x.kind === 'captain') {
      const captain = captainById(ship, x.captainId)
      const label = captain ? captainLabel(captain) : `session ${x.captainId.slice(0, 8)}`
      const title = captain?.topic?.split('\n')[0] || captain?.name || label
      out.push({ kind: 'captain', id: x.captainId, label, crumbs: [placeOf(ship, x.captainId), label].filter(truthy), title, wait: x })
      continue
    }
    if (x.kind !== 'need') continue
    const robot = robotById(ship, x.robotId)
    if (!robot) continue
    const captain = captainById(ship, robot.captainId)
    const crumbs = [repoNameOf(ship, robot), captain ? captainLabel(captain) : null, robot.via ? `↳${robot.via}` : null, robot.label].filter(truthy)
    const c = robot.child
    const title = robot.contract ? `${robot.contract.feature} · ${robot.contract.piece}` : (c.intent?.split('\n')[0] || c.name || c.branch || robot.id)
    out.push({ kind: 'robot', id: robot.id, label: robot.label, robot, need: x.need, crumbs, title })
  }
  return out
}

/** A card's options as keys: a question's are numbered, a permission's are `Y` / `A` / `N` (and
 *  1–3, in the prompt's order). */
export function keysOf(need: Need): { key: string; label: string; text: string }[] {
  if (need.kind === 'permission') {
    const names: Record<string, [string, string]> = { yes: ['y', 'approve'], always: ['a', 'always'], no: ['n', 'deny'] }
    return need.options.map((o) => {
      const [key, label] = names[o] ?? [o.slice(0, 1).toLowerCase(), o]
      return { key, label, text: o }
    })
  }
  return need.options.slice(0, 9).map((o, i) => ({ key: String(i + 1), label: o, text: o }))
}

/** The child's last timeline lines (its own status lines), newest last. */
function useLastLines(robot: ShipRobot | undefined): string[] | null {
  const [lines, setLines] = useState<{ id: string; lines: string[] } | null>(null)
  const id = robot?.child.id
  const len = robot?.child.timeline_len ?? 0
  useEffect(() => {
    if (!id) return
    let live = true
    tauriMission
      .timeline(id, Math.max(0, len - LAST_LINES))
      .then((t) => live && setLines({ id, lines: t.lines.map((l) => l.detail || l.text).filter(Boolean).slice(-LAST_LINES) }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [id, len])
  return lines && lines.id === id ? lines.lines : null
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** One card per pending decision, answered from the keyboard (spec "Triage"): `1`–`9` and `Y`/`N`
 *  answer, `←`/`→` move, `T` opens the robot or the captain, `Esc` closes. A captain's card is not
 *  answered here: `T` or its *open* button opens it in the drawer. It closes itself when none is
 *  left.
 *
 *  The card shown is pinned by its figure's id, never by its place in the list: a decision settled
 *  elsewhere takes its card away, and the key meant for it must not answer the card that slid into
 *  its place. Such a card leaves a notice until `←`/`→`. Before an answer goes, the robot's need
 *  is read again from the ship. "Always" takes a second press. */
export function Triage({ ship, open, onClose, onOpen, run }: TriageProps): JSX.Element | null {
  const all = useMemo(() => cardsOf(ship), [ship])
  // Answered here: hidden until the ship stops listing them, so the next card comes up at once.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set())
  const cards = all.filter((c) => !answered.has(c.id))
  const [pinned, setPinned] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<{ text: string; err: boolean } | null>(null)
  const [words, setWords] = useState('')
  const { armed, fire: arm } = useArm(ALWAYS_MS)
  const card = pinned === null ? cards[0] : cards.find((c) => c.id === pinned)
  const i = card ? cards.indexOf(card) : -1
  // Where the shown card stood, and what it was called, for when it is gone.
  const last = useRef<{ index: number; label: string }>({ index: 0, label: '' })
  if (card) last.current = { index: i, label: card.label }
  const gone = !card && cards.length > 0 ? last.current.label : null
  const lines = useLastLines(card?.kind === 'robot' ? card.robot : undefined)
  const shipNow = useRef(ship)
  shipNow.current = ship

  // A fresh triage starts on the first card, with nothing hidden.
  useEffect(() => {
    if (!open) return
    setPinned(null)
    setAnswered(new Set())
    setOut(null)
    setWords('')
  }, [open])

  // The card on screen is the one the keys answer: pin it as soon as it shows.
  useEffect(() => {
    if (open && pinned === null && cards[0]) setPinned(cards[0].id)
  }, [open, pinned, cards])

  // Forget answers the ship no longer lists, so a child that asks again shows again.
  useEffect(() => {
    setAnswered((a) => {
      const still = new Set([...a].filter((id) => all.some((c) => c.id === id)))
      return still.size === a.size ? a : still
    })
  }, [all])

  const close = useRef(onClose)
  close.current = onClose
  const settled = open && cards.length === 0
  useEffect(() => {
    if (!settled) return
    const t = window.setTimeout(() => close.current(), SETTLED_MS)
    return () => window.clearTimeout(t)
  }, [settled])

  /** Moves `by` cards from the shown one, or from where a vanished one stood. */
  const move = (by: 1 | -1) => {
    if (!cards.length) return
    const from = card ? i + by : by === 1 ? last.current.index : last.current.index - 1
    setPinned(cards[((from % cards.length) + cards.length) % cards.length].id)
  }

  const answer = async (c: RobotCard, text: string) => {
    if (busy) return
    const id = c.robot.id
    const now = cardsOf(shipNow.current).find((x) => x.id === id)
    if (!now || now.kind !== 'robot' || now.need.kind !== c.need.kind || now.need.text !== c.need.text) {
      setOut({ text: `${c.robot.label}'s ${c.need.kind} changed or was settled elsewhere: nothing was sent`, err: true })
      return
    }
    if (c.need.kind === 'permission' && text === 'always' && !arm(`always:${id}`)) {
      setOut({ text: `press A again within ${ALWAYS_MS / 1000} s to allow it always: ${c.need.text}`, err: false })
      return
    }
    const action: ShipAction = { kind: 'answer', robotId: id, text }
    setBusy(true)
    setOut({ text: `answering ${c.robot.label}…`, err: false })
    try {
      const r = await run(action)
      setOut({ text: r.say, err: !r.ok })
      if (r.ok) {
        setWords('')
        setAnswered((a) => new Set(a).add(id))
        // The card that comes up next is the one after it, pinned.
        const rest = cards.filter((x) => x.id !== id)
        setPinned(rest.length ? rest[Math.max(0, cards.findIndex((x) => x.id === id)) % rest.length].id : null)
      }
    } catch (e) {
      setOut({ text: e instanceof Error ? e.message : String(e), err: true })
    } finally {
      setBusy(false)
    }
  }

  const keys = card?.kind === 'robot' ? keysOf(card.need) : []
  const state = useRef({ card, keys, answer, move })
  state.current = { card, keys, answer, move }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // A window or a confirmation drawn over it has the keys: no digit or y/n answers a card unseen.
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[data-nx-window], [data-nx-confirm]')) return
      const { card, keys, answer, move } = state.current
      if (e.key === 'Escape') onClose()
      else if (typing(e.target)) return
      else if (e.key === 'ArrowRight') move(1)
      else if (e.key === 'ArrowLeft') move(-1)
      // No card shown (one settled elsewhere): only the arrows and Esc do anything.
      else if (!card) return
      else if (e.key.toLowerCase() === 't') {
        onClose()
        onOpen(card.id)
      } else if (card.kind === 'captain') return
      else {
        const k = e.key.toLowerCase()
        const o = keys.find((x) => x.key === k) ?? (card.need.kind === 'permission' && /^[1-9]$/.test(k) ? keys[Number(k) - 1] : undefined)
        if (!o) return
        void answer(card, o.text)
      }
      e.preventDefault()
      e.stopPropagation()
    }
    // Capture: the view's own keys (Tab, `/`, Esc) must not see what the card took.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose, onOpen])

  if (!open) return null
  const sprite = !card ? null : card.kind === 'robot' ? SPRITES.robots[card.robot.klass].waiting : SHIP_SPRITES.captain.alert
  const permission = card?.kind === 'robot' ? card.need.kind === 'permission' : card?.wait.waitsOn === 'permission'
  const context = !card ? [] : card.kind === 'captain' ? card.wait.lines : lines?.length ? lines : [card.robot.line, card.robot.act].filter(truthy)

  // At the end of `<body>`, like the Nexus's windows: inside its layer, the open drawer (the same
  // layer, later) would paint over the card's right edge.
  return createPortal(
    <div
      data-triage=""
      role="dialog"
      aria-modal="true"
      aria-label="Triage"
      data-state="open"
      className="fixed inset-0 z-modal flex items-center justify-center bg-[#050812cc] font-mono text-[12px] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-[min(660px,92vw)] rounded-md border-[3px] border-rose-600 bg-[#12081a] px-4 py-3.5 text-slate-200 shadow-[0_0_0_3px_#000,8px_8px_0_#000,0_0_60px_#e11d4844]">
        <div className="flex items-center gap-2.5 text-[14px] tracking-wider text-rose-200">
          TRIAGE
          {card && (
            <span data-triage-count="" className="text-white">
              {i + 1}/{cards.length}
            </span>
          )}
          <button type="button" className="ml-auto border-2 border-rose-950 px-1.5 text-[11px] text-rose-300" onClick={onClose}>
            esc
          </button>
        </div>
        {gone ? (
          <div data-triage-gone="" className="py-8 text-center text-[14px] text-rose-200">
            {gone} was settled elsewhere — ← → for the next
          </div>
        ) : !card ? (
          <div data-triage-settled="" className="py-8 text-center text-[16px] text-green-300">
            ✓ all settled — the fleet flies on
          </div>
        ) : (
          <div data-triage-card={card.id} data-triage-kind={card.kind}>
            <div className="mt-3 mb-2 flex items-center gap-3">
              {sprite && <img src={sprite.src} alt="" width={64} height={64} style={{ imageRendering: 'pixelated' }} />}
              <div className="min-w-0">
                <div data-triage-crumbs="" className="truncate text-rose-300">
                  {card.crumbs.map((c, k) => (
                    <span key={k}>
                      {k > 0 && ' ▸ '}
                      {k === card.crumbs.length - 1 ? <b className="text-white">{c}</b> : c}
                    </span>
                  ))}
                </div>
                <div className="truncate font-bold text-slate-200">{card.title}</div>
              </div>
            </div>
            <div data-triage-question="" className="my-2 border-l-4 border-rose-600 bg-[#2a0a17] px-2.5 py-2 text-[14px] break-words whitespace-pre-wrap text-white">
              {card.kind === 'captain' ? (
                <>
                  {permission ? '🔒 ' : '❓ '}
                  {captainWait(card.wait)}
                </>
              ) : (
                <>
                  {permission ? '🔒 wants to run: ' : '❓ '}
                  {card.need.text}
                </>
              )}
            </div>
            <div data-triage-lines="" className="mb-2.5 border border-dashed border-[#3f1d2b] px-2 py-1.5 text-[11px] text-slate-400">
              {context.map((l, k) => (
                <div key={k} className="truncate">
                  {l}
                </div>
              ))}
              {!context.length && <div>no context</div>}
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              {card.kind === 'captain' && (
                <button
                  type="button"
                  data-triage-open=""
                  className="rounded-sm border-2 border-rose-600 bg-rose-600 px-2.5 py-1 font-bold text-white"
                  onClick={() => {
                    onClose()
                    onOpen(card.id)
                  }}
                >
                  <kbd className="mr-1.5 rounded-sm border border-gray-500 bg-black px-1 text-[10px] text-gray-200">T</kbd>
                  open
                </button>
              )}
              {keys.map((o, k) => (
                <button
                  key={o.text}
                  type="button"
                  disabled={busy}
                  data-triage-option={o.text}
                  className={`rounded-sm border-2 border-rose-600 px-2.5 py-1 font-bold disabled:opacity-50 ${k === 0 ? 'bg-rose-600 text-white' : 'bg-[#2a0a17] text-rose-200'}`}
                  onClick={() => card.kind === 'robot' && void answer(card, o.text)}
                >
                  <kbd className="mr-1.5 rounded-sm border border-gray-500 bg-black px-1 text-[10px] text-gray-200">{o.key.toUpperCase()}</kbd>
                  {armed === `always:${card.id}` && o.text === 'always' ? `${o.key.toUpperCase()} again: always` : o.label}
                </button>
              ))}
            </div>
            {card.kind === 'robot' && !permission && (
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (words.trim()) void answer(card, words.trim())
                }}
              >
                <input
                  aria-label="Answer in words"
                  className="flex-1 border-2 border-rose-950 bg-[#0b0b10] px-2 py-1 text-white outline-none"
                  placeholder="or type the answer (Enter sends)"
                  value={words}
                  disabled={busy}
                  onChange={(e) => setWords(e.target.value)}
                />
              </form>
            )}
            {out && (
              <div data-triage-out="" role="status" className={`mt-2 break-words ${out.err ? 'text-rose-300' : 'text-green-300'}`}>
                {out.text}
              </div>
            )}
            <div className="mt-2.5 text-[11px] text-[#9f8a93]">
              {card.kind === 'captain'
                ? 'answer it in its own terminal'
                : permission
                  ? 'Y N approve / deny'
                  : `1–${Math.min(9, card.need.options.length)} choose`}{' '}
              · ← → previous / next · T opens the terminal · Esc back to the ship
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
