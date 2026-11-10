// The menu, drawn: the app's own, in the app's identity, keyed. The frame renders it once,
// over everything. It takes the keys while it is open (arrows, Enter, Esc, a first letter) and
// gives them back when it closes; it closes on Esc, on a click elsewhere, on a change of view
// and when what it is on leaves the world; and it stays inside the window.

import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { Figure, Kbd, StateMark } from '../ds'
import { projectMarks } from '../roster/model'
import { terminalName } from '../roster/terminals'
import { useHosted } from '../runtime'
import { routeStore } from '../world/route'
import { useWorld } from '../world/store'
import { edgeItem, letterItem, menuOf, stepItem, type Item } from './model'
import { choose, closeMenu, hold, menuStore, stepBack, typeLine, type Place } from './state'
import './menu.css'

/** How far the menu keeps from the window's edges, in pixels. */
export const EDGE = 8

/** Where the menu's top left corner goes, so that all of it is inside the window. At the
 *  pointer it opens down and to the right, and the other way where there is no room; against
 *  an element it opens under it, or over it. */
export function placeMenu(at: Place, size: { w: number; h: number }, room: { w: number; h: number }): { left: number; top: number } {
  let left: number
  let top: number
  if ('box' in at) {
    const b = at.box
    left = b.left + Math.min(24, Math.max(0, b.right - b.left) / 4)
    top = b.bottom + 2
    if (top + size.h > room.h - EDGE && b.top - size.h - 2 >= EDGE) top = b.top - size.h - 2
  } else {
    left = at.x
    top = at.y
    if (left + size.w > room.w - EDGE) left = at.x - size.w
    if (top + size.h > room.h - EDGE) top = at.y - size.h
  }
  const within = (v: number, most: number) => Math.round(Math.max(EDGE, Math.min(v, most)))
  return { left: within(left, room.w - EDGE - size.w), top: within(top, room.h - EDGE - size.h) }
}

function Row({ item, hand, part, first }: { item: Item; hand: boolean; part: number; first: boolean }) {
  const asked = menuStore((s) => s.asked === item.id)
  const typing = menuStore((s) => s.typing === item.id)
  const busy = menuStore((s) => s.busy === item.id)
  const draft = menuStore((s) => s.draft)
  const refused = menuStore((s) => (s.refused?.item === item.id ? s.refused.why : null))
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (typing) field.current?.focus({ preventScroll: true })
  }, [typing])

  return (
    <>
      {first && <i className="menu-rule" role="separator" />}
      <div
        className="menu-row"
        role="menuitem"
        id={`menu-item-${item.id}`}
        data-menu-item={item.id}
        data-hand={hand || undefined}
        data-off={item.off ? true : undefined}
        data-asked={asked || undefined}
        data-busy={busy || undefined}
        aria-disabled={item.off ? true : undefined}
        // The mouse takes a row without taking the keys from the list.
        onMouseDown={(e) => e.preventDefault()}
        onPointerMove={() => !item.off && hold(item.id, hand ? part : 0)}
        onClick={() => void choose(item)}
      >
        <span className="menu-label">{asked && item.ask ? item.ask : item.label}</span>
        {item.parts && (
          <span className="menu-parts">
            {item.parts.map((p, j) => (
              <button
                key={p.id}
                type="button"
                tabIndex={-1}
                className="menu-part"
                data-menu-part={p.id}
                data-hand={(hand && part === j) || undefined}
                onPointerMove={(e) => {
                  e.stopPropagation()
                  hold(item.id, j)
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  void choose(item, j)
                }}
              >
                {p.label}
              </button>
            ))}
          </span>
        )}
        <span className="menu-hint">
          {item.off ? (
            item.off
          ) : busy ? (
            '…'
          ) : asked ? (
            <>
              <Kbd>Enter</Kbd> yes
            </>
          ) : (
            item.hint
          )}
        </span>
      </div>
      {typing && item.type != null && (
        <form
          className="menu-type mn-mono"
          onSubmit={(e) => {
            e.preventDefault()
            void choose(item)
          }}
        >
          <span aria-hidden="true">&gt;</span>
          <input ref={field} type="text" autoComplete="off" spellCheck={false} aria-label={item.label} placeholder={item.type} value={draft} disabled={busy} onChange={(e) => typeLine(e.target.value)} />
          <Kbd>Enter</Kbd>
        </form>
      )}
      {refused && (
        <p className="menu-refused" role="status" data-menu-refused={item.id}>
          <b>no</b>
          {refused}
        </p>
      )}
    </>
  )
}

