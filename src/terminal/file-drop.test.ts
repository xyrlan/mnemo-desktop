import { vi } from 'vitest'

const invoke = vi.fn(async (_cmd: string, _args?: unknown) => null)
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args: unknown) => invoke(cmd, args), Channel: class {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
const unlisten = vi.fn()
const onDragDropEvent = vi.fn(async (_h: unknown) => unlisten)
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent }) }))

import { store } from '../layout/app-store'
import { fileDropStore } from './drop'
import { holdFileDrop, onFileDrag, terminalAt } from './file-drop'

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
