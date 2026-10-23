import { invoke as tauriInvoke, Channel } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

/** Jarvis's seam to Rust (#503): every command and event between the panel and the Rust pieces,
 *  by name. Each piece implements its own commands exactly as typed here (contract
 *  `docs/superpowers/contracts/2026-10-23-jarvis-wave-b.md`); the panel calls only this client. */

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
/** A Tauri `Channel`, or a fake in tests: `onmessage` is set before it is handed to the core. */
export type ChannelLike<T> = { onmessage: (m: T) => void }
export type Listen = <T>(event: string, cb: (payload: T) => void) => Promise<() => void>

/** `jarvis_projects` (src-tauri/src/jarvis.rs). */
export type JarvisProject = { name: string; aliases: string[]; root: string }

/** What `jarvis_llm_ensure` reports while it gets the model running (jarvis-llm). */
export type LlmSetup =
  | { kind: 'download'; file: string; done: number; total: number }
  | { kind: 'verifying'; file: string }
  | { kind: 'starting' }
  | { kind: 'ready'; vision: boolean }

/** The read tools `jarvis_tool` runs (jarvis-tools). Every other tool of `TOOLS` is the panel's
 *  to route: to a parent, to the user, to the screen or to the apps. */
export const READ_TOOLS = [
  'git_status',
  'git_log',
  'git_diff',
  'read_file',
  'list_dir',
  'search',
  'read_briefings',
  'query_rules',
  'list_sessions',
  'gh_pr_list',
  'gh_pr_view',
  'gh_pr_checks',
  'gh_run_list',
  'gh_issue_view',
] as const
export type ReadTool = (typeof READ_TOOLS)[number]

/** `jarvis://voice`: what the push-to-talk key and the speaker are doing (jarvis-voice). */
export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'speaking'
/** `jarvis://heard`: a take, once the key is released. `confidence` is 0–1; `window` is the title
 *  of the window that was in front when the key went down, null when unknown. */
export type Heard = { text: string; confidence: number; window: string | null }

/** `jarvis_apps` (jarvis-apps): the apps of the config, by name. */
export type AppEntry = { name: string; project: boolean }
export type BrowserPage = 'repo' | 'pr' | 'issue' | 'actions'

export interface JarvisClient {
  /** `jarvis_projects() -> Vec<JarvisProject>` (seam). */
  projects(): Promise<JarvisProject[]>
  /** `jarvis_log_append(row: serde_json::Value) -> Result<(), String>` (seam): one line of
   *  Jarvis's own log, `~/.mnemo-desktop/jarvis-log.jsonl`. */
  log(row: Record<string, unknown>): Promise<void>

  /** `jarvis_llm_ensure(on: Channel<LlmSetup>) -> Result<(), String>`: downloads what is missing,
   *  starts llama-server if it is not running, and resolves once it answers (jarvis-llm). */
  ensureModel(onSetup: (s: LlmSetup) => void): Promise<void>
  /** `jarvis_llm_chat(body: serde_json::Value, on: Channel<serde_json::Value>) -> Result<(), String>`:
   *  POSTs `body` (from `requestBody`) to llama-server's `/v1/chat/completions` and sends every
   *  parsed `data:` object of the stream, in order; resolves at the end of the stream. */
  chat(body: unknown, onChunk: (chunk: unknown) => void): Promise<void>
  /** `jarvis_llm_stop() -> ()`: stops llama-server, freeing its VRAM. */
  stopModel(): Promise<void>

  /** `jarvis_tool(name: String, args: serde_json::Value) -> Result<String, String>`: runs one read
   *  tool and returns its output as text for the model; refusals and failures are errors
   *  (jarvis-tools). */
  tool(name: ReadTool, args: Record<string, unknown>): Promise<string>
  /** `jarvis_focused_window() -> Option<String>`: the title of the last window in front that was
   *  not this app (jarvis-tools). */
  focusedWindow(): Promise<string | null>

  /** `jarvis_say(text: String) -> Result<(), String>`: speaks `text` in PT-BR, queued after what is
   *  already queued, and never while the key is held (jarvis-voice). */
  say(text: string): Promise<void>
  /** `jarvis_hush() -> ()`: stops speaking and drops the queue (jarvis-voice). */
  hush(): Promise<void>
  onVoice(cb: (phase: VoicePhase) => void): Promise<() => void>
  onHeard(cb: (heard: Heard) => void): Promise<() => void>

  /** `jarvis_screenshot() -> Result<String, String>`: the screen in front as a `data:image/…`
   *  URL, held in memory only (jarvis-screen). */
  screenshot(): Promise<string>

  /** `jarvis_apps() -> Result<Vec<AppEntry>, String>` (jarvis-apps). */
  apps(): Promise<AppEntry[]>
  /** `jarvis_open_app(app: String, project: Option<String>) -> Result<String, String>`: opens an
   *  app of the list, on a project when its entry takes one; resolves with what was opened. */
  openApp(app: string, project?: string): Promise<string>
  /** `jarvis_open_in_browser(project: String, page: String, number: Option<u64>) -> Result<String, String>`:
   *  opens the project's GitHub page; resolves with the URL. */
  openInBrowser(project: string, page: BrowserPage, num?: number): Promise<string>
  /** `jarvis_open_url(url: String) -> Result<(), String>`: http and https only. */
  openUrl(url: string): Promise<void>
}

export function makeJarvisClient(invoke: Invoke, channel: <T>() => ChannelLike<T>, listen: Listen): JarvisClient {
  const streamed = async <T>(cmd: string, args: Record<string, unknown>, cb: (m: T) => void) => {
    const on = channel<T>()
    on.onmessage = cb
    await invoke<void>(cmd, { ...args, on })
  }
  return {
    projects: () => invoke('jarvis_projects'),
    log: (row) => invoke('jarvis_log_append', { row }),
    ensureModel: (cb) => streamed('jarvis_llm_ensure', {}, cb),
    chat: (body, cb) => streamed('jarvis_llm_chat', { body }, cb),
    stopModel: () => invoke('jarvis_llm_stop'),
    tool: (name, args) => invoke('jarvis_tool', { name, args }),
    focusedWindow: () => invoke('jarvis_focused_window'),
    say: (text) => invoke('jarvis_say', { text }),
    hush: () => invoke('jarvis_hush'),
    onVoice: (cb) => listen<VoicePhase>('jarvis://voice', cb),
    onHeard: (cb) => listen<Heard>('jarvis://heard', cb),
    screenshot: () => invoke('jarvis_screenshot'),
    apps: () => invoke('jarvis_apps'),
    openApp: (app, project) => invoke('jarvis_open_app', { app, project: project ?? null }),
    openInBrowser: (project, page, num) => invoke('jarvis_open_in_browser', { project, page, number: num ?? null }),
    openUrl: (url) => invoke('jarvis_open_url', { url }),
  }
}

export const tauriJarvis: JarvisClient = makeJarvisClient(
  tauriInvoke,
  () => new Channel() as never,
  (event, cb) => tauriListen(event, (e) => cb(e.payload as never)),
)
