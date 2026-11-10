// Starts the world the page asked for, and the actions that go with it.

import { setActions } from './actions'
import { fromCapture } from './capture'
import { startLive } from './live'
import { sampleActions, sampleWorld } from './sample'
import { worldSource, worldStore } from './store'

/** Called once by the frame. Returns how to stop. */
export function startWorld(): () => void {
  const { set } = worldStore.getState()
  const source = worldSource()
  if (source === 'live') return startLive(set)

  const undo = setActions(sampleActions(() => worldStore.getState().world, set))
  if (source === 'sample') {
    set(sampleWorld())
    return undo
  }
  // capture: the machine's real sessions as the prototypes' script last wrote them. The file
  // is gitignored and absent from a release; without it the sample is drawn.
  let live = true
  fetch('/world.capture.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((json) => live && set(fromCapture(json, 'sample')))
    .catch(() => live && set({ ...sampleWorld(), errors: ['No capture here (scripts/world-sample.mjs --real): this is the sample.'] }))
  return () => {
    live = false
    undo()
  }
}
