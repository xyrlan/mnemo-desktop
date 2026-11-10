// Every state of the card and of the count on one page, at the widths the views give it. The
// app never imports this: the preview harness does (tools/preview/scenarios/next-pending.mjs),
// with `import('/src/pending/sheet.tsx')` from the page, because some states last a moment in
// the sample world (an answer on its way) or never happen in it (a refusal).

import { createRoot } from 'react-dom/client'
import { Label } from '../ds'
import { actions, setActions } from '../world/actions'
import { choicesFor } from '../world/pending'
import { sampleWorld } from '../world/sample'
import { worldStore } from '../world/store'
import type { Pending, PendingKind } from '../world/types'
import { PendingCard } from './PendingCard'
import { WaitingCount } from './WaitingCount'
import { patch, type Card } from './state'

interface Specimen {
  label: string
  pending: Pending
  armed: boolean
  card?: Partial<Card>
}

const world = sampleWorld()
const of = (kind: PendingKind, ci?: string): Pending => world.pending.find((p) => p.kind === kind && (!ci || p.pr?.ci === ci))!

/** The same item under another id, so one page can show it in two states. */
const as = (p: Pending, tag: string, change: Partial<Pending> = {}): Pending => ({ ...p, ...change, id: `${p.id}~${tag}` })

const question = of('question')
const permission = of('permission')
const running = of('merge', 'running')
const green = of('merge', 'green')
const stalled = of('stalled')
const blocked: Pending = {
  ...as(stalled, 'blocked'),
  kind: 'blocked',
  text: 'The registry answered 429 three times in a row. The install did not finish.',
  choices: choicesFor('blocked', [], null),
  since: world.at - 9 * 60_000,
}
const red = as(green, 'red', { pr: { ...green.pr!, ci: 'red' }, choices: choicesFor('merge', [], { ...green.pr!, ci: 'red' }) })
const long: Pending = {
  ...as(question, 'long'),
  text:
    'The export job writes one file per tenant and the largest tenant has 48,000 orders. Three ways to keep it under the gateway timeout came out of the spike, and they are not equivalent for support, who open these files by hand.\n\nWhich one should I build?',
  choices: choicesFor(
    'question',
    [
      { label: 'Stream the file as it is written', description: 'No timeout at any size; the download has no length until it ends, so no progress bar.' },
      { label: 'Write it in the background and mail a link', description: 'Works for every tenant; support waits a minute or two and needs the mail to arrive.' },
      { label: 'Split it by month', description: 'Small files, each well under the limit; a year is twelve downloads.' },
      { label: 'Raise the gateway timeout to five minutes', description: 'One line of config; the next larger tenant brings the question back.' },
      { label: 'Ask support first' },
    ],
    null,
  ),
  suggestedReply: null,
}
const hinted = as(stalled, 'suggested', { suggestedReply: 'Run only the route tests, and stop at the first failure.' })

const typed = 'Online, but pause it during the nightly export.'

const taken = (said: string, words = false, note: string | null = null): Partial<Card> => ({ settled: { said, words, note } })

