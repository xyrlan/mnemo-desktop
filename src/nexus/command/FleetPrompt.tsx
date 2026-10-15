import { useEffect, useRef, useState, type JSX } from 'react'
import type { FleetPromptProps, ShipAction } from '../ship-types'
import { CONFIRM_MS, HINT, parseCommand } from './parse'

type Out = { text: string; err: boolean }
type Pending = { action: ShipAction; until: number }

/** The bridge's prompt (`/` focuses it): orders for the whole fleet (spec "Fleet prompt"). Its
 *  input sits in `[data-fleet-prompt]`; under it, the hint and the last result. A batch verb waits
 *  for `/yes` for 20 s, then lapses. */
export function FleetPrompt({ ship, run }: FleetPromptProps): JSX.Element | null {
  const [line, setLine] = useState('')
  const [out, setOut] = useState<Out | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef<Pending | null>(null)
  const lapse = useRef<number | undefined>(undefined)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      window.clearTimeout(lapse.current)
    }
  }, [])

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

  const submit = () => {
    const typed = line.trim()
    if (!typed || busy) return
    setLine('')
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

  return (
    <div data-fleet-prompt="" className="flex min-w-0 flex-col gap-0.5 font-mono text-[11px]">
      <form
        className="flex items-center gap-2 rounded-sm border-2 border-indigo-700 bg-[#0b0d22] px-2 py-1 focus-within:border-indigo-300"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span aria-hidden className="font-bold text-indigo-300">
          ›
        </span>
        <input
          aria-label="Orders for the fleet"
          className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-indigo-300/50"
          placeholder="orders for the fleet (key /)…   /dispatch mnemo #123   ·   /msg #682 text   ·   /msg all text"
          spellCheck={false}
          autoComplete="off"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur()
          }}
        />
      </form>
      <div data-fleet-hint="" className="truncate text-[10.5px] text-indigo-300/70">
        {HINT} · shift+click selects several
      </div>
      <div data-fleet-out="" role="status" aria-live="polite" className={`min-h-[14px] break-words ${out?.err ? 'text-rose-300' : 'text-green-300'}`}>
        {out?.text ?? ''}
      </div>
    </div>
  )
}
