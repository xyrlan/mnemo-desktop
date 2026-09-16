/** The square, wired to the real Tauri client and the live pulse stream. The sidebar imports
 *  this and passes it to `VaultLevelSlot` as children; `Square` itself stays injectable so the
 *  tests can drive it with their own client and pulses. */
import { invoke } from '@tauri-apps/api/core'
import { store } from '../layout/app-store'
import { pulseStore } from '../pulse/app-store'
import { makeLevelClient } from './client'
import Square from './Square'

const client = makeLevelClient(invoke)
const openVault = () => store.getState().openView('vault', {}, 'auto', 'vault')

export default function VaultSquare() {
  return <Square client={client} pulses={pulseStore} openVault={openVault} />
}
