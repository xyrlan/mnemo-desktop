import { actionForKey } from './keys'

const ev = (key: string, o: Partial<KeyboardEvent> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent

test('mac bindings', () => {
  expect(actionForKey(ev('t', { metaKey: true }), 'mac')).toBe('tab.new')
  expect(actionForKey(ev('d', { metaKey: true }), 'mac')).toBe('pane.split.row')
  expect(actionForKey(ev('D', { metaKey: true, shiftKey: true }), 'mac')).toBe('pane.split.col')
  expect(actionForKey(ev('w', { metaKey: true }), 'mac')).toBe('pane.close')
  expect(actionForKey(ev('ArrowLeft', { metaKey: true, altKey: true }), 'mac')).toBe('focus.left')
  expect(actionForKey(ev('3', { metaKey: true }), 'mac')).toBe('tab.go.3')
  expect(actionForKey(ev('{', { metaKey: true, shiftKey: true }), 'mac')).toBe('tab.prev')
  expect(actionForKey(ev('k', { metaKey: true }), 'mac')).toBe('palette.open')
  expect(actionForKey(ev('t', { ctrlKey: true }), 'mac')).toBeNull()
  expect(actionForKey(ev('c', { metaKey: true }), 'mac')).toBeNull()
})

test('other platforms use ctrl', () => {
  expect(actionForKey(ev('t', { ctrlKey: true }), 'other')).toBe('tab.new')
  expect(actionForKey(ev('t', { metaKey: true }), 'other')).toBeNull()
})
