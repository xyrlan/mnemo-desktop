// What the vault can be asked to do as a whole, and every run from the panel: its command, where
// it ran, how it ended, what it printed.

import { useEffect, useRef } from 'react'
import { ACTIONS } from '../../vault/actions'
import { useVault, vault } from '../../vault/app-store'
import type { LogEntry } from '../../vault/store'
import { decisionsFor, parseWhy } from '../../vault/why'
import { ArmBtn, Btn, Out, short } from './kit'
import { ended } from './model'

/** The actions that are the vault's, not a page's: the page's own (why, disable) are on the page. */
const VAULT_WIDE = ['reverify', 'rewrites', 'rewrites-apply', 'learn', 'status']

/** One button per vault-wide action; one that changes the vault is asked twice. */
export function RunBar({ cwd }: { cwd: string }) {
  const log = useVault((s) => s.log)
  return (
    <div className="sp-wrap memory-runbar" data-runbar="">
      <span className="mn-label">mnemo</span>
      {ACTIONS.filter((a) => VAULT_WIDE.includes(a.id)).map((a) => {
        const busy = log.some((e) => e.actionId === a.id && e.result === null)
        const label = busy ? `${a.label}…` : a.label
        return a.destructive ? (
          <ArmBtn key={a.id} small disabled={busy} sure={`${a.title}? Press again`} onConfirm={() => void vault.getState().run(a.id, cwd)}>
            {label}
          </ArmBtn>
        ) : (
          <Btn key={a.id} small disabled={busy} onClick={() => void vault.getState().run(a.id, cwd)}>
            {label}
          </Btn>
        )
      })}
    </div>
  )
}

/** `mnemo why --json` as decisions: when, what fired with its score or why nothing did, and the
 *  best candidates. Those that mention the page the run was for, when any does. */
function WhyList({ entry }: { entry: LogEntry }) {
  const all = parseWhy(entry.result?.stdout ?? '')
  if (!all) return null
  const { shown, matched } = decisionsFor(all, entry.slug ?? undefined)
  const note = matched ? `${shown.length} of ${all.length} decisions mention ${entry.slug}` : `${all.length} recent decisions${entry.slug ? `, none mention ${entry.slug}` : ''}`
  return (
    <div className="memory-why">
      <div className="sp-dim">{note}</div>
      {shown.map((d, i) => (
        <div key={i} className="memory-why-row">
          <span className="sp-dim sp-mono">{d.ts.replace('T', ' ').slice(0, 19)}</span>
          {d.emitted.length ? (
            <span className="memory-fired">fired {d.emitted.map((e, j) => (d.scores[j] === undefined ? e : `${e} (${d.scores[j].toFixed(1)})`)).join(', ')}</span>
          ) : (
            <span className="memory-held">{d.silence_reason ?? 'silent'}</span>
          )}
          {d.candidates.length > 0 && (
            <span className="sp-dim">
              {d.candidates
                .slice(0, 3)
                .map(([c, s]) => `${c} ${s.toFixed(1)}`)
                .join(' · ')}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/** Every action run from the panel, newest last. */
export function RunLog() {
  const log = useVault((s) => s.log)
  const box = useRef<HTMLDivElement>(null)
  // The newest run from its first line: its command and how it ended, then what it printed.
  useEffect(() => {
    const last = box.current?.lastElementChild
    if (box.current && last instanceof HTMLElement) box.current.scrollTop = last.offsetTop
  }, [log])
  if (log.length === 0) return null
  return (
    <div ref={box} className="memory-log" aria-label="Runs">
      {log.map((e) => {
        const r = e.result
        const ok = r?.code === 0
        const why = e.actionId === 'why' && r && parseWhy(r.stdout)
        return (
          <div key={e.id} className="memory-run" data-run={e.actionId} data-ok={r ? String(ok) : undefined}>
            <div className="sp-row memory-run-head">
              <span className="sp-grow sp-mono sp-clip">$ {e.line}</span>
              <span className="sp-dim sp-mono">{e.cwd ? short(e.cwd) : '~'}</span>
              <span className="sp-tag" data-tone={r ? (ok ? 'ok' : 'bad') : undefined}>
                {r ? ended(r) : 'running…'}
              </span>
              <button type="button" className="sp-x" aria-label="Dismiss" onClick={() => vault.getState().dismiss(e.id)}>
                ×
              </button>
            </div>
            {why ? <WhyList entry={e} /> : r?.stdout.trim() && <Out>{r.stdout.trimEnd()}</Out>}
            {r?.stderr.trim() && <Out tone="bad">{r.stderr.trimEnd()}</Out>}
          </div>
        )
      })}
    </div>
  )
}
