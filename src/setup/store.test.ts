import type { InstallLine, SetupClient } from './client'
import { createSetupStore } from './store'
import type { ToolStatus } from './tools'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const mnemo = (path: string | null): ToolStatus => ({ name: 'mnemo', path, version: path && 'mnemo 1.6.0', managed: !!path })

function fake(over: Partial<SetupClient> = {}) {
  const log: string[] = []
  let emit: ((l: InstallLine) => void) | null = null
  const client: SetupClient = {
    status: async () => (log.push('status'), [mnemo(null)]),
    installMnemo: async () => (log.push('install'), 'v1.6.0'),
    latestMnemo: async () => (log.push('latest'), 'v1.7.0'),
    addToPath: async () => (log.push('path'), 'Added 2 folders to your PATH in ~/.zshrc.'),
    onInstallLine: async (cb) => {
      log.push('listen')
      emit = cb
      return () => {
        log.push('unlisten')
        emit = null
      }
    },
    ...over,
  }
  return { client, log, emit: (l: InstallLine) => emit?.(l) }
}

test('check keeps the rows; a failed check keeps the last rows and says why', async () => {
  let fail = false
  const s = createSetupStore(fake({ status: async () => { if (fail) throw 'tools_status not found'; return [mnemo('/m/mnemo')] } }).client)
  expect(await s.getState().check()).toEqual([mnemo('/m/mnemo')])
  expect(s.getState()).toMatchObject({ rows: [mnemo('/m/mnemo')], checking: false, statusError: null })
  fail = true
  expect(await s.getState().check()).toBeNull()
  expect(s.getState()).toMatchObject({ rows: [mnemo('/m/mnemo')], checking: false, statusError: 'tools_status not found' })
})

test('an answer that is not a list is a failed check, not rows', async () => {
  const s = createSetupStore(fake({ status: async () => ({}) as never }).client)
  expect(await s.getState().check()).toBeNull()
  expect(s.getState().rows).toBeNull()
  expect(s.getState().statusError).toMatch(/no list/)
})

test('only the newest check lands', async () => {
  const first = deferred<ToolStatus[]>()
  const second = deferred<ToolStatus[]>()
  const answers = [first, second]
  const s = createSetupStore(fake({ status: () => answers.shift()!.promise }).client)
  const a = s.getState().check()
  const b = s.getState().check()
  second.resolve([mnemo('/new/mnemo')])
  await b
  first.resolve([mnemo(null)])
  await a
  expect(s.getState().rows).toEqual([mnemo('/new/mnemo')])
  expect(s.getState().checking).toBe(false)
})

test('install mnemo listens before invoking, keeps its lines, then checks again', async () => {
  const run = deferred<string>()
  const f = fake({ installMnemo: () => (f.log.push('install'), run.promise), status: async () => (f.log.push('status'), [mnemo('/m/mnemo')]) })
  const s = createSetupStore(f.client)
  const going = s.getState().installMnemo()
  await new Promise((r) => setTimeout(r, 0))
  expect(f.log).toEqual(['listen', 'install'])
  expect(s.getState().mnemo.running).toBe(true)
  f.emit({ tool: 'mnemo', message: 'downloading mnemo-v1.6.0-darwin-arm64.tar.gz' })
  f.emit({ tool: 'claude', message: 'not ours' })
  f.emit({ tool: 'mnemo', message: 'verified sha256' })
  // A second click while it runs starts nothing.
  await s.getState().installMnemo()
  expect(f.log.filter((l) => l === 'install')).toHaveLength(1)
  run.resolve('v1.6.0')
  await going
  expect(s.getState().mnemo).toEqual({
    running: false,
    lines: ['downloading mnemo-v1.6.0-darwin-arm64.tar.gz', 'verified sha256'],
    ok: 'mnemo v1.6.0 installed',
    error: null,
  })
  expect(f.log).toEqual(['listen', 'install', 'status', 'unlisten'])
  expect(s.getState().rows).toEqual([mnemo('/m/mnemo')])
})

