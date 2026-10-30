import { afterEach, describe, expect, test, vi } from 'vitest'
import type { JarvisClient, JarvisProject, ReadTool } from './client'
import { CHECKS_MAX, GITHUB_EVERY_MS, LINE_CHARS, MAX_CHARS, MAX_LINES, OUTSIDE, SESSIONS_EVERY_MS, ciOf, compose, createSituation, parsePrs, parseSessions } from './situation'

// Fixtures written in the shapes the Rust read tools print (`jarvis_tools/mnemo.rs` `sessions`,
// `gh.rs` `pr_lines`/`issue_lines`) and `gh pr checks` prints when not on a terminal. Made up.

const SESSIONS = `## tasklist
- parent aaaaaaaa "tasklist-1": waiting (permission prompt), in /Users/you/github/tasklist
- parent bbbbbbbb: busy, in /Users/you/github/tasklist
- child 1f2e3d4c "Corrigir o upload no Windows": working; feat/upload/win
- child 5a6b7c8d "Revisar o PR 12": blocked; needs approval; feat/upload/review
- child 9e9e9e9e "Coisa antiga": done; feat/old/x; PR #9 merged (CI pass)

## notes
- child 0c0c0c0c "Arrumar o build": working`

const PRS = `#12 Upload no Windows (feat/upload/win; by you; updated 2026-10-28)
#14 Docs (docs/x; by you; updated 2026-10-27)
#15 Rascunho (wip (parte 2); draft; by you; updated 2026-10-26)
#16 Sem CI (chore/y; by you; updated 2026-10-26)`

const CHECKS: Record<number, string | Error> = {
  12: 'build\tfail\t1m2s\thttps://example.test/1\t\ntest\tpass\t3m\thttps://example.test/2\t',
  14: 'build\tpending\t0\thttps://example.test/3\t\ntest\tpass\t3m\thttps://example.test/4\t',
  16: new Error("no checks reported on the 'chore/y' branch"),
}

type Calls = { name: ReadTool; args: Record<string, unknown> }[]

function fake(over: Partial<Record<string, string | Error>> = {}, projects: JarvisProject[] | Error = [{ name: 'tasklist', aliases: [], root: '/r/t' }, { name: 'notes', aliases: [], root: '/r/n' }, { name: 'quiet', aliases: [], root: '/r/q' }]) {
  const calls: Calls = []
  const data: Record<string, string | Error> = {
    list_sessions: SESSIONS,
    'gh_pr_list:tasklist': PRS,
    'gh_pr_list:notes': 'no open pull requests',
    'gh_pr_list:quiet': 'no open pull requests',
    'gh_issue_list:tasklist': '#3 Bug (bug; updated 2026-10-01)\n#4 Outro',
    'gh_issue_list:notes': '#1 Ideia (updated 2026-10-02)',
    'gh_issue_list:quiet': 'no open issues',
    ...over,
  } as Record<string, string | Error>
  const state = { data, projects }
  const client = {
    projects: async () => {
      if (state.projects instanceof Error) throw state.projects
      return state.projects
    },
    tool: async (name: ReadTool, args: Record<string, unknown>) => {
      calls.push({ name, args })
      const got = name === 'gh_pr_checks' ? (state.data[`checks:${args.number}`] ?? CHECKS[args.number as number]) : state.data[args.project ? `${name}:${args.project}` : name]
      if (got === undefined) throw new Error(`no fixture for ${name} ${JSON.stringify(args)}`)
      if (got instanceof Error) throw got
      return got
    },
  } as unknown as JarvisClient
  return { client, calls, state }
}

afterEach(() => vi.useRealTimers())

describe('parsing the read tools', () => {
  test('sessions: parents with their state, children with what they need', () => {
    const repos = parseSessions(SESSIONS)
    expect([...repos.values()].map((r) => r.name)).toEqual(['tasklist', 'notes'])
    const t = repos.get('tasklist')!
    expect(t.parents).toEqual([
      { id: 'aaaaaaaa', name: 'tasklist-1', status: 'waiting', waitingFor: 'permission prompt' },
      { id: 'bbbbbbbb', name: '', status: 'busy', waitingFor: '' },
    ])
    expect(t.children.map((c) => [c.state, c.needs])).toEqual([
      ['working', ''],
      ['blocked', 'approval'],
      ['done', ''],
    ])
    expect(parseSessions('no sessions').size).toBe(0)
  })

  test('PRs: the number, and draft from the last parentheses even when the branch has some', () => {
    expect(parsePrs(PRS).map((p) => [p.number, p.draft])).toEqual([
      [12, false],
      [14, false],
      [15, true],
      [16, false],
    ])
    expect(parsePrs('no open pull requests')).toEqual([])
  })

  test("CI: one failing fails it, one running keeps it running, all passed is ok", () => {
    expect(ciOf(CHECKS[12] as string)).toBe('falhou')
    expect(ciOf('a\tcancel\t1s\tu\t')).toBe('falhou')
    expect(ciOf(CHECKS[14] as string)).toBe('rodando')
    expect(ciOf('a\tpass\t1s\tu\t\nb\tskipping\t0\tu\t')).toBe('ok')
    expect(ciOf('a  pass  1s  u')).toBe('ok')
    expect(ciOf('')).toBe('?')
  })
})

