import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { cssVar } from '../../theme'
import { pulseStore } from '../../pulse/app-store'
import { makeMapClient } from './client'
import { MapView, type MapDeps } from './MapView'

/** The live wiring, loaded with the map tab only: sigma and the layout worker come in with it. */
const deps: MapDeps = {
  client: makeMapClient(invoke, listen),
  createRenderer: async (...args) => (await import('./renderer')).createRenderer(...args),
  pulses: pulseStore,
  readVar: cssVar,
}

export default function MapPane({ cwd, current }: { cwd: string | undefined; current: string | undefined }) {
  return <MapView cwd={cwd} current={current} deps={deps} />
}
