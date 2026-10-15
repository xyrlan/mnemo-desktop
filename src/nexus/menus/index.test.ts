import { settingsStore } from '../../settings/app-store'
import { MNEMO, ROOT, ship } from '../command/fixtures'
import { menuFor } from '../ui/menus'
import { shipMenu } from './index'

const ctx = { open: () => {} }

afterEach(() => settingsStore.setState({ quickCommands: {} }))

test('importing the piece registers the ship’s menus with the Nexus', () => {
  const s = ship()
  expect(menuFor({ kind: 'dock', id: MNEMO }, s, ctx).map((i) => i.label)).toEqual(['New session', 'Terminal here'])
  expect(shipMenu({ kind: 'dock', id: MNEMO }, s, ctx).map((i) => i.label)).toEqual(['New session', 'Terminal here'])
})

test('a repo’s saved commands are found by path, however the key is spelt', () => {
  settingsStore.setState({ quickCommands: { [`${ROOT}/`]: [{ label: 'dev', command: 'pnpm tauri dev' }], 'C:\\Users\\you\\mnemo': [{ label: 'test', command: 'pytest' }] } })
  expect(shipMenu({ kind: 'deck', id: ROOT }, ship(), ctx).map((i) => i.label)).toEqual(['New session', 'Terminal here', 'dev'])
  expect(shipMenu({ kind: 'deck', id: 'c:/Users/you/mnemo' }, ship(), ctx).map((i) => i.label)).toEqual(['New session', 'Terminal here', 'test'])
  expect(shipMenu({ kind: 'deck', id: MNEMO }, ship(), ctx).map((i) => i.label)).toEqual(['New session', 'Terminal here'])
})
