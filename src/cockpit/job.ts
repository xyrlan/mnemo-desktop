import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { cockpitStore } from './app-store'

/** What `job.rs` emits, one `job-line` per line and one `job-exit` per run. */
export const LINE_EVENT = 'job-line'
export const EXIT_EVENT = 'job-exit'

type LinePayload = { id: string; stream: 'out' | 'err'; line: string }
type ExitPayload = { id: string; code: number | null }

/** What a step printed and how it ended. */
export type StepResult = { code: number | null; out: string[]; err: string[] }

/** Processes a caller awaits as one step of a longer job (`runStep`), by process id. Their
 *  exit resolves the step and never ends a row's job: the caller decides what comes next. */
const steps = new Map<string, { log?: string; out: string[]; err: string[]; done: (code: number | null) => void }>()

// One pair of listeners for the whole app, set up by the first job: the events carry the id.
let listening: Promise<unknown> | null = null

function connect() {
  listening ??= Promise.all([
    listen<LinePayload>(LINE_EVENT, ({ payload: { id, stream, line } }) => {
      const s = steps.get(id)
      if (!s) return cockpitStore.getState().jobLine(id, { stream, line })
      s[stream].push(line)
      if (s.log) cockpitStore.getState().jobLine(s.log, { stream, line })
    }),
    listen<ExitPayload>(EXIT_EVENT, ({ payload: { id, code } }) => {
      const s = steps.get(id)
      if (!s) return cockpitStore.getState().jobExit(id, code)
      steps.delete(id)
      s.done(code)
    }),
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

/** Runs `argv` in `cwd` headless as process `id` and resolves once it exits, with what it
 *  printed. Its lines also go to the log of the running job `log`, when one is given; without
 *  it the step is quiet (a read the caller parses). Rejects when it cannot start. */
export async function runStep(id: string, cwd: string, argv: string[], log?: string): Promise<StepResult> {
  await connect()
  return new Promise<StepResult>((resolve, reject) => {
    const s = { log, out: [] as string[], err: [] as string[], done: (code: number | null) => resolve({ code, out: s.out, err: s.err }) }
    // Registered before it starts: the first line can arrive before `invoke` returns.
    steps.set(id, s)
    invoke('job_run', { id, cwd, argv }).catch((e) => {
      steps.delete(id)
      reject(e)
    })
  })
}