/** Each page fits the smallest window the views are composed for (1366×768). */
const PAGES: Record<string, { width: string; title: string; specimens: Specimen[] }[]> = {
  kinds: [
    {
      width: '22em',
      title: 'in a roster entry',
      specimens: [
        ...[question, permission, running, green, stalled].map((p) => ({ label: `${p.kind}, listed`, pending: as(p, 'line'), armed: false })),
        { label: 'listed, answered', pending: as(permission, 'line-done'), armed: false, card: taken('Allow once') },
        { label: 'permission', pending: permission, armed: true },
      ],
    },
    {
      width: '27em',
      title: 'on a body, at a line’s now edge',
      specimens: [
        { label: 'question', pending: question, armed: true },
        { label: 'merge, checks running', pending: running, armed: true },
      ],
    },
    {
      width: '27em',
      title: 'what stopped',
      specimens: [
        { label: 'stalled', pending: stalled, armed: true },
        { label: 'blocked', pending: blocked, armed: true },
      ],
    },
  ],
  foot: [
    {
      width: '1fr',
      title: 'at the foot of the stage’s transcript',
      specimens: [
        { label: 'question', pending: as(question, 'wide'), armed: true },
        { label: 'permission', pending: as(permission, 'wide'), armed: true },
        { label: 'merge, checks green', pending: green, armed: true },
      ],
    },
    {
      width: '1fr',
      title: 'more to read, more to choose from',
      specimens: [
        { label: 'a long question', pending: long, armed: true },
        { label: 'a draft kept behind its key', pending: as(question, 'words-kept'), armed: true, card: { draft: typed } },
      ],
    },
  ],
  answers: [
    {
      width: '27em',
      title: 'an answer',
      specimens: [
        { label: 'on its way', pending: as(question, 'sending'), armed: true, card: { sending: 1 } },
        { label: 'taken', pending: as(question, 'settled'), armed: true, card: taken(question.choices[0].label) },
      ],
    },
    {
      width: '27em',
      title: 'a refusal, said in place',
      specimens: [
        { label: 'the action refused', pending: as(permission, 'refused'), armed: true, card: { trouble: 'The prompt on screen is not the one this card shows. Open the session to answer it.' } },
        { label: 'checks red', pending: red, armed: true, card: { trouble: 'Nothing was merged: the checks on #412 are red.' } },
      ],
    },
    {
      width: '27em',
      title: 'after it was taken',
      specimens: [
        { label: 'with what the action added', pending: as(running, 'settled'), armed: true, card: taken('Merge when green', false, 'It merges itself when the checks pass.') },
        { label: 'and still listed half a minute later', pending: as(stalled, 'still'), armed: true, card: { trouble: 'Answered "Try again", and it still waits.' } },
      ],
    },
  ],
  words: [
    {
      width: '27em',
      title: 'in your words',
      specimens: [
        { label: 'open', pending: as(question, 'words'), armed: true, card: { words: true } },
        { label: 'taken', pending: as(question, 'words-settled'), armed: true, card: taken(typed, true) },
      ],
    },
    {
      width: '27em',
      title: 'typed',
      specimens: [
        { label: 'a sentence', pending: as(permission, 'typed'), armed: true, card: { words: true, draft: 'Allow it, but push to a draft branch first.' } },
        { label: 'mnemo’s suggestion', pending: hinted, armed: true, card: { words: true, draft: hinted.suggestedReply! } },
      ],
    },
    {
      width: '1fr',
      title: 'sent',
      specimens: [
        { label: 'on its way', pending: as(question, 'words-sending'), armed: true, card: { words: true, draft: typed, sending: 'words' } },
        { label: 'refused, the words kept', pending: as(question, 'words-refused'), armed: true, card: { words: true, draft: typed, trouble: 'Its input box holds a draft. Nothing was typed into it.' } },
      ],
    },
  ],
}

function Sheet({ page }: { page: string }) {
  const columns = PAGES[page] ?? PAGES.kinds
  return (
    <div data-pending-sheet={page} style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'grid', gridTemplateRows: 'auto 1fr', background: 'var(--void)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '1.4em', height: '3.4em', padding: '0 1.4em', borderBottom: '1px solid var(--line)' }}>
        <Label>pending · {page}</Label>
        <WaitingCount />
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: columns.map((c) => c.width).join(' '), gap: '2.2em', padding: '1.2em 1.4em', minHeight: 0, alignItems: 'start' }}>
        {columns.map((column) => (
          <div key={column.title} style={{ display: 'grid', gap: '0.45em', minWidth: 0 }}>
            <Label>{column.title}</Label>
            {column.specimens.map((s) => (
              <div key={s.pending.id} style={{ display: 'grid', gap: '0.3em', marginTop: s.armed ? '0.55em' : 0 }}>
                {s.armed && <span style={{ fontSize: '0.78em', color: 'var(--ink-3)' }}>{s.label}</span>}
                <PendingCard pending={s.pending} armed={s.armed} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Draw a page of the sheet over the frame: `kinds`, `foot`, `answers` or `words`. */
export function showSheet(page: string): void {
  for (const column of PAGES[page] ?? []) for (const s of column.specimens) if (s.card) patch(s.pending, s.card)
  const frame = document.querySelector('.mn')
  if (!frame) throw new Error('the sheet is drawn inside the new frame: there is no .mn here')
  const host = document.createElement('div')
  frame.appendChild(host)
  createRoot(host).render(<Sheet page={page} />)
}

/** Every answer and reply is refused with `why`, as a runtime's guard refuses. */
export function refuseAnswers(why: string): void {
  setActions({ ...actions(), answer: async () => ({ ok: false, why }), reply: async () => ({ ok: false, why }) })
}

/** Every answer and reply is taken and the world left as it is: a live world between the
 *  answer and its next reading. */
export function keepAnswered(): void {
  setActions({ ...actions(), answer: async () => ({ ok: true }), reply: async () => ({ ok: true }) })
}

/** Nothing waits any more. */
export function answerAll(): void {
  const { world, set } = worldStore.getState()
  set({ ...world, pending: [] })
}
