import { Channel, invoke } from '@tauri-apps/api/core'
import { createStore } from 'zustand/vanilla'
import { toast } from 'sonner'
import { dropText } from '../terminal/drop'
import { fileName, transcriptLine } from './transcript'

/** Voice notes dropped on a pane (#497): the backend transcribes them (`voice_file.rs`), and each
 *  transcript is typed where the note's path would have gone, in drop order. While it works, the
 *  place it was dropped on says so (`FileWork`); a failure is said in a toast. */

/** What `voice_transcribe_files` tells as it goes; `index` is the file's place in the drop. */
export type FileEvent =
  | { kind: 'download'; downloaded: number; total: number }
  | { kind: 'transcribing'; index: number; percent: number }
  | { kind: 'done'; index: number; text: string }
  | { kind: 'failed'; index: number; error: string }

export interface FileClient {
  /** Resolves once every file is done or failed, each told to `on`. */
  transcribe(paths: string[], on: (e: FileEvent) => void): Promise<void>
}

export const tauriFiles: FileClient = {
  transcribe(paths, on) {
    const channel = new Channel<FileEvent>()
    channel.onmessage = on
    return invoke('voice_transcribe_files', { paths, on: channel })
  },
}

/** Where a drop's text goes, fixed when it was dropped: a chat's draft, or a terminal's PTY. */
export type DropSink = {
  /** Whether it can still take text. */
  alive(): boolean
  /** Types `text` there; a rejection means it is gone. */
  put(text: string): void | Promise<void>
  /** What was dropped on, where the work is shown; null: nowhere in particular. */
  el: HTMLElement | null
}

/** A drop being transcribed, as `FileWork` draws it on `el`. */
export type Work = {
  id: number
  el: HTMLElement | null
  label: string
  /** The model download's fraction, while it runs. */
  download: number | null
}

export type Say = {
  error(title: string, description?: string): void
  /** A message that stays until dismissed, with a button: the transcript that found no target
   *  when the clipboard refused it. */
  keep(title: string, description: string, action: { label: string; onClick(): void }): void
  info(title: string, description?: string): void
}

export type FileDropDeps = {
  client: FileClient
  /** The clipboard's write. */
  copy(text: string): Promise<void>
  say: Say
  /** What a file that was not transcribed drops as: its path, typed as any other file's. */
  pathText(path: string): string
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createFileDrops(deps: FileDropDeps) {
  const work = createStore<{ work: Work[] }>(() => ({ work: [] }))
  let next = 1

  const update = (id: number, patch: Partial<Work>) =>
    work.setState((s) => ({ work: s.work.map((w) => (w.id === id ? { ...w, ...patch } : w)) }))

  /** A transcript whose target went away: on the clipboard, and said; if the clipboard refuses
   *  (no user gesture), kept in a message with a button that copies it. */
  async function rescue(name: string, line: string) {
    const gone = 'the place it was dropped on is gone'
    try {
      await deps.copy(line)
      deps.say.info(`Transcript of ${name} copied to the clipboard`, `Not typed: ${gone}.`)
    } catch {
      deps.say.keep(`Transcript of ${name} not typed`, `Not typed: ${gone}, and the clipboard refused it.`, {
        label: 'Copy',
        onClick: () => void deps.copy(line).catch(() => {}),
      })
    }
  }

  async function deliver(sink: DropSink, text: string): Promise<boolean> {
    if (!sink.alive()) return false
    try {
      await sink.put(text)
      return true
    } catch {
      return false
    }
  }

  /** Transcribes the voice notes at `paths` into `sink`, in their order. Resolves when every one
   *  is typed, rescued or said to have failed. */
  async function transcribe(paths: string[], sink: DropSink): Promise<void> {
    if (!paths.length) return
    const id = next++
    const names = paths.map(fileName)
    work.setState((s) => ({ work: [...s.work, { id, el: sink.el, label: `Preparing ${names[0]}…`, download: null }] }))
    const settled = new Set<number>()
    // Events arrive in file order; each delivery waits for the one before it.
    let chain = Promise.resolve()
    const then = (f: () => Promise<void> | void) => {
      chain = chain.then(f).catch(() => {})
    }
    const fail = (index: number, error: string) => {
      settled.add(index)
      deps.say.error(`Could not transcribe ${names[index]}`, `${error}. Its path was dropped instead.`)
      then(async () => void (await deliver(sink, deps.pathText(paths[index]))))
    }
    const on = (e: FileEvent) => {
      switch (e.kind) {
        case 'download':
          update(id, {
            // Once it is all here, its hash is checked and it loads: seconds with no bytes moving.
            label:
              e.total > 0 && e.downloaded >= e.total
                ? 'Loading the speech model for files…'
                : `Downloading the speech model for files: ${e.total > 0 ? Math.floor((e.downloaded / e.total) * 100) : 0}%`,
            download: e.total > 0 && e.downloaded < e.total ? e.downloaded / e.total : null,
          })
          return
        case 'transcribing':
          update(id, { label: `Transcribing ${names[e.index]}${e.percent > 0 ? ` ${e.percent}%` : '…'}`, download: null })
          return
        case 'done': {
          settled.add(e.index)
          const line = transcriptLine(names[e.index], e.text)
          then(async () => {
            if (!(await deliver(sink, line))) await rescue(names[e.index], line.trim())
          })
          return
        }
        case 'failed':
          return fail(e.index, e.error)
      }
    }
    let why = 'nothing came back for it'
    try {
      await deps.client.transcribe(paths, on)
    } catch (e) {
      why = message(e)
    }
    // A file the backend never told of is said too: nothing dropped goes unanswered.
    paths.forEach((_, i) => settled.has(i) || fail(i, why))
    await chain
    work.setState((s) => ({ work: s.work.filter((w) => w.id !== id) }))
  }

  return { work, transcribe }
}

export type FileDrops = ReturnType<typeof createFileDrops>

/** The app's: the backend, the webview's clipboard, and the toaster. */
export const fileDrops = createFileDrops({
  client: tauriFiles,
  copy: (text) => navigator.clipboard.writeText(text),
  say: {
    error: (title, description) => void toast.error(title, { description }),
    info: (title, description) => void toast(title, { description }),
    keep: (title, description, action) => void toast(title, { description, duration: Infinity, action }),
  },
  pathText: (path) => dropText([path]),
})
