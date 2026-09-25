import { describe, expect, it } from 'vitest'
import { BUILT_IN_COMMANDS, filterCommands, filterFiles, frontMatter, FRESH_MS, loadCommands, makeCatalogCache, type CatalogClient, type SlashCommand } from './catalog'

type Tree = Record<string, string | null>

/** A disk: path → file text, or null for a folder. */
function disk(tree: Tree, files: string[] = [], home = '/home/me') {
  const reads: string[] = []
  const client: CatalogClient & { reads: string[]; fileReads: number } = {
    reads,
    fileReads: 0,
    home: async () => home,
    list: async (dir) => {
      const kids = Object.keys(tree).filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      if (!(dir in tree) && kids.length === 0) throw new Error(`${dir}: No such file or directory`)
      return kids.map((p) => ({ name: p.slice(dir.length + 1), is_dir: tree[p] === null }))
    },
    read: async (path) => {
      reads.push(path)
      const t = tree[path]
      if (typeof t !== 'string') throw new Error(`${path}: not found`)
      return t
    },
    files: async () => {
      client.fileReads++
      return files
    },
  }
  return client
}

describe('frontMatter', () => {
  it('reads name, description and argument-hint', () => {
    expect(frontMatter('---\nname: ship\ndescription: "Ship it"\nargument-hint: <pr>\n---\nbody')).toEqual({ name: 'ship', description: 'Ship it', argumentHint: '<pr>' })
  })

  it('reads nothing without front matter, or from a block scalar marker', () => {
    expect(frontMatter('# just a title\ndescription: no')).toEqual({})
    expect(frontMatter('---\ndescription: >\n  folded\n---')).toEqual({})
  })
})

describe('loadCommands', () => {
  const tree: Tree = {
    '/wt/.claude': null,
    '/wt/.claude/commands': null,
    '/wt/.claude/commands/deploy.md': '---\ndescription: Deploy the app\nargument-hint: [env]\n---\n',
    '/wt/.claude/commands/notes.txt': 'not a command',
    '/wt/.claude/commands/frontend': null,
    '/wt/.claude/commands/frontend/component.md': 'no front matter',
    '/wt/.claude/skills': null,
    '/wt/.claude/skills/review-pr': null,
    '/wt/.claude/skills/review-pr/SKILL.md': '---\nname: review-pr\ndescription: Review a PR the house way\n---\n',
    '/home/me/.claude/commands': null,
    '/home/me/.claude/commands/deploy.md': '---\ndescription: My own deploy\n---\n',
    '/home/me/.claude/commands/compact.md': '---\ndescription: shadowing a built-in\n---\n',
    '/home/me/.claude/skills': null,
    '/home/me/.claude/skills/standup': null,
  }

  it("offers the worktree's commands and skills, then the person's, then Claude Code's", async () => {
    const got = await loadCommands('/wt/', disk(tree))
    const by = (name: string) => got.find((c) => c.name === name)
    expect(by('deploy')).toEqual({ name: 'deploy', kind: 'command', source: 'project', description: 'Deploy the app', argumentHint: '[env]' })
    expect(by('frontend:component')).toEqual({ name: 'frontend:component', kind: 'command', source: 'project' })
    expect(by('review-pr')).toMatchObject({ kind: 'skill', source: 'project', description: 'Review a PR the house way' })
    // A skill folder without its SKILL.md is still offered, by its folder's name.
    expect(by('standup')).toEqual({ name: 'standup', kind: 'skill', source: 'personal' })
    expect(by('compact')).toMatchObject({ source: 'personal', description: 'shadowing a built-in' })
    expect(by('model')).toMatchObject({ source: 'built-in' })
    expect(got.some((c) => c.name === 'notes.txt' || c.name === 'notes')).toBe(false)
    // One name, once.
    expect(got.filter((c) => c.name === 'deploy')).toHaveLength(1)
    expect(new Set(got.map((c) => c.name)).size).toBe(got.length)
  })

  it('offers the built-ins alone with nothing on disk and no worktree', async () => {
    const got = await loadCommands(null, disk({}))
    expect(got).toEqual(BUILT_IN_COMMANDS)
  })
})

describe('filterCommands', () => {
  const cmds: SlashCommand[] = ['compact', 'config', 'context', 'security-review', 'review'].map((name) => ({ name, kind: 'command', source: 'built-in' }))

  it('lists names starting with the query first, then names containing it', () => {
    expect(filterCommands(cmds, 'rev').map((c) => c.name)).toEqual(['review', 'security-review'])
    expect(filterCommands(cmds, 'CO').map((c) => c.name)).toEqual(['compact', 'config', 'context'])
  })

  it('lists everything, in catalog order, for a bare slash', () => {
    expect(filterCommands(cmds, '').map((c) => c.name)).toEqual(['compact', 'config', 'context', 'security-review', 'review'])
  })
})

describe('filterFiles', () => {
  const files = ['src/app/App.tsx', 'src/App.test.tsx', 'docs/apple.md', 'src/deep/nested/app.ts', 'README.md', 'src/chat-input/Composer.tsx']

  it('ranks the name itself, then a name starting with it, and a shallow path first', () => {
    expect(filterFiles(files, 'app')).toEqual(['src/app/App.tsx', 'src/deep/nested/app.ts', 'docs/apple.md', 'src/App.test.tsx', 'src/chat-input/Composer.tsx'])
    expect(filterFiles(files, 'app.ts')[0]).toBe('src/deep/nested/app.ts')
  })

  it('finds the letters in order when nothing contains the query', () => {
    expect(filterFiles(files, 'ccomp')).toEqual(['src/chat-input/Composer.tsx'])
  })

  it('lists shallow files first for a bare @, up to the limit', () => {
    expect(filterFiles(files, '', 2)).toEqual(['README.md', 'docs/apple.md'])
  })
})

describe('makeCatalogCache', () => {
  it("reads a worktree's files once while they are fresh, and again after", async () => {
    let t = 0
    const c = disk({}, ['a.ts'])
    const cache = makeCatalogCache(c, () => t)
    await cache.files('/wt')
    await cache.files('/wt')
    expect(c.fileReads).toBe(1)
    t += FRESH_MS
    await cache.files('/wt')
    expect(c.fileReads).toBe(2)
  })

  it('does not keep a failed read', async () => {
    let fail = true
    const c = disk({})
    c.files = async () => {
      if (fail) throw new Error('git: not a repository')
      return ['x']
    }
    const cache = makeCatalogCache(c, () => 0)
    await expect(cache.files('/wt')).rejects.toThrow('not a repository')
    fail = false
    await expect(cache.files('/wt')).resolves.toEqual(['x'])
  })
})
