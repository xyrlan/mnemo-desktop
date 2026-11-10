// The command line: one field at the foot of the frame, in every view. `;` opens it; what it
// offers is completed against the world; a batch verb is asked about before it runs.

import { useEffect, useRef } from 'react'
import { Kbd, StateMark } from '../ds'
import { useRoute } from '../world/route'
import { useWorld } from '../world/store'
import './command.css'
import { closeCommand, complete, enter, escape, lineStore, move, openCommand, rows, type, type Row } from './line'

const HINT = "new · shell · dispatch · message · merge green · land · stop · or a session's name"

function RowView({ row, selected, onTake }: { row: Row; selected: boolean; onTake: () => void }) {
  if (row.kind === 'hint') {
    return (
      <div className="frame-cmd-row" data-kind="hint">
        <span className="frame-cmd-mark" />
        <span className="frame-cmd-sub">{row.text}</span>
      </div>
    )
  }
  const offer = row.kind === 'offer' ? row.offer : null
  const key = row.kind === 'confirm' ? 'Enter' : row.kind === 'run' ? 'Enter' : offer?.runs ? 'Enter' : 'Tab'
  return (
    // The mouse takes a row without taking the caret out of the line.
    <button type="button" role="option" aria-selected={selected} className="frame-cmd-row" data-kind={row.kind} data-selected={selected || undefined} onMouseDown={(e) => e.preventDefault()} onClick={onTake}>
      <span className="frame-cmd-mark">{offer ? offer.state ? <StateMark state={offer.state} /> : <b>{offer.tag}</b> : <b>{row.kind === 'confirm' ? 'sure?' : 'run'}</b>}</span>
      <span className="frame-cmd-main">{offer ? offer.label : row.kind === 'offer' ? '' : row.says}</span>
      <span className="frame-cmd-sub">{offer ? offer.detail : row.kind === 'confirm' ? 'Enter does it · Esc takes it back' : row.kind === 'run' && row.batch ? 'asked about before it runs' : ''}</span>
      <span className="frame-cmd-key">{selected && <Kbd>{key}</Kbd>}</span>
    </button>
  )
}

export function CommandLine() {
  const open = useRoute((r) => r.command)
  const world = useWorld((w) => w)
  const state = lineStore()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) input.current?.focus()
    else if (document.activeElement === input.current) input.current?.blur()
  }, [open, state.focus])

  const list = open ? rows(state, world) : []
  const take = (i: number) => {
    lineStore.setState({ at: i })
    void enter(world)
  }

  return (
    <div className="frame-cmd-line" data-open={open || undefined} data-busy={state.busy || undefined}>
      {open && (
        <div className="frame-cmd-pop" role="listbox" aria-label="What the line can do">
          {state.said && !state.said.ok && (
            <div className="frame-cmd-row" data-kind="refused">
              <span className="frame-cmd-mark">
                <b>no</b>
              </span>
              <span className="frame-cmd-sub">{state.said.text}</span>
            </div>
          )}
          {list.map((row, i) => (
            <RowView key={i} row={row} selected={i === state.at} onTake={() => take(i)} />
          ))}
        </div>
      )}
      <label className="frame-cmd-field">
        <span className="frame-cmd-sign">;</span>
        <input
          ref={input}
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-label="Command line"
          placeholder={HINT}
          value={open ? state.text : ''}
          onChange={(e) => type(e.target.value)}
          onFocus={() => !open && openCommand()}
          onBlur={() => !lineStore.getState().text && !lineStore.getState().busy && closeCommand()}
          onKeyDown={(e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return
            if (e.key === 'Escape') escape()
            else if (e.key === 'ArrowDown') move(1, world)
            else if (e.key === 'ArrowUp') move(-1, world)
            else if (e.key === 'Tab') complete(world)
            else if (e.key === 'Enter') void enter(world)
            else return
            e.preventDefault()
          }}
        />
      </label>
      {!open && state.said && (
        <span className="frame-cmd-said" data-ok={state.said.ok}>
          {state.said.text}
        </span>
      )}
    </div>
  )
}