test('a failed install shows its error and its lines, and stops listening', async () => {
  const f = fake()
  f.client.installMnemo = async () => {
    f.emit({ tool: 'mnemo', message: 'downloading' })
    throw 'the release has no .sha256: nothing was installed'
  }
  const s = createSetupStore(f.client)
  await s.getState().installMnemo()
  expect(s.getState().mnemo).toEqual({ running: false, lines: ['downloading'], ok: null, error: 'the release has no .sha256: nothing was installed' })
  expect(f.log).toEqual(['listen', 'status', 'unlisten'])
  // The next click starts clean.
  f.client.installMnemo = async () => 'v1.6.0'
  await s.getState().installMnemo()
  expect(s.getState().mnemo).toMatchObject({ lines: [], ok: 'mnemo v1.6.0 installed', error: null })
})

test('add to PATH shows its sentence, or what failed', async () => {
  const f = fake()
  const s = createSetupStore(f.client)
  await s.getState().addToPath()
  expect(s.getState().path).toEqual({ running: false, lines: [], ok: 'Added 2 folders to your PATH in ~/.zshrc.', error: null })
  f.client.addToPath = async () => {
    throw new Error('could not write ~/.zshrc: permission denied')
  }
  await s.getState().addToPath()
  expect(s.getState().path).toEqual({ running: false, lines: [], ok: null, error: 'could not write ~/.zshrc: permission denied' })
})

test('the latest release is asked for once per run; a failure says why and is asked again', async () => {
  const f = fake()
  let fail: string | null = 'GitHub refused to send the latest mnemo release for now (rate limit). Try again in a few minutes.'
  f.client.latestMnemo = async () => {
    f.log.push('latest')
    if (fail) throw fail
    return 'v1.7.0'
  }
  const s = createSetupStore(f.client)
  await s.getState().lookForUpdate()
  expect(s.getState().latest).toEqual({ asking: false, tag: null, error: fail })
  fail = null
  await s.getState().lookForUpdate()
  expect(s.getState().latest).toEqual({ asking: false, tag: 'v1.7.0', error: null })
  // Known for the run: looking again does not ask GitHub again, unless asked to.
  await s.getState().lookForUpdate()
  expect(f.log.filter((l) => l === 'latest')).toHaveLength(2)
  await s.getState().lookForUpdate(true)
  expect(f.log.filter((l) => l === 'latest')).toHaveLength(3)
})

test('two looks at once ask GitHub once', async () => {
  const answer = deferred<string>()
  const f = fake({ latestMnemo: () => (f.log.push('latest'), answer.promise) })
  const s = createSetupStore(f.client)
  const a = s.getState().lookForUpdate()
  const b = s.getState().lookForUpdate()
  expect(s.getState().latest.asking).toBe(true)
  answer.resolve('v1.7.0')
  await Promise.all([a, b])
  expect(f.log).toEqual(['latest'])
})

test('a finished install is the latest release: the tag is known without asking GitHub again', async () => {
  const f = fake()
  const s = createSetupStore(f.client)
  await s.getState().installMnemo()
  expect(s.getState().latest).toEqual({ asking: false, tag: 'v1.6.0', error: null })
  await s.getState().lookForUpdate()
  expect(f.log).not.toContain('latest')
})

test('an update that failed after its swap (at mnemo init) shows the copy now in place', async () => {
  const f = fake({ status: async () => [{ ...mnemo('/m/mnemo'), version: 'mnemo 1.7.0' }] })
  f.client.installMnemo = async () => {
    throw 'mnemo v1.7.0 is installed, but mnemo init stopped with code 1: no mnemo hooks to refresh'
  }
  const s = createSetupStore(f.client)
  s.setState({ rows: [mnemo('/m/mnemo')] })
  await s.getState().installMnemo()
  expect(s.getState().mnemo.error).toMatch(/is installed, but/)
  expect(s.getState().rows![0].version).toBe('mnemo 1.7.0')
})
