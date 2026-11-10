import { child } from '../mission/fixtures'
import { STOP_WAIT_MS, stopChild, type StopDeps } from './stop'

const row = child({ id: 'c6d082fb', cwd: '/Users/you/work/atlas-api-wt-tenant', account_env: { config_dir: '/Users/you/.claude-work' } })

function deps(exit: number | null | 'running', pane: number | null = 9, shell: 'posix' | 'cmd' | 'powershell' = 'posix') {
  const did: string[] = []
  const d: StopDeps = {
    shell: () => shell,
    async run(root, command, label) {
      did.push(`run ${root} | ${command} | ${label}`)
      return pane
    },
    async exited(p, ms) {
      did.push(`wait ${p} ${ms}`)
      return exit
    },
    end: async (p) => void did.push(`end ${p}`),
  }
  return { d, did }
}

test('the stop runs on the child\'s own account, in a terminal that ends with it and is then forgotten', async () => {
  const { d, did } = deps(0)
  expect(await stopChild(d, '/Users/you/work/atlas-api', row)).toEqual({ ok: true, why: '' })
  expect(did).toEqual(['run /Users/you/work/atlas-api | exec env CLAUDE_CONFIG_DIR=/Users/you/.claude-work claude stop c6d082fb | stop · c6d082fb', `wait 9 ${STOP_WAIT_MS}`, 'end 9'])
})

test('each shell leaves in its own way', async () => {
  const plain = child({ id: 'c6d082fb' })
  const cmd = deps(0, 9, 'cmd')
  await stopChild(cmd.d, 'C:/work/atlas-api', plain)
  expect(cmd.did[0]).toContain('| claude stop c6d082fb & exit |')
  const ps = deps(0, 9, 'powershell')
  await stopChild(ps.d, 'C:/work/atlas-api', plain)
  expect(ps.did[0]).toContain('| claude stop c6d082fb; exit |')
})

test('a stop that failed keeps its terminal and says so', async () => {
  const { d, did } = deps(1)
  const o = await stopChild(d, '/Users/you/work/atlas-api', row)
  expect(o.ok).toBe(false)
  expect(o.why).toContain('exited 1')
  expect(did.some((l) => l.startsWith('end'))).toBe(false)
})

test('a stop that has not ended in time is left to the maintainer, its terminal kept', async () => {
  const { d, did } = deps('running')
  const o = await stopChild(d, '/Users/you/work/atlas-api', row)
  expect(o).toEqual({ ok: true, why: expect.stringContaining('has not ended yet') })
  expect(did.some((l) => l.startsWith('end'))).toBe(false)
})