describe('createSituation', () => {
  test('knows nothing until a refresh has read something', () => {
    const s = createSituation(fake().client, () => 1)
    expect(s.text()).toBe('')
    expect(s.changedAt()).toBeNull()
  })

  test('what runs, what waits and who needs the maintainer, in a few lines', async () => {
    const s = createSituation(fake().client, () => 1000)
    await s.refresh()
    const lines = s.text().split('\n')
    expect(lines[0]).toBe('Precisa de você — tasklist: sessão "tasklist-1" esperando (permission prompt), filho "Revisar o PR 12" precisa de approval.')
    expect(lines[1]).toBe(
      'tasklist: 2 sessões (1 esperando, 1 ocupada); 2 filhos (1 trabalhando, 1 bloqueado); 4 PRs: #12 CI falhou, #14 CI rodando, #15 rascunho, #16 CI sem CI; 2 issues abertas.',
    )
    expect(lines[2]).toBe('notes: 1 filho (1 trabalhando); 1 issue aberta.')
    expect(lines[3]).toBe('Sem nada aberto: quiet.')
    expect(lines).toHaveLength(4)
    // A finished child is not running.
    expect(s.text()).not.toContain('Coisa antiga')
    expect(s.changedAt()).toBe(1000)
  })

  test('a repository that is none of the known projects is marked, and still asks for the maintainer', async () => {
    const over = {
      list_sessions: `${SESSIONS}\n\n## system32\n- parent dddddddd "solta": waiting (input needed), in C:\\Windows\\System32\n\n## TL\n- parent cccccccc: busy, in /Users/you/github/tasklist\n- child 7a7a7a7a "Pelo apelido": working`,
    }
    const projects = [
      { name: 'tasklist', aliases: ['tl'], root: '/r/t' },
      { name: 'notes', aliases: [], root: '/r/n' },
      { name: 'quiet', aliases: [], root: '/r/q' },
    ]
    const f = fake(over, projects)
    const s = createSituation(f.client, () => 1)
    await s.refresh()
    const lines = s.text().split('\n')
    expect(lines[0]).toContain(`; system32 ${OUTSIDE}: sessão "solta" esperando (input needed)`)
    expect(lines).toContain(`system32 ${OUTSIDE}: 1 sessão (1 esperando).`)
    // An alias is the project: its sessions join the project's line, unmarked.
    expect(lines.find((l) => l.startsWith('tasklist:'))).toContain('3 sessões (1 esperando, 2 ocupadas); 3 filhos (2 trabalhando, 1 bloqueado)')
    expect(s.text()).not.toMatch(/TL|tasklist \(fora|notes \(fora/)
    expect(lines.every((l) => l.length <= LINE_CHARS)).toBe(true)
    expect(s.text().length).toBeLessThanOrEqual(MAX_CHARS)

    // The projects are config: a failed read of them keeps the mark.
    f.state.projects = new Error('no vault')
    await s.refresh()
    expect(s.text()).toContain(`system32 ${OUTSIDE}: 1 sessão (1 esperando).`)
  })

  test('changedAt moves only when the text does', async () => {
    let t = 1000
    const f = fake()
    const s = createSituation(f.client, () => t)
    await s.refresh()
    t = 2000
    await s.refresh()
    expect(s.changedAt()).toBe(1000)
    f.state.data['gh_issue_list:quiet'] = '#7 Nova'
    t = 3000
    await s.refresh()
    expect(s.text()).toContain('quiet: 1 issue aberta.')
    expect(s.changedAt()).toBe(3000)
  })

  test('a read that fails shows its part as unknown, never the last one it got', async () => {
    const f = fake()
    const s = createSituation(f.client, () => 1)
    await s.refresh()
    expect(s.text()).toContain('#12 CI falhou')
    f.state.data['gh_pr_list:tasklist'] = new Error('gh: HTTP 502')
    f.state.data['gh_issue_list:notes'] = new Error('gh: HTTP 502')
    f.state.data['checks:14'] = new Error('gh: timeout')
    await s.refresh()
    expect(s.text()).toContain('tasklist: 2 sessões (1 esperando, 1 ocupada); 2 filhos (1 trabalhando, 1 bloqueado); PRs: ? (gh falhou); 2 issues abertas.')
    expect(s.text()).toContain('notes: 1 filho (1 trabalhando); issues: ? (gh falhou).')
    expect(s.text()).not.toContain('#12')

    f.state.data['gh_pr_list:tasklist'] = PRS
    await s.refresh()
    expect(s.text()).toContain('#14 CI ?')

    f.state.data.list_sessions = new Error('mission poll failed')
    await s.refresh()
    expect(s.text()).toContain('Sessões: ? (não consegui ler).')
    expect(s.text()).not.toContain('sessões (')
    expect(s.text()).not.toContain('Precisa de você')

    f.state.projects = new Error('no vault')
    await s.refresh()
    expect(s.text()).toContain('GitHub: ? (não consegui ler os projetos).')
    expect(s.text()).not.toContain('PRs')
  })

  test('refresh never rejects, even over a client that throws', async () => {
    const client = {
      projects: () => {
        throw new Error('boom')
      },
      tool: () => {
        throw new Error('boom')
      },
    } as unknown as JarvisClient
    const s = createSituation(client, () => 5)
    await expect(s.refresh()).resolves.toBeUndefined()
    expect(s.text()).toBe('Sessões: ? (não consegui ler).\nGitHub: ? (não consegui ler os projetos).')
    expect(s.changedAt()).toBe(5)
  })

  test(`reads the CI of ${CHECKS_MAX} PRs a project at most, and none of a draft`, async () => {
    const many = Array.from({ length: 8 }, (_, i) => `#${i + 1} PR ${i + 1} (b${i}${i === 0 ? '; draft' : ''}; by you)`).join('\n')
    const pass = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`checks:${i + 1}`, 'ci\tpass\t1s\tu\t']))
    const f = fake({ 'gh_pr_list:tasklist': many, ...pass })
    const s = createSituation(f.client, () => 1)
    await s.refresh()
    const checked = f.calls.filter((c) => c.name === 'gh_pr_checks').map((c) => c.args.number)
    expect(checked).toEqual([2, 3, 4, 5, 6])
    expect(s.text()).toContain('#1 rascunho, #2 CI ok')
    expect(s.text()).toContain('#7 CI não lido, #8 CI não lido')
  })

  test('stays within its budget, the maintainer first, and says what did not fit', async () => {
    const projects = Array.from({ length: 20 }, (_, i) => ({ name: `proj${String(i).padStart(2, '0')}`, aliases: [], root: `/r/${i}` }))
    const over: Record<string, string> = {
      list_sessions: '## proj19\n- parent cccccccc "longe": waiting (input needed), in /r/19',
      ...Object.fromEntries(projects.map((p) => [`gh_pr_list:${p.name}`, 'no open pull requests'])),
      ...Object.fromEntries(projects.map((p) => [`gh_issue_list:${p.name}`, Array.from({ length: 3 }, (_, i) => `#${i} x`).join('\n')])),
      'gh_pr_list:proj00': Array.from({ length: 30 }, (_, i) => `#${100 + i} um PR de título longo (b; by you)`).join('\n'),
      ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`checks:${100 + i}`, 'ci\tpass\t1s\tu\t'])),
    }
    const s = createSituation(fake(over, projects).client, () => 1)
    await s.refresh()
    const lines = s.text().split('\n')
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES)
    expect(s.text().length).toBeLessThanOrEqual(MAX_CHARS)
    expect(lines.every((l) => l.length <= LINE_CHARS)).toBe(true)
    expect(lines[0]).toBe('Precisa de você — proj19: sessão "longe" esperando (input needed).')
    // The project that needs the maintainer comes before the busier one.
    expect(lines[1]).toBe('proj19: 1 sessão (1 esperando); 3 issues abertas.')
    expect(lines[2]).toMatch(/^proj00: 30 PRs: #100 CI ok, .*…$/)
    expect(lines[lines.length - 1]).toMatch(/^\(\+\d+ linhas fora deste resumo\)$/)
  })

  test('a few long lines are held to the characters too, not only to the lines', () => {
    const repos = new Map(
      Array.from({ length: 6 }, (_, i) => {
        const name = `p${i}`
        const children = Array.from({ length: 12 }, (_, j) => ({ id: `${i}${j}`, what: '', state: `estado-${j}-longo`, needs: '' }))
        return [name, { name, parents: [], children }] as [string, { name: string; parents: never[]; children: typeof children }]
      }),
    )
    const text = compose({ ok: true, byRepo: repos }, [])
    const lines = text.split('\n')
    expect(lines.length).toBeLessThan(MAX_LINES)
    expect(text.length).toBeLessThanOrEqual(MAX_CHARS)
    expect(lines[lines.length - 1]).toMatch(/^\(\+\d+ linhas? fora deste resumo\)$/)
  })

  test('a refresh asked while one runs resolves with what was read after it was asked', async () => {
    const f = fake()
    let release = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const tool = f.client.tool
    let first = true
    f.client.tool = async (name, args) => {
      if (name === 'list_sessions' && first) {
        first = false
        const got = await tool(name, args)
        await gate
        return got
      }
      return tool(name, args)
    }
    const s = createSituation(f.client, () => 1)
    const a = s.refresh()
    // The first read has the old sessions in hand, and waits.
    await vi.waitFor(() => expect(first).toBe(false))
    f.state.data.list_sessions = '## notes\n- child 0c0c0c0c "Arrumar o build": blocked'
    const b = s.refresh()
    // A second read that did not wait would be done by now, and the first would land over it.
    await new Promise((r) => setTimeout(r, 0))
    release()
    await Promise.all([a, b])
    expect(s.text()).toContain('filho "Arrumar o build" bloqueado')
    expect(s.text()).not.toContain('tasklist-1')
  })

  test(`start reads at once, the sessions every ${SESSIONS_EVERY_MS / 1000} s and GitHub every ${GITHUB_EVERY_MS / 60_000} min, until stopped`, async () => {
    vi.useFakeTimers()
    const f = fake()
    const s = createSituation(f.client, () => 1)
    const count = (n: ReadTool) => f.calls.filter((c) => c.name === n).length
    const stop = s.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.text()).toContain('tasklist')
    expect([count('list_sessions'), count('gh_pr_list')]).toEqual([1, 3])
    await vi.advanceTimersByTimeAsync(SESSIONS_EVERY_MS)
    expect([count('list_sessions'), count('gh_pr_list')]).toEqual([2, 3])
    await vi.advanceTimersByTimeAsync(GITHUB_EVERY_MS - SESSIONS_EVERY_MS)
    expect([count('list_sessions'), count('gh_pr_list')]).toEqual([1 + GITHUB_EVERY_MS / SESSIONS_EVERY_MS, 6])
    stop()
    await vi.advanceTimersByTimeAsync(GITHUB_EVERY_MS * 3)
    expect([count('list_sessions'), count('gh_pr_list')]).toEqual([1 + GITHUB_EVERY_MS / SESSIONS_EVERY_MS, 6])
  })

  test('a tick while GitHub is still being read does not stack another read', async () => {
    vi.useFakeTimers()
    const f = fake()
    let asked = 0
    let release = (_: JarvisProject[]) => {}
    const slow = new Promise<JarvisProject[]>((r) => (release = r))
    f.client.projects = () => (asked++ ? Promise.resolve([]) : slow)
    const stop = createSituation(f.client, () => 1).start()
    // Two ticks come while the first read hangs; once it ends, none of them reads after it.
    await vi.advanceTimersByTimeAsync(GITHUB_EVERY_MS * 3 - 1)
    release([])
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toBe(1)
    stop()
  })

  test('a read that throws past its own guard neither rejects nor jams the reads after it', async () => {
    let calls = 0
    const s = createSituation(fake().client, () => {
      if (++calls === 1) throw new Error('clock')
      return 7
    })
    await expect(s.refresh()).resolves.toBeUndefined()
    await s.refresh()
    expect(s.changedAt()).toBe(7)
  })

  test('a hidden window keeps the beat: James is heard from the orb', async () => {
    vi.useFakeTimers()
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const f = fake()
    const count = (n: ReadTool) => f.calls.filter((c) => c.name === n).length
    const stop = createSituation(f.client, () => 1).start()
    await vi.advanceTimersByTimeAsync(GITHUB_EVERY_MS)
    expect([count('list_sessions'), count('gh_pr_list')]).toEqual([1 + GITHUB_EVERY_MS / SESSIONS_EVERY_MS, 6])
    stop()
    hidden.mockRestore()
  })

  test('nothing running and nothing open is said, not left empty', () => {
    expect(compose({ ok: true, byRepo: new Map() }, [])).toBe('Nada rodando, nada aberto.')
    expect(compose(null, null)).toBe('')
  })
})
