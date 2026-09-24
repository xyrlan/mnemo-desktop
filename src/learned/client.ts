import type { RunResult } from '../vault/types'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
export type Listen = <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>

/** A repo as mnemo names it: `project` is what `--project` takes, `root` its main checkout,
 *  where every call of the review runs. */
export type ReviewProject = { project: string; root: string }

/** The one-shot calls, each spelled out on the Rust side (`install_review.rs`). */
export type Step = 'list' | 'dry-run' | 'promote' | 'drop'

/** An answer given on this screen, or `review` when the vault's ledger holds one taken
 *  elsewhere (`mnemo inbox --review`). */
export type Answer = 'kept' | 'later' | 'not-now' | 'review'

export type JobHandlers = {
  line(id: string, stream: 'out' | 'err', line: string): void
  exit(id: string, code: number | null): void
}

export interface LearnedClient {
  /** The repo `cwd` is in, or null outside one. */
  project(cwd: string): Promise<ReviewProject | null>
  step(step: Step, target: ReviewProject, keys?: string[]): Promise<RunResult>
  /** Starts the harvest and extraction; resolves once it runs. Its lines come on `onJob`. */
  run(target: ReviewProject): Promise<void>
  /** Subscribes to every headless job's lines and exits; resolves with the unsubscribe. */
  onJob(h: JobHandlers): Promise<() => void>
  decided(project: string): Promise<Answer | null>
  record(project: string, answer: Exclude<Answer, 'review'>): Promise<void>
  /** Appends one row to `usage.jsonl`. Never throws. */
  log(row: Record<string, unknown>): void
}

/** The job id the run streams under: `install_review::run_id`. */
export const runId = (project: string) => `install-review:${project}`

export function makeLearnedClient(invoke: Invoke, listen: Listen): LearnedClient {
  return {
    project: (cwd) => invoke<ReviewProject | null>('install_review_project', { cwd }),
    step: (step, t, keys = []) => invoke<RunResult>('install_review_step', { step, project: t.project, root: t.root, keys }),
    run: (t) => invoke<string>('install_review_run', { project: t.project, root: t.root }).then(() => undefined),
    onJob: async (h) => {
      const stops = await Promise.all([
        listen<{ id: string; stream: 'out' | 'err'; line: string }>('job-line', ({ payload: p }) => h.line(p.id, p.stream, p.line)),
        listen<{ id: string; code: number | null }>('job-exit', ({ payload: p }) => h.exit(p.id, p.code)),
      ])
      return () => stops.forEach((s) => s())
    },
    decided: (project) => invoke<Answer | null>('install_review_decided', { project }),
    record: (project, answer) => invoke<void>('install_review_record', { project, decision: answer }),
    log: (row) => {
      try {
        void invoke('usage_log', { row }).catch(() => {})
      } catch {
        // No Tauri core: the row is lost, which is all a counter can lose.
      }
    },
  }
}
