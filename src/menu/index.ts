// A menu on every session and on every project's name: the second way to what is already on
// screen, from wherever a session is drawn, without changing what is on stage
// (docs/superpowers/specs/2026-11-10-session-menu.md).
//
//   ./model  what it holds, from the world: an item is there only when it applies
//   ./state  the one menu: what it is on, the item in hand, what an item is in the middle of
//   ./open   how it opens: a view marks what it draws and hands over its right-clicks; the
//            frame's keys open it on the selection
//   ./Menu   the menu drawn, and its keys
//
// A view marks what draws a session (`{...drawsSession(id)}`), a project's name or a held
// terminal, and gives its root `onContextMenu={contextMenu}`. The frame renders `<Menu />` once.

export { Menu, placeMenu } from './Menu'
export { menuOf, type Item, type Target } from './model'
export { contextMenu, drawingOf, drawnAt, drawsProject, drawsSession, drawsTerminal, menuByKey, openOn } from './open'
export { closeMenu, menuStore, openMenu } from './state'
