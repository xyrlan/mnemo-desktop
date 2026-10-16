import { vi } from 'vitest'
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null, Channel: class {} }))

import { createFileDrops, type DropSink, type FileEvent } from './files'

/** A backend that answers each drop with `events`, after the test lets it (`go`). */
function backend(events: FileEvent[] | ((paths: string[]) => FileEvent[]), fail?: string) {
  const asked: string[][] = []
  let go = () => {}
  const started = new Promise<void>((r) => (go = r))
  return {
    asked,
    go: () => go(),
    client: {
      async transcribe(paths: string[], on: (e: FileEvent) => void) {
        asked.push(paths)
        await started
        for (const e of typeof events === 'function' ? events(paths) : events) on(e)
        if (fail) throw new Error(fail)
      },
    },
  }
}

function sink(alive = true) {
  const typed: string[] = []
  const s: DropSink & { typed: string[]; gone(): void } = {
    typed,
    el: null,
    alive: () => alive,
    put: (t) => void typed.push(t),
    gone: () => void (alive = false),
  }
  return s
}

function deps(client: ReturnType<typeof backend>['client'], copy: (t: string) => Promise<void> = async () => {}) {
  const said: string[] = []
  const kept: { title: string; action: { label: string; onClick(): void } }[] = []
  return {
    said,
    kept,
    deps: {
      client,
      copy,
      pathText: (p: string) => `${p} `,
      say: {
        error: (t: string, d?: string) => void said.push(`error: ${t}: ${d}`),
        info: (t: string, d?: string) => void said.push(`info: ${t}: ${d}`),
        keep: (title: string, _d: string, action: { label: string; onClick(): void }) => void kept.push({ title, action }),
      },
    },
  }
}

test('each transcript is typed in drop order, one line, and the work is shown until the last', async () => {
  const b = backend([
    { kind: 'download', downloaded: 287, total: 574 },
    { kind: 'transcribing', index: 0, percent: 0 },
    { kind: 'transcribing', index: 0, percent: 40 },
    { kind: 'done', index: 0, text: 'primeiro' },
    { kind: 'transcribing', index: 1, percent: 0 },
    { kind: 'done', index: 1, text: 'segundo\nlinha' },
  ])
  const d = deps(b.client)
  const files = createFileDrops(d.deps)
  const s = sink()
  const labels: string[] = []
  files.work.subscribe((st) => st.work[0] && labels.push(st.work[0].label))
  const done = files.transcribe(['/d/a.opus', '/d/b.ogg'], s)
  b.go()
  await done
  expect(s.typed).toEqual(['[transcript: a.opus] primeiro ', '[transcript: b.ogg] segundo linha '])
  expect(s.typed.join('')).not.toMatch(/[\r\n]/)
  expect(labels).toEqual(['Preparing a.opus…', 'Downloading the speech model for files: 50%', 'Transcribing a.opus…', 'Transcribing a.opus 40%', 'Transcribing b.ogg…'])
  expect(files.work.getState().work).toEqual([])
  expect(d.said).toEqual([])
})

test('a file that could not be heard drops its path, in its place, and says why', async () => {
  const b = backend([
    { kind: 'failed', index: 0, error: 'it is Ogg Vorbis, not Opus' },
    { kind: 'done', index: 1, text: 'oi' },
  ])
  const d = deps(b.client)
  const s = sink()
  const done = createFileDrops(d.deps).transcribe(['/d/v.ogg', '/d/n.opus'], s)
  b.go()
  await done
  expect(s.typed).toEqual(['/d/v.ogg ', '[transcript: n.opus] oi '])
  expect(d.said).toEqual(['error: Could not transcribe v.ogg: it is Ogg Vorbis, not Opus. Its path was dropped instead.'])
})

test('a backend that fails or forgets a file still answers for every one', async () => {
  const b = backend([{ kind: 'done', index: 0, text: 'oi' }], 'voice: gone')
  const d = deps(b.client)
  const s = sink()
  const done = createFileDrops(d.deps).transcribe(['/d/a.opus', '/d/b.opus'], s)
  b.go()
  await done
  expect(s.typed).toEqual(['[transcript: a.opus] oi ', '/d/b.opus '])
  expect(d.said).toEqual(['error: Could not transcribe b.opus: voice: gone. Its path was dropped instead.'])

  const quiet = backend([])
  const q = deps(quiet.client)
  const qs = sink()
  const p = createFileDrops(q.deps).transcribe(['/d/c.opus'], qs)
  quiet.go()
  await p
  expect(qs.typed).toEqual(['/d/c.opus '])
  expect(q.said[0]).toContain('nothing came back for it')
})

test('a transcript whose target is gone goes to the clipboard and says so', async () => {
  const b = backend([{ kind: 'done', index: 0, text: 'oi' }])
  const copied: string[] = []
  const d = deps(b.client, async (t) => void copied.push(t))
  const s = sink()
  const done = createFileDrops(d.deps).transcribe(['/d/a.opus'], s)
  s.gone()
  b.go()
  await done
  expect(s.typed).toEqual([])
  expect(copied).toEqual(['[transcript: a.opus] oi'])
  expect(d.said).toEqual(['info: Transcript of a.opus copied to the clipboard: Not typed: the place it was dropped on is gone.'])
})

test('a write that fails counts as gone, and a clipboard that refuses keeps the text behind a button', async () => {
  const b = backend([{ kind: 'done', index: 0, text: 'oi' }])
  let refuse = true
  const copied: string[] = []
  const d = deps(b.client, async (t) => {
    if (refuse) throw new Error('NotAllowedError')
    copied.push(t)
  })
  const s = sink()
  s.put = () => Promise.reject(new Error('no such pty'))
  const done = createFileDrops(d.deps).transcribe(['/d/a.opus'], s)
  b.go()
  await done
  expect(d.kept).toHaveLength(1)
  expect(d.kept[0].title).toBe('Transcript of a.opus not typed')
  refuse = false
  d.kept[0].action.onClick()
  await vi.waitFor(() => expect(copied).toEqual(['[transcript: a.opus] oi']))
})

test('two drops each keep their own target and order', async () => {
  const b = backend((paths) => paths.map((p, index) => ({ kind: 'done', index, text: p.slice(3) })))
  const d = deps(b.client)
  const files = createFileDrops(d.deps)
  const one = sink()
  const two = sink()
  const a = files.transcribe(['/d/1.opus', '/d/2.opus'], one)
  const c = files.transcribe(['/d/3.opus'], two)
  expect(files.work.getState().work).toHaveLength(2)
  b.go()
  await Promise.all([a, c])
  expect(one.typed).toEqual(['[transcript: 1.opus] 1.opus ', '[transcript: 2.opus] 2.opus '])
  expect(two.typed).toEqual(['[transcript: 3.opus] 3.opus '])
})
