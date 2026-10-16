import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { FleetPromptProps, ShipAction } from '../ship-types'
import { openSession } from '../drawer/open'
import { CONFIRM_MS, parseCommand, parseNew, suggest, type Verb } from './parse'
import './command.css'

type Out = { text: string; err: boolean }
type Pending = { action: ShipAction; until: number }

/** The keys the line acts on itself. */
const OWN = new Set(['Escape', 'Tab', 'ArrowUp', 'ArrowDown'])

/** The fleet's command line (`/` opens it, issue #469): orders for the whole fleet, floating over
 *  the bridge's top edge while open, nowhere while closed. Its input sits in `[data-fleet-prompt]`;
 *  under it, the verbs that fit what is typed (↑/↓ pick, Tab completes) and the last result. Esc
 *  or a click outside closes it. A batch verb waits for `/yes` for 20 s, then lapses; closed and
 *  reopened within them, the line still takes it. */
export function FleetPrompt({ ship, repos, run, open, onClose }: FleetPromptProps): JSX.Element | null {
  const [line, setLine] = useState('')
  const [out, setOut] = useState<Out | null>(null)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState(0)
  const pending = useRef<Pending | null>(null)
  const lapse = useRef<number | undefined>(undefined)
  const live = useRef(true)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      window.clearTimeout(lapse.current)
    }
  }, [])

  const waiting = () => !!pending.current && Date.now() <= pending.current.until
  const verbs = suggest(line).filter((v) => v.fill !== '/yes' || waiting())
  const picked = verbs.length ? Math.min(pick, verbs.length - 1) : -1
  const complete = (v: Verb | undefined) => {
    // Only forward: a verb whose arguments are being typed keeps them.
    if (!v || !v.fill.startsWith(line.trimStart().toLowerCase())) return
    setLine(v.fill)
    setPick(0)
  }

  // Opened, it has `/` typed and drops a result nothing waits on any more, in the very render that
  // opens it: a key typed right after `/` lands after the `/`.
  const [shown, setShown] = useState(false)
  if (open !== shown) {
    setShown(open)
    if (open) {
      if (!pending.current && !busy) setOut(null)
      setLine((l) => l || '/')
      setPick(0)
    }
  }
  // …and takes the focus, its caret at the end.
  useLayoutEffect(() => {
    const el = input.current
    if (!open || !el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [open])

  // A key typed in it is its own: stopped ahead of every other listener (the drawer's and Triage's
  // are in the capture phase too), so none reaches the ship, the drawer or Triage. What it types
  // and Enter's submit are the keys' defaults, which still happen. A chord (⌘, ⌃, ⌥) is the app's.
  // A click anywhere else closes it.
  const state = useRef({ verbs, picked, complete, onClose })
  state.current = { verbs, picked, complete, onClose }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!(e.target instanceof Node) || !box.current?.contains(e.target)) return
      e.stopPropagation()
      if (!OWN.has(e.key) || e.isComposing) return
      const { verbs, picked, complete, onClose } = state.current
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Tab') complete(verbs[Math.max(picked, 0)])
      else if (verbs.length) setPick((picked + (e.key === 'ArrowDown' ? 1 : verbs.length - 1)) % verbs.length)
      e.preventDefault()
    }
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && box.current?.contains(e.target)) return
      state.current.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [open])

  const say = (text: string, err: boolean) => live.current && setOut({ text, err })

  const go = async (action: ShipAction) => {
    setBusy(true)
    say('…', false)
    try {
      const r = await run(action)
      say(r.say, !r.ok)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    } finally {
      if (live.current) setBusy(false)
    }
  }

  /** `/new <repo>`: the session opens in a drawer tab. */
  const start = async (repo: { root: string; name: string }) => {
    setBusy(true)
    say('…', false)
    try {
      await openSession({ kind: 'claude', root: repo.root })
      say(`▸ claude started in ${repo.name}`, false)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    } finally {
      if (live.current) setBusy(false)
    }
  }

  const submit = () => {
    const typed = line.trim()
    if (!typed || busy) return
    setLine('')
    const fresh = parseNew(typed, ship, repos)
    if (fresh) {
      if ('error' in fresh) return say(fresh.error, true)
      // An order, like any other: a batch still waiting for its `/yes` lapses.
      pending.current = null
      window.clearTimeout(lapse.current)
      return void start(fresh)
    }
    const p = parseCommand(typed, ship)
    if ('error' in p) return say(p.error, true)
    if ('yes' in p) {
      const waiting = pending.current
      pending.current = null
      window.clearTimeout(lapse.current)
      if (!waiting || Date.now() > waiting.until) return say('nothing to confirm', true)
      return void go(waiting.action)
    }
    if ('confirm' in p) {
      pending.current = { action: p.confirm, until: Date.now() + CONFIRM_MS }
      window.clearTimeout(lapse.current)
      lapse.current = window.setTimeout(() => {
        if (!pending.current) return
        pending.current = null
        say('not confirmed within 20 s: nothing was done', true)
      }, CONFIRM_MS)
      return say(p.prompt, false)
    }
    // Any other order replaces a batch still waiting for its `/yes`.
    pending.current = null
    window.clearTimeout(lapse.current)
    void go(p.action)
  }

  if (!open) return null
  const option = (k: number) => `fleet-verb-${k}`
  return (
    <div ref={box} data-fleet-prompt="" className="ship-line">
      <form
        className="ship-line-row"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span aria-hidden className="ship-line-mark">
          ›
        </span>
        <input
          ref={input}
          aria-label="Orders for the fleet"
          role="combobox"
          aria-expanded={verbs.length > 0}
          aria-controls="fleet-verbs"
          aria-activedescendant={picked >= 0 ? option(picked) : undefined}
          aria-autocomplete="list"
          placeholder="orders for the fleet…"
          spellCheck={false}
          autoComplete="off"
          value={line}
          onChange={(e) => {
            setLine(e.target.value)
            setPick(0)
          }}
        />
        <kbd className="ship-line-esc" aria-hidden>
          esc
        </kbd>
      </form>
      {verbs.length > 0 && (
        <ul id="fleet-verbs" role="listbox" aria-label="commands" className="ship-line-verbs" data-fleet-verbs="">
          {verbs.map((v, k) => (
            <li
              key={v.syntax}
              id={option(k)}
              role="option"
              aria-selected={k === picked}
              data-verb={v.fill.trim()}
              // A click completes it, the focus staying in the input.
              onMouseDown={(e) => {
                e.preventDefault()
                complete(v)
              }}
            >
              <code>{v.syntax}</code>
              <span>{v.does}</span>
              {k === picked && v.fill.startsWith(line.trimStart().toLowerCase()) && <kbd aria-hidden>tab</kbd>}
            </li>
          ))}
        </ul>
      )}
      <div data-fleet-out="" role="status" aria-live="polite" className="ship-line-out" data-err={out?.err ? '' : undefined}>
        {out?.text ?? ''}
      </div>
    </div>
  )
}
