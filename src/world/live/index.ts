// The live world: this machine's sessions, put together from what the core answers.
//
//   ./engine.ts   keeps it current: what it listens to, what it asks, when it builds
//   ./build.ts    puts a world together from what was read (pure)
//   ./session.ts  one session: its state, what it waits for, everything known of it
//   ./roster.ts   who is in it
//   ./share.ts    a session whose data did not change stays the same object
//   ./sources.ts  the app's stores and the core's commands
//   ./compare.ts  where it differs from the prototypes' capture, and why (tools/world/)

import { EMPTY } from '../store'
import type { World } from '../types'
import { createLive } from './engine'

/** The live world as it was last handed over, for `tools/world/compare.mjs` and a console:
 *  `__mnemoWorld.world()`, and `await __mnemoWorld.compare()` in a dev build that serves a
 *  capture (`scripts/world-sample.mjs --real`). */
interface Hook {
  world(): World | null
  compare(capture?: unknown): Promise<string>
}

function expose(last: () => World | null): () => void {
  const hook: Hook = {
    world: last,
    async compare(capture) {
      const world = last()
      if (!world) return 'No live world yet.'
      const { compareWorlds, report } = await import('./compare')
      const { fromCapture } = await import('../capture')
      const json = capture ?? (await fetch('/world.capture.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`no capture here (${r.status}): run scripts/world-sample.mjs --real`)))))
      const text = report(compareWorlds(world, fromCapture(json)))
      console.log(text)
      return text
    },
  }
  const g = globalThis as { __mnemoWorld?: Hook }
  g.__mnemoWorld = hook
  return () => {
    if (g.__mnemoWorld === hook) delete g.__mnemoWorld
  }
}

/** Start keeping the world current and hand each new one to `set`. Returns how to stop. */
export function startLive(set: (world: World) => void): () => void {
  let stopped = false
  let stop = () => {}
  let last: World | null = null
  const hide = expose(() => last)
  // The app's stores and the core's commands load with the first live world, not with this
  // module: the sample world, and every test of a view, never reach them.
  import('./sources').then(
    ({ appSources }) => {
      if (stopped) return
      stop = createLive(appSources(), (world) => {
        last = world
        set(world)
      })
    },
    (e: unknown) => {
      if (!stopped) set({ ...EMPTY, at: Date.now(), errors: [`The live world could not start: ${e instanceof Error ? e.message : String(e)}`] })
    },
  )
  return () => {
    stopped = true
    hide()
    stop()
  }
}
