import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlashCommand } from './catalog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The catalogs, answered here: plain functions, swapped per test.
const disk = {
  commands: async (_cwd: string | null): Promise<SlashCommand[]> => COMMANDS,
  files: async (_cwd: string): Promise<string[]> => FILES,
  asked: [] as string[],
}
vi.mock('./catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('./catalog')>()
  return {
    ...real,
    catalog: {
      commands: (cwd: string | null) => (disk.asked.push(`commands:${cwd}`), disk.commands(cwd)),
      files: (cwd: string) => (disk.asked.push(`files:${cwd}`), disk.files(cwd)),
    },
  }
})

const { ChatComposer } = await import('./Composer')
const { ApprovalCard } = await import('./ApprovalCard')
const { QuestionCard } = await import('./QuestionCard')

const COMMANDS: SlashCommand[] = [
  { name: 'compact', kind: 'command', source: 'built-in', description: 'Free up context', argumentHint: '[instructions]' },
  { name: 'clear', kind: 'command', source: 'built-in', description: 'Start a new session' },
  { name: 'review-pr', kind: 'skill', source: 'project', description: 'Review a PR the house way' },
]
const FILES = ['README.md', 'src/app/App.tsx', 'src/chat-input/Composer.tsx']

let root: Root
let host: HTMLElement

beforeEach(() => {
  disk.commands = async () => COMMANDS
  disk.files = async () => FILES
  disk.asked = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
})

async function render(node: React.ReactNode) {
  await act(async () => root.render(node))
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)]
const textarea = () => $<HTMLTextAreaElement>('textarea')!
const options = () => $$('[role="option"]').map((o) => o.textContent)
const byText = (text: string) => $$("button").find((b) => b.textContent?.includes(text)) as HTMLButtonElement

async function type(value: string, caret = value.length) {
  const el = textarea()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
    el.setSelectionRange(caret, caret)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

async function key(k: string, more: KeyboardEventInit = {}, el: Element = textarea()) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...more })
  await act(async () => void el.dispatchEvent(e))
  await flush()
  return e
}

async function click(el: Element) {
  await act(async () => void (el as HTMLElement).click())
  await flush()
}

/** A promise the test settles by hand. */
function later() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}