/** The one menu, when it is open. */
export function Menu() {
  const open = menuStore((s) => s.open)
  const at = menuStore((s) => s.at)
  const part = menuStore((s) => s.part)
  const typing = menuStore((s) => s.typing)
  const world = useWorld((w) => w)
  const hosted = useHosted()
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const menu = useMemo(() => (open ? menuOf(world, open.target, hosted, terminalName) : null), [world, open, hosted])
  const items = menu?.items ?? []
  const found = items.findIndex((i) => i.id === at && !i.off)
  const hand = found >= 0 ? found : edgeItem(items, false)

  // What it was on left the world: it closes.
  useEffect(() => {
    if (open && !menu) closeMenu()
  }, [open, menu])

  // A change of view closes it.
  useEffect(
    () =>
      routeStore.subscribe((s, was) => {
        if (s.route.view !== was.route.view) closeMenu()
      }),
    [],
  )

  // A click, a turn of the wheel or a right-click anywhere else closes it; so does a window
  // that changed size under it.
  const shown = !!menu
  useEffect(() => {
    if (!shown) return
    const outside = (e: Event) => {
      if (!(e.target instanceof Node && root.current?.contains(e.target))) closeMenu()
    }
    const resized = () => closeMenu()
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('wheel', outside, { capture: true, passive: true })
    window.addEventListener('resize', resized)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('wheel', outside, true)
      window.removeEventListener('resize', resized)
    }
  }, [shown])

  // It takes the keys when it opens, and takes them back from a line that was being typed.
  const n = open?.n
  useLayoutEffect(() => {
    if (shown && !typing) list.current?.focus({ preventScroll: true })
  }, [shown, n, typing])

  // It is measured as it came out and put where all of it is inside the window.
  useLayoutEffect(() => {
    const el = root.current
    if (!el || !open) return
    const { left, top } = placeMenu(open.place, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight })
    el.style.transform = `translate(${left}px, ${top}px)`
  })

  if (!open || !menu) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The app's own chords stay the app's.
    if (e.ctrlKey || e.metaKey || ['Alt', 'Shift', 'Control', 'Meta'].includes(e.key)) return
    // Everything else is the menu's while it is open: nothing under it hears a key.
    e.stopPropagation()
    const item = items[hand] as Item | undefined
    if (e.target instanceof HTMLInputElement) {
      if (e.key === 'Escape') {
        e.preventDefault()
        stepBack()
      } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault()
        if (!e.repeat) void choose(item)
      }
      return
    }
    e.preventDefault()
    const to = (i: number) => i >= 0 && hold(items[i].id)
    // ⌥ on a Mac changes the character a key types: the physical key names the letter then.
    const typed = e.altKey ? (/^Key([A-Z])$/.exec(e.code)?.[1] ?? e.key) : e.key
    switch (e.key) {
      case 'ArrowDown':
        return void to(stepItem(items, hand, 1))
      case 'ArrowUp':
        return void to(stepItem(items, hand, -1))
      case 'Tab':
        return void to(stepItem(items, hand, e.shiftKey ? -1 : 1))
      case 'Home':
        return void to(edgeItem(items, false))
      case 'End':
        return void to(edgeItem(items, true))
      case 'ArrowLeft':
      case 'ArrowRight': {
        const parts = item?.parts?.length ?? 0
        if (item && parts > 1) hold(item.id, (part + (e.key === 'ArrowRight' ? 1 : parts - 1)) % parts)
        return
      }
      case 'Enter':
      case ' ':
        // A key held down does not answer the question it just asked.
        if (!e.repeat) void choose(item)
        return
      case 'Escape':
        return stepBack()
    }
    if (e.repeat || !/^\p{L}$/u.test(typed)) return
    const hit = letterItem(items, hand, typed)
    if (!hit) return
    if (hit.only) void choose(items[hit.at])
    else hold(items[hit.at].id)
  }

  const s = menu.session
  const kind = menu.target.kind
  return (
    <div
      ref={root}
      className="menu"
      data-menu-root
      data-menu-on={`${kind}:${kind === 'project' ? menu.target.name : menu.target.id}`}
      data-state={s?.state}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <header className="menu-head">
        {s ? (
          <Figure id={s.id} size="2.1em" />
        ) : (
          <span className="menu-sign mn-mono" aria-hidden="true">
            {kind === 'terminal' ? '>_' : (projectMarks(world).get(menu.title) ?? menu.title.slice(0, 3).toUpperCase())}
          </span>
        )}
        <span className="menu-who">
          <b className="menu-title">{menu.title}</b>
          <span className="menu-sub">
            {s && <StateMark state={s.state} word />}
            {menu.sub && <span>{menu.sub}</span>}
          </span>
        </span>
      </header>
      <div ref={list} className="menu-list" role="menu" tabIndex={-1} aria-label={kind === 'project' ? `Project ${menu.title}` : menu.title} aria-activedescendant={hand >= 0 ? `menu-item-${items[hand].id}` : undefined}>
        {items.map((item, i) => (
          <Row key={item.id} item={item} hand={i === hand} part={i === hand ? Math.min(part, Math.max(0, (item.parts?.length ?? 1) - 1)) : 0} first={i > 0 && items[i - 1].group !== item.group} />
        ))}
      </div>
      <footer className="menu-foot">
        <span>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </span>
        <span>
          <Kbd>Enter</Kbd> or a first letter
        </span>
        <span>
          <Kbd>Esc</Kbd>
        </span>
      </footer>
    </div>
  )
}
