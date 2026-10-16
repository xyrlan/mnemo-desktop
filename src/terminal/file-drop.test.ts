import { vi } from 'vitest'

const invoke = vi.fn(async (_cmd: string, _args?: unknown) => null)
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args: unknown) => invoke(cmd, args), Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
const unlisten = vi.fn()
const onDragDropEvent = vi.fn(async (_h: unknown) => unlisten)
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent }) }))

import { store } from '../layout/app-store'
import { fileDropStore, registerDropTarget } from './drop'
import { dropScale, holdFileDrop, onFileDrag, terminalAt } from './file-drop'

/** Three panes side by side at 100px each: two terminals (7, 8) split by an editor (-3) — an
 *  overlay child of pane 7 stretches across the whole row, so `elementFromPoint` alone would
 *  misattribute a drop over pane 8 to pane 7. */
function layout() {
  store.setState({
    panes: {
      7: { id: 7, view: 'terminal' },
      8: { id: 8, view: 'terminal' },
      9: { id: 9, view: 'terminal', exitCode: 0 },
      [-3]: { id: -3, view: 'editor' },
    },
  })
  document.body.innerHTML =
    '<div class="pane" data-pane="7"><div class="overlay"></div></div>' +
    '<div class="pane" data-pane="-3"></div>' +
    '<div class="pane" data-pane="8"></div>' +
    '<div class="pane" data-pane="9"></div>'
  const [term, editor, other, exited] = [...document.querySelectorAll<HTMLElement>('.pane')]
  const rect = (left: number, width: number): DOMRect => ({ left, top: 0, width, height: 50, right: left + width, bottom: 50, x: left, y: 0, toJSON: () => ({}) })
  term.getBoundingClientRect = () => rect(0, 100)
  editor.getBoundingClientRect = () => rect(100, 100)
  other.getBoundingClientRect = () => rect(200, 100)
  exited.getBoundingClientRect = () => rect(300, 100)
  // The overlay spans every pane and would win `elementFromPoint`, but `terminalAt` no longer uses it.
  term.firstElementChild!.getBoundingClientRect = () => rect(0, 300)
  document.elementFromPoint = () => term.firstElementChild
}

beforeEach(() => {
  invoke.mockClear()
  fileDropStore.setState({ over: null })
  layout()
})

test('dragging over a terminal highlights it, over anything else clears', () => {
  onFileDrag({ type: 'over', position: { x: 100, y: 20 } }, 2) // 50 CSS px: the first terminal
  expect(fileDropStore.getState().over).toBe(7)
  onFileDrag({ type: 'over', position: { x: 300, y: 20 } }, 2) // the editor
  expect(fileDropStore.getState().over).toBeNull()
  onFileDrag({ type: 'over', position: { x: 500, y: 20 } }, 2) // the second terminal
  expect(fileDropStore.getState().over).toBe(8)
  onFileDrag({ type: 'enter', position: { x: 700, y: 20 } }, 2) // an exited terminal
  expect(fileDropStore.getState().over).toBeNull()
  onFileDrag({ type: 'over', position: { x: 10, y: 20 } }, 2)
  onFileDrag({ type: 'leave' })
  expect(fileDropStore.getState().over).toBeNull()
})

test("a split's overlay child does not steal a drop meant for the pane beside it", () => {
  // The overlay under pane 7 physically covers this point too, so a hit test built on
  // `elementFromPoint` would resolve it to 7 instead of 8.
  const id = terminalAt(250, 5)
  expect(id).toBe(8)
})

test('a pane that does not qualify does not hide a live terminal under the same point', () => {
  // A stale rect listed first (the exited terminal, 9) overlaps the live one (8).
  const [, , other, exited] = [...document.querySelectorAll<HTMLElement>('.pane')]
  document.body.prepend(exited)
  exited.getBoundingClientRect = other.getBoundingClientRect
  expect(terminalAt(250, 5)).toBe(8)
})

test('the drop position is logical on macOS and Linux, physical only on Windows', () => {
  expect(dropScale('MacIntel', 2)).toBe(1)
  expect(dropScale('Linux x86_64', 2)).toBe(1)
  expect(dropScale('Win32', 1.5)).toBe(1.5)
})

test('on a Retina Mac a drop over the right pane types into that pane', () => {
  // wry hands macOS drops over in points, the same numbers as the page's CSS px: dividing
  // them by devicePixelRatio (2) would read 250 as 125 and pick the editor to its left.
  const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  const dpr = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2)
  onFileDrag({ type: 'drop', paths: ['/tmp/a.png'], position: { x: 250, y: 5 } })
  expect(invoke).toHaveBeenCalledWith('pty_write', { id: 8, data: '/tmp/a.png ' })
  platform.mockRestore()
  dpr.mockRestore()
})

