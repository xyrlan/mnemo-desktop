import { useEffect, useRef, type JSX } from 'react'
import { useVault, vault } from '../../../vault/app-store'
import type { LogEntry } from '../../../vault/store'
import { decisionsFor, parseWhy } from '../../../vault/why'
import { short } from './kit'

function WhyList({ entry }: { entry: LogEntry }) {
  const all = parseWhy(entry.result?.stdout ?? '')
  if (!all) return null
  const { shown, matched } = decisionsFor(all, entry.slug ?? undefined)
  const note = matched ? `${shown.length} of ${all.length} decisions mention ${entry.slug}` : `${all.length} recent decisions${entry.slug ? `, none mention ${entry.slug}` : ''}`
  return (
    <div className="nx-mem-why">
      <div className="nx-muted">{note}</div>
      {shown.map((d, i) => (
        <div key={i} className="nx-mem-why-row">
          <span className="nx-muted">{d.ts.replace('T', ' ').slice(0, 19)}</span>
          {d.emitted.length ? (
            <span className="nx-mem-good">fired {d.emitted.map((e, j) => (d.scores[j] === undefined ? e : `${e} (${d.scores[j].toFixed(1)})`)).join(', ')}</span>
          ) : (
            <span className="nx-mem-warn">{d.silence_reason ?? 'silent'}</span>
          )}
          {d.candidates.length > 0 && (
            <span className="nx-muted">
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

/** Every action run from the window, newest last: its command, where, how it ended, what it printed. */
export function RunLog(): JSX.Element | null {
  const log = useVault((s) => s.log)
  const end = useRef<HTMLDivElement>(null)
  // Braced: in Chromium `scrollIntoView` returns a promise, which React would call as the cleanup.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [log])
  if (log.length === 0) return null
  return (
    <div className="nx-mem-log" aria-label="Runs">
      {log.map((e) => {
        const r = e.result
        const ok = r?.code === 0
        const why = e.actionId === 'why' && r && parseWhy(r.stdout)
        return (
          <div key={e.id} className="nx-mem-run" data-run={e.actionId} data-ok={r ? String(ok) : undefined}>
            <div className="nx-mem-run-head">
              <span className="nx-mem-grow nx-mem-sub">$ {e.line}</span>
              <span className="nx-muted">{e.cwd ? short(e.cwd) : '~'}</span>
              <span className={r ? (ok ? 'nx-mem-good' : 'nx-mem-bad') : 'nx-muted'}>{r ? (r.code === null ? 'not run' : `exit ${r.code}`) : 'running…'}</span>
              <button type="button" className="nx-mem-x" aria-label="Dismiss" onClick={() => vault.getState().dismiss(e.id)}>
                ×
              </button>
            </div>
            {why ? <WhyList entry={e} /> : r?.stdout.trim() && <pre className="nx-mem-out">{r.stdout.trimEnd()}</pre>}
            {r?.stderr.trim() && <pre className="nx-mem-out nx-mem-bad">{r.stderr.trimEnd()}</pre>}
          </div>
        )
      })}
      <div ref={end} />
    </div>
  )
}