describe('ChatComposer', () => {
  it('sends on Enter, and empties once the send is through', async () => {
    const sent: string[] = []
    const gate = later()
    await render(<ChatComposer cwd="/wt" onSend={(t) => (sent.push(t), gate.promise)} />)
    await type('fix the bug')
    const e = await key('Enter')
    expect(e.defaultPrevented).toBe(true)
    expect(sent).toEqual(['fix the bug'])
    // Kept while it is on its way, and not sent twice.
    expect(textarea().value).toBe('fix the bug')
    expect(textarea().readOnly).toBe(true)
    await key('Enter')
    await click($('button[aria-label="Send"]')!)
    expect(sent).toEqual(['fix the bug'])
    await act(async () => gate.resolve())
    await flush()
    expect(textarea().value).toBe('')
    expect(textarea().readOnly).toBe(false)
  })

  it('breaks the line on Shift+Enter and sends on ⌘↵', async () => {
    const sent: string[] = []
    await render(<ChatComposer cwd="/wt" onSend={async (t) => void sent.push(t)} />)
    await type('one')
    const e = await key('Enter', { shiftKey: true })
    expect(e.defaultPrevented).toBe(false)
    expect(sent).toEqual([])
    await type('one\ntwo')
    await key('Enter', { metaKey: true })
    expect(sent).toEqual(['one\ntwo'])
  })

  it('sends nothing blank, nothing while disabled, and nothing an IME is composing', async () => {
    const sent: string[] = []
    await render(<ChatComposer cwd="/wt" onSend={async (t) => void sent.push(t)} />)
    await type('   ')
    await key('Enter')
    expect($<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(true)
    await type('hi')
    await key('Enter', { isComposing: true })
    expect(sent).toEqual([])
    await render(<ChatComposer cwd="/wt" disabled placeholder="Claude is busy" onSend={async (t) => void sent.push(t)} />)
    expect(textarea().disabled).toBe(true)
    expect(textarea().placeholder).toBe('Claude is busy')
    await key('Enter')
    await click($('button[aria-label="Send"]')!)
    expect(sent).toEqual([])
  })

  it('keeps the draft and says why when the send is refused', async () => {
    let refuse = true
    const sent: string[] = []
    await render(
      <ChatComposer
        cwd="/wt"
        onSend={async (t) => {
          if (refuse) throw new Error('Claude is no longer running in that terminal: nothing was sent')
          sent.push(t)
        }}
      />,
    )
    await type('deploy it')
    await key('Enter')
    expect($('[role="alert"]')!.textContent).toContain('no longer running')
    expect(textarea().value).toBe('deploy it')
    refuse = false
    await click($('button[aria-label="Send"]')!)
    expect(sent).toEqual(['deploy it'])
    expect($('[role="alert"]')).toBeNull()
  })

  it('recalls sent prompts with ↑ and comes back down with ↓', async () => {
    await render(<ChatComposer cwd="/wt" onSend={async () => {}} />)
    await type('first')
    await key('Enter')
    await type('second')
    await key('Enter')
    await key('ArrowUp')
    expect(textarea().value).toBe('second')
    textarea().setSelectionRange(0, 0)
    await key('ArrowUp')
    expect(textarea().value).toBe('first')
    await key('ArrowDown')
    await key('ArrowDown')
    expect(textarea().value).toBe('')
  })

  describe('/ commands', () => {
    it("lists the worktree's commands and skills for a leading slash, filtered as typed", async () => {
      await render(<ChatComposer cwd="/wt" onSend={async () => {}} />)
      await type('/')
      expect($('[role="listbox"]')!.getAttribute('aria-label')).toBe('Commands and skills')
      expect(options()).toEqual([
        expect.stringContaining('/compact[instructions]'),
        expect.stringContaining('/clear'),
        expect.stringContaining('/review-prReview a PR the house wayProject'),
      ])
      expect(disk.asked).toEqual(['commands:/wt'])
      await type('/c')
      expect(options()).toHaveLength(2)
      expect(textarea().getAttribute('aria-activedescendant')).toBe($$('[role="option"]')[0].id)
      await type('/zzz')
      expect($('[role="listbox"]')!.textContent).toBe('No matching commands')
    })

    it('runs a command that takes nothing on Enter', async () => {
      const sent: string[] = []
      await render(<ChatComposer cwd="/wt" onSend={async (t) => void sent.push(t)} />)
      await type('/cl')
      await key('Enter')
      expect(sent).toEqual(['/clear'])
      expect(textarea().value).toBe('')
    })

    it('completes a command waiting for its argument, and anything on Tab', async () => {
      const sent: string[] = []
      await render(<ChatComposer cwd="/wt" onSend={async (t) => void sent.push(t)} />)
      await type('/co')
      await key('Enter')
      expect(textarea().value).toBe('/compact ')
      expect($('[role="listbox"]')).toBeNull()
      await type('/')
      await key('ArrowDown')
      await key('ArrowDown')
      expect($$('[role="option"]')[2].getAttribute('aria-selected')).toBe('true')
      await key('Tab')
      expect(textarea().value).toBe('/review-pr ')
      expect(sent).toEqual([])
    })

    it('shuts on Esc, until the token is typed afresh', async () => {
      await render(<ChatComposer cwd="/wt" onSend={async () => {}} />)
      await type('/c')
      await key('Escape')
      expect($('[role="listbox"]')).toBeNull()
      await type('/co')
      expect($('[role="listbox"]')).toBeNull()
      await type('')
      await type('/')
      expect($('[role="listbox"]')).not.toBeNull()
    })

    it('says so when the commands cannot be read', async () => {
      disk.commands = async () => {
        throw new Error('permission denied')
      }
      await render(<ChatComposer cwd="/wt" onSend={async () => {}} />)
      await type('/')
      expect($('[role="listbox"]')!.textContent).toBe('Could not read the commands: permission denied')
    })
  })

  describe('@ files', () => {
    it("offers the worktree's files for an @ and completes the one picked", async () => {
      await render(<ChatComposer cwd="/wt" onSend={async () => {}} />)
      await type('look at @comp and fix it', 13)
      expect($('[role="listbox"]')!.getAttribute('aria-label')).toBe('Files')
      expect(options()).toEqual(['Composer.tsxsrc/chat-input'.replace('src', '‎src')])
      await key('Enter')
      expect(textarea().value).toBe('look at @src/chat-input/Composer.tsx and fix it')
      expect(textarea().selectionStart).toBe(textarea().value.indexOf('and fix'))
      expect(disk.asked).toEqual(['files:/wt'])
    })

    it('picks a row on pointer-down, before the textarea loses focus', async () => {
      await render(<ChatComposer cwd="/wt" onSend={async () => {}} />)
      await type('@app')
      const row = $$('[role="option"]')[0]
      const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
      await act(async () => void row.dispatchEvent(down))
      await flush()
      expect(down.defaultPrevented).toBe(true)
      expect(textarea().value).toBe('@src/app/App.tsx ')
    })

    it('has no files to offer without a worktree', async () => {
      await render(<ChatComposer cwd={null} onSend={async () => {}} />)
      await type('@')
      expect($('[role="listbox"]')!.textContent).toBe('No worktree to look for files in')
      expect(disk.asked).toEqual([])
    })

    it('says the files are being read until they are', async () => {
      const gate = later()
      disk.files = () => gate.promise.then(() => FILES)
      await render(<ChatComposer cwd="/wt" onSend={async () => {}} />)
      await type('@')
      expect($('[role="listbox"]')!.textContent).toContain('Reading')
      await act(async () => gate.resolve())
      await flush()
      expect(options()).toHaveLength(3)
    })
  })
})

describe('ApprovalCard', () => {
  it('shows what would be allowed', async () => {
    await render(<ApprovalCard tool="Bash" summary="rm -rf dist" detail="Clean the build output" onAllow={async () => {}} onDeny={async () => {}} />)
    expect($('[role="group"]')!.getAttribute('aria-label')).toBe('Allow Bash?')
    expect(host.textContent).toContain('rm -rf dist')
    expect(host.textContent).toContain('Clean the build output')
    expect($('[data-ui]')).not.toBeNull()
  })

  it('allows in one click, once, and says so while Claude moves on', async () => {
    let allowed = 0
    const gate = later()
    await render(<ApprovalCard tool="Bash" summary="ls" onAllow={() => (allowed++, gate.promise)} onDeny={async () => {}} />)
    await click(byText('Allow'))
    expect(allowed).toBe(1)
    expect(byText('Allow').disabled).toBe(true)
    expect(byText('Deny').disabled).toBe(true)
    await click(byText('Allow'))
    expect(allowed).toBe(1)
    await act(async () => gate.resolve())
    await flush()
    expect(host.textContent).toContain('Allowed — waiting on Claude')
    expect(byText('Deny').disabled).toBe(true)
  })

  it('denies, and after a refused answer works again', async () => {
    let refuse = true
    let denied = 0
    await render(
      <ApprovalCard
        tool="Edit"
        summary="src/a.ts"
        onAllow={async () => {}}
        onDeny={async () => {
          denied++
          if (refuse) throw new Error('nothing was sent')
        }}
      />,
    )
    await click(byText('Deny'))
    expect($('[role="alert"]')!.textContent).toBe('nothing was sent')
    expect(byText('Deny').disabled).toBe(false)
    refuse = false
    await click(byText('Deny'))
    expect(denied).toBe(2)
    expect(host.textContent).toContain('Denied — waiting on Claude')
  })
})

describe('QuestionCard', () => {
  const OPTS = ['Red', 'Green', 'Blue']

  it('answers with the option clicked, once', async () => {
    const picked: number[] = []
    await render(<QuestionCard question="Which color?" options={OPTS} onAnswer={async (i) => void picked.push(i)} />)
    expect($('[role="group"]')!.getAttribute('aria-label')).toBe('Which color?')
    expect($$('button').map((b) => b.textContent)).toEqual(['1Red', '2Green', '3Blue'])
    // Without `onOther` there is nothing to type in.
    expect($('input')).toBeNull()
    await click(byText('Green'))
    expect(picked).toEqual([1])
    expect(byText('Green').getAttribute('aria-pressed')).toBe('true')
    expect(byText('Red').disabled).toBe(true)
    await click(byText('Red'))
    expect(picked).toEqual([1])
    expect(host.textContent).toContain('Answered — waiting on Claude')
  })

  it("answers with an option's number while the card has focus", async () => {
    const picked: number[] = []
    await render(<QuestionCard question="Which color?" options={OPTS} onAnswer={async (i) => void picked.push(i)} onOther={async () => {}} />)
    await key('4', {}, byText('Red'))
    await key('3', { metaKey: true }, byText('Red'))
    expect(picked).toEqual([])
    await key('3', {}, $('input')!)
    expect(picked).toEqual([])
    await key('3', {}, byText('Red'))
    expect(picked).toEqual([2])
  })

  it('answers in words', async () => {
    const said: string[] = []
    await render(<QuestionCard question="Which color?" options={OPTS} onAnswer={async () => {}} onOther={async (t) => void said.push(t)} />)
    const input = $<HTMLInputElement>('input')!
    expect(byText('Send').disabled).toBe(true)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  deep purple ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await key('Enter', {}, input)
    expect(said).toEqual(['deep purple'])
    expect(input.disabled).toBe(true)
  })

  it('works again after a refused answer', async () => {
    let tries = 0
    await render(
      <QuestionCard
        question="Which color?"
        options={OPTS}
        onAnswer={async () => {
          if (++tries === 1) throw new Error('Claude is no longer running in that terminal: nothing was sent')
        }}
      />,
    )
    await click(byText('Blue'))
    expect($('[role="alert"]')!.textContent).toContain('no longer running')
    expect(byText('Blue').disabled).toBe(false)
    await click(byText('Blue'))
    expect(tries).toBe(2)
    expect($('[role="alert"]')).toBeNull()
  })
})