test('dropping on a terminal types the escaped paths into its PTY and focuses it', () => {
  const focus = vi.spyOn(store.getState(), 'focusPane').mockImplementation(() => {})
  onFileDrag({ type: 'drop', paths: ['/tmp/Screen Shot.png', '/tmp/b.png'], position: { x: 20, y: 5 } }, 1)
  expect(invoke).toHaveBeenCalledWith('pty_write', { id: 7, data: '/tmp/Screen\\ Shot.png /tmp/b.png ' })
  expect(focus).toHaveBeenCalledWith(7)
  expect(fileDropStore.getState().over).toBeNull()
  focus.mockRestore()
  invoke.mockClear()

  onFileDrag({ type: 'drop', paths: ['/tmp/c.png'], position: { x: 250, y: 5 } }, 1)
  expect(invoke).toHaveBeenCalledWith('pty_write', { id: 8, data: '/tmp/c.png ' })
})

test('dropping outside a live terminal writes nothing', () => {
  onFileDrag({ type: 'drop', paths: ['/tmp/a.png'], position: { x: 150, y: 5 } }, 1)
  onFileDrag({ type: 'drop', paths: ['/tmp/a.png'], position: { x: 350, y: 5 } }, 1)
  expect(invoke).not.toHaveBeenCalled()
})

/** A chat composer mounted inside pane `id`, recording what it is handed. */
function composerIn(id: number) {
  const el = document.createElement('div')
  document.querySelector(`.pane[data-pane="${id}"]`)!.appendChild(el)
  const got: string[] = []
  const off = registerDropTarget({ el, insert: (text) => got.push(text) })
  return { got, off }
}

test('on a terminal showing its conversation, the paths go into the chat, not the PTY', () => {
  const chat = composerIn(7)
  const focus = vi.spyOn(store.getState(), 'focusPane').mockImplementation(() => {})
  onFileDrag({ type: 'over', position: { x: 20, y: 5 } }, 1)
  expect(fileDropStore.getState().over).toBe(7)
  onFileDrag({ type: 'drop', paths: ['/tmp/Screen Shot.png'], position: { x: 20, y: 5 } }, 1)
  expect(chat.got).toEqual(['/tmp/Screen\\ Shot.png '])
  expect(invoke).not.toHaveBeenCalled()
  expect(focus).toHaveBeenCalledWith(7)
  // The terminal beside it, with no chat, still types.
  onFileDrag({ type: 'drop', paths: ['/tmp/b.png'], position: { x: 250, y: 5 } }, 1)
  expect(invoke).toHaveBeenCalledWith('pty_write', { id: 8, data: '/tmp/b.png ' })
  expect(chat.got).toHaveLength(1)
  focus.mockRestore()
  chat.off()
})

test("a chat in a pane that is not a terminal (a child's) takes the drop too", () => {
  const chat = composerIn(-3)
  onFileDrag({ type: 'over', position: { x: 150, y: 5 } }, 1)
  expect(fileDropStore.getState().over).toBe(-3)
  onFileDrag({ type: 'drop', paths: ['/tmp/a.png'], position: { x: 150, y: 5 } }, 1)
  expect(chat.got).toEqual(['/tmp/a.png '])
  expect(invoke).not.toHaveBeenCalled()
  chat.off()
})

test('a chat that unmounted takes nothing', () => {
  const chat = composerIn(7)
  chat.off()
  onFileDrag({ type: 'drop', paths: ['/tmp/a.png'], position: { x: 20, y: 5 } }, 1)
  expect(chat.got).toEqual([])
  expect(invoke).toHaveBeenCalledWith('pty_write', { id: 7, data: '/tmp/a.png ' })
})

test('every terminal shares one webview listener, removed with the last', async () => {
  const a = holdFileDrop()
  const b = holdFileDrop()
  expect(onDragDropEvent).toHaveBeenCalledTimes(1)
  a()
  a() // a second release of the same hold is ignored
  await Promise.resolve()
  expect(unlisten).not.toHaveBeenCalled()
  b()
  await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1))
})

test('a drop on a popup (or a drawer tab) goes to the session it shows, never to the pane under it', () => {
  const focus = vi.spyOn(store.getState(), 'focusPane').mockImplementation(() => {})
  const popup = document.body.appendChild(document.createElement('div'))
  popup.dataset.sessionPty = '60'
  popup.getBoundingClientRect = () => ({ left: 0, top: 0, width: 150, height: 50, right: 150, bottom: 50, x: 0, y: 0, toJSON: () => ({}) })
  onFileDrag({ type: 'over', position: { x: 20, y: 5 } }, 1)
  expect(fileDropStore.getState().over).toBeNull()
  onFileDrag({ type: 'drop', paths: ['/tmp/a.png'], position: { x: 20, y: 5 } }, 1)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith('pty_write', { id: 60, data: '/tmp/a.png ' })
  expect(focus).not.toHaveBeenCalled()
  // A popup still attaching takes the drop, and writes it nowhere.
  invoke.mockClear()
  popup.dataset.sessionPty = ''
  onFileDrag({ type: 'drop', paths: ['/tmp/a.png'], position: { x: 20, y: 5 } }, 1)
  expect(invoke).not.toHaveBeenCalled()
  // Beside the popup, the pane takes it as before.
  onFileDrag({ type: 'drop', paths: ['/tmp/c.png'], position: { x: 250, y: 5 } }, 1)
  expect(invoke).toHaveBeenCalledWith('pty_write', { id: 8, data: '/tmp/c.png ' })
  focus.mockRestore()
})

