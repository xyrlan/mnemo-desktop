import { Command } from 'cmdk'
import { useEffect } from 'react'
import { store, useApp } from '../layout/app-store'
import { all, run } from '../actions/registry'

export default function Palette() {
  const open = useApp((s) => s.paletteOpen)
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.getState().setPalette(false)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])
  if (!open) return null
  return (
    <div className="palette-overlay" onMouseDown={() => store.getState().setPalette(false)}>
      <Command className="palette" onMouseDown={(e) => e.stopPropagation()} label="Commands">
        <Command.Input autoFocus placeholder="Type a command…" />
        <Command.List>
          <Command.Empty>No matches</Command.Empty>
          {all()
            .filter((a) => a.id !== 'palette.open')
            .map((a) => (
              <Command.Item
                key={a.id}
                value={a.title}
                onSelect={() => {
                  store.getState().setPalette(false)
                  run(a.id)
                }}
              >
                <span>{a.title}</span>
                {a.shortcut && <span className="shortcut">{a.shortcut}</span>}
              </Command.Item>
            ))}
        </Command.List>
      </Command>
    </div>
  )
}
