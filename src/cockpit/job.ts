import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { cockpitStore } from './app-store'
import type { JobLine } from './store'

/** What `job.rs` emits, one `job-line` per line and one `job-exit` per run. */
export const LINE_EVENT = 'job-line'
export const EXIT_EVENT = 'job-exit'

type LinePayload = { id: string } & JobLine
type ExitPayload = { id: string; code: number | null }

// One pair of listeners for the whole app, set up by the first job: the events carry the id.
let listening: Promise<unknown> | null = null

function connect() {
  listening ??= Promise.all([
    listen<LinePayload>(LINE_EVENT, ({ payload: { id, stream, line } }) => cockpitStore.getState().jobLine(id, { stream, line })),
    listen<ExitPayload>(EXIT_EVENT, ({ payload: { id, code } }) => cockpitStore.getState().jobExit(id, code)),
  ]).catch((e) => {
    // Try again on the next job rather than never hearing one.
    listening = null
    throw e
  })
  return listening
}

/** Runs `argv` in `cwd` headless as the row `key`'s job; nothing when that row's job is still
 *  running. `argv` is a list, never a shell string. Listens before it starts, so no line is lost,
 *  and a job that cannot start is a failed job with the reason as its log. */
export async function runJob(key: string, title: string, cwd: string, argv: string[]) {
  const store = cockpitStore
  if (!store.getState().jobStart(key, title)) return
  try {
    await connect()
    await invoke('job_run', { id: key, cwd, argv })
  } catch (e) {
    store.getState().jobFailed(key, String(e))
  }
}