/** A stand-in for the voice-note transcriber: what each drop handed it. */
function transcriber() {
  const drops: { paths: string[]; sink: import('../voice/files').DropSink }[] = []
  return { drops, transcribe: async (paths: string[], sink: import('../voice/files').DropSink) => void drops.push({ paths, sink }) }
}

test('a mixed drop types its other paths at once and hands its voice notes over, in order', async () => {
  const files = transcriber()
  const focus = vi.spyOn(store.getState(), 'focusPane').mockImplementation(() => {})
  onFileDrag({ type: 'drop', paths: ['/d/a.opus', '/d/shot.png', '/d/b.OGG', '/d/c.oga', '/d/notes.txt'], position: { x: 20, y: 5 } }, 1, files)
  // Only the other paths are typed now; no transcript, and so no path of a note, goes before them.
  expect(invoke.mock.calls).toEqual([['pty_write', { id: 7, data: '/d/shot.png /d/notes.txt ' }]])
  expect(files.drops.map((d) => d.paths)).toEqual([['/d/a.opus', '/d/b.OGG', '/d/c.oga']])
  // The transcript, when it comes, is typed into the terminal dropped on, with no Enter after it.
  const { sink } = files.drops[0]
  expect(sink.alive()).toBe(true)
  await sink.put('[transcript: a.opus] oi ')
  expect(invoke).toHaveBeenLastCalledWith('pty_write', { id: 7, data: '[transcript: a.opus] oi ' })
  expect(sink.el?.dataset.pane).toBe('7')
  focus.mockRestore()
})

test('a drop of only voice notes types nothing at once', () => {
  const files = transcriber()
  onFileDrag({ type: 'drop', paths: ['/d/a.opus'], position: { x: 250, y: 5 } }, 1, files)
  expect(invoke).not.toHaveBeenCalled()
  expect(files.drops).toHaveLength(1)
})

test('the target is fixed at the drop: a terminal that exits or closes after it is gone', () => {
  const files = transcriber()
  onFileDrag({ type: 'drop', paths: ['/d/a.opus'], position: { x: 250, y: 5 } }, 1, files)
  const { sink } = files.drops[0]
  // A drop elsewhere later does not move it.
  onFileDrag({ type: 'drop', paths: ['/d/b.opus'], position: { x: 20, y: 5 } }, 1, files)
  expect(files.drops[1].sink.el?.dataset.pane).toBe('7')
  expect(sink.el?.dataset.pane).toBe('8')
  store.setState({ panes: { ...store.getState().panes, 8: { id: 8, view: 'terminal', exitCode: 0 } } })
  expect(sink.alive()).toBe(false)
  const { [8]: _closed, ...rest } = store.getState().panes
  store.setState({ panes: rest })
  expect(sink.alive()).toBe(false)
  expect(files.drops[1].sink.alive()).toBe(true)
})

test("a chat's voice notes go into its draft, and a chat that unmounted is gone", () => {
  const files = transcriber()
  const chat = composerIn(7)
  onFileDrag({ type: 'drop', paths: ['/d/a.opus', '/d/x.png'], position: { x: 20, y: 5 } }, 1, files)
  expect(chat.got).toEqual(['/d/x.png '])
  const { sink } = files.drops[0]
  void sink.put('[transcript: a.opus] oi ')
  expect(chat.got).toEqual(['/d/x.png ', '[transcript: a.opus] oi '])
  expect(invoke).not.toHaveBeenCalled()
  expect(sink.alive()).toBe(true)
  chat.off()
  expect(sink.alive()).toBe(false)
})

test("a popup's voice notes go to its session, shown on the popup", () => {
  const files = transcriber()
  const popup = document.body.appendChild(document.createElement('div'))
  popup.dataset.sessionPty = '60'
  popup.getBoundingClientRect = () => ({ left: 0, top: 0, width: 150, height: 50, right: 150, bottom: 50, x: 0, y: 0, toJSON: () => ({}) })
  onFileDrag({ type: 'drop', paths: ['/d/a.opus'], position: { x: 20, y: 5 } }, 1, files)
  const { sink } = files.drops[0]
  expect(sink.el).toBe(popup)
  // A session in no pane stays a target until a write to it fails (`../voice/files`).
  expect(sink.alive()).toBe(true)
  void sink.put('t ')
  expect(invoke).toHaveBeenCalledWith('pty_write', { id: 60, data: 't ' })
  popup.remove()
})
