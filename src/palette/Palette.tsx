import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command'
import { Kbd, KbdGroup } from '@/ui/kbd'
import { store, useApp } from '../layout/app-store'
import { all, run } from '../actions/registry'
import { aboutLine, buildInfo, type BuildInfo } from '../about/info'

// Dictation types into the pane behind the palette, not into its field (src/voice/route.ts).
const PALETTE: Record<string, string> = { 'data-palette': '' }

/** A shortcut as keycaps: `⌘⇧G` is three keys, `Ctrl+E` two. */
export function shortcutKeys(shortcut: string): string[] {
  return shortcut.includes('+') ? shortcut.split('+') : [...shortcut]
}

/** ⌘K: every action, searched by its title; Enter runs the selected one. The build that is
 *  running is named at the bottom, so a stale bundle reads as stale. */
export default function Palette() {
  const open = useApp((s) => s.paletteOpen)
  const [build, setBuild] = useState<BuildInfo | null>(null)
  // A dismissal puts the focus back where it was (a terminal, say); an action that ran decides
  // where it goes (a prompt, a new pane). With no trigger, Radix would leave it on <body>.
  const back = useRef<HTMLElement | null>(null)
  const ran = useRef(false)
  useEffect(() => {
    let live = true
    void buildInfo().then((b) => live && setBuild(b))
    return () => {
      live = false
    }
  }, [])
  const about = aboutLine(build)
  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => store.getState().setPalette(o)}
      title="Command palette"
      description="Search every command by name"
      onOpenAutoFocus={() => {
        back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        if (!ran.current) back.current?.focus()
        back.current = null
        ran.current = false
      }}
      commandProps={{ loop: true, label: 'Commands', className: '[&_[cmdk-item]]:py-2', ...PALETTE }}
    >
      <CommandInput placeholder="Type a command…" />
      <CommandList className="p-1.5">
        <CommandEmpty>No matches</CommandEmpty>
        {all()
          .filter((a) => a.id !== 'palette.open')
          .map((a) => (
            <CommandItem
              key={a.id}
              value={a.title}
              onSelect={() => {
                ran.current = true
                // Closed first, so the dialog no longer holds the focus when the action moves it.
                flushSync(() => store.getState().setPalette(false))
                run(a.id)
              }}
            >
              <span className="min-w-0 flex-1 truncate">{a.title}</span>
              {a.shortcut && (
                <KbdGroup className="shrink-0">
                  {shortcutKeys(a.shortcut).map((k, i) => (
                    <Kbd key={i}>{k}</Kbd>
                  ))}
                </KbdGroup>
              )}
            </CommandItem>
          ))}
      </CommandList>
      {about && <div className="palette-about border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground select-text">{about}</div>}
    </CommandDialog>
  )
}
