// What the overlays' preview scenarios set up in the page
// (tools/preview/scenarios/next-overlays.mjs): James's store in a state worth looking at, his
// presence where the frame's top bar will have it, and every state the presence has, side by
// side. Nothing in the app imports this; a scenario's `drive` does, by URL.
//
// The words are synthetic, as the sample world's are. James speaks Portuguese.

import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { shortcutLabel } from '../../actions/chords'
import { fitFleet } from '../../frame/TopBar'
import type { ParentRef } from '../parent'
import { createJarvisStore, foldParent, foldResearch, type JarvisState, type Line, type Parent, type ResearchRun } from '../store'
import { jamesStore } from './james'
import { JamesPresence, Presence } from './Presence'

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0)
const ref = (sessionId: string, project: string, request: string): ParentRef => ({ sessionId, project, root: `/Users/you/work/${project}`, request, host: 'claude', startedAt: T0 })

/** A line before it has its id and its time, of whichever kind. */
type Said<L = Line> = L extends Line ? Omit<L, 'id' | 'at'> : never

let id = 0
const line = (l: Said): Line => ({ ...l, id: ++id, at: T0 + id * 1000 }) as Line

const TALK: Line[] = [
  line({ who: 'you', text: 'James, como está a fila do atlas-api?', spoken: true }),
  line({ who: 'james', text: 'Duas sessões esperam por você no atlas-api: uma pergunta sobre a coluna de histórico e uma permissão para rodar a migração.' }),
  line({ who: 'you', text: 'abre um parent para deixar os retries do webhook idempotentes', spoken: false }),
  line({ who: 'james', text: 'Mandei para o atlas-api.' }),
  line({ who: 'parent', project: 'atlas-api', sessionId: 'p-atlas', text: 'Abri o PR #482 com os retries idempotentes e os testes de duplicidade.' }),
  line({ who: 'web', text: 'idempotency keys em webhooks', sources: [{ title: 'Designing robust and predictable APIs with idempotency', url: 'https://example.com/idempotency' }] }),
]

function parents(): Parent[] {
  let ps = foldParent([], { kind: 'opened', parent: ref('p-lumen', 'lumen-web', 'descobre por que o bundle cresceu 40%') })
  ps = foldParent(ps, { kind: 'turn-ended', parent: ref('p-tessera', 'tessera', 'rascunha o formato do manifesto'), summary: 'Rascunho pronto.' })
  return foldParent(ps, { kind: 'approval', parent: ref('p-atlas', 'atlas-api', 'deixa os retries do webhook idempotentes'), question: 'git push origin fix/webhook-retries' })
}

function researches(): ResearchRun[] {
  const found = {
    summary: 'O Piper é o mais leve dos três e roda em CPU, em tempo real.',
    details: 'Piper roda em CPU com modelos de 20 a 60 MB.\nO XTTS pede GPU para ficar em tempo real.\nO Kokoro fica no meio: CPU, com latência maior.',
    sources: [
      { title: 'Piper: a fast, local neural text to speech system', url: 'https://example.com/piper' },
      { title: 'XTTS v2 model card', url: 'https://example.org/xtts-v2' },
    ],
  }
  let rs = foldResearch([], { id: 1, question: 'O que mudou no Tauri 2.11?', spoken: false, at: T0, state: 'failed', error: 'the web search gave no answer within 600 s, so it was stopped' })
  rs = foldResearch(rs, { id: 2, question: 'Qual TTS local roda em CPU?', spoken: true, at: T0, state: 'done', result: found })
  rs = foldResearch(rs, { id: 3, question: 'Como o WebView2 trata vídeo VP9 com fundo preto?', spoken: false, at: T0, state: 'running' })
  return foldResearch(rs, { id: 4, question: 'Limites de plano do Claude por janela', spoken: false, at: T0, state: 'queued' })
}

const READY: Partial<JarvisState> = { brain: { kind: 'claude', model: 'sonnet', effort: 'low' }, setup: { kind: 'idle' } }

/** The states a scenario asks for by name. */
const STATES: Record<string, () => Partial<JarvisState>> = {
  // Open on a conversation, a parent waiting on an approval, James listening.
  talk: () => ({ ...READY, open: true, lines: TALK, parents: parents(), voice: 'listening' }),
  // His researches, and a request being worked on.
  research: () => ({ ...READY, open: true, lines: TALK.slice(0, 2), researches: researches(), busy: true }),
  // A first run: nothing said, the local model not started.
  first: () => ({ brain: { kind: 'local' }, setup: { kind: 'idle' }, open: true }),
  // The local model on its way down.
  download: () => ({ brain: { kind: 'local' }, setup: { kind: 'download', file: '/Users/you/.mnemo-desktop/models/jarvis/model.gguf', done: 2.9 * 1024 ** 3, total: 6.8 * 1024 ** 3 }, open: true }),
  // The voice failed: the panel opened for it.
  failed: () => ({ ...READY, open: true, lines: [...TALK.slice(0, 2), line({ who: 'note', text: 'Voz: nenhum microfone encontrado', error: true })] }),
  // Closed, at rest; closed, speaking with an approval waiting.
  closed: () => ({ ...READY, open: false }),
  speaking: () => ({ ...READY, open: false, lines: TALK, parents: parents(), voice: 'speaking' }),
}

/** Puts the app's James in one of the named states. */
export function james(name: keyof typeof STATES): void {
  jamesStore.setState({ ...createJarvisStore().getState(), ...STATES[name]() })
}

let placed: Root | null = null

/** His presence where the frame's top bar will have it: at the bar's end. The corner's dock
 *  stands down by itself. */
export function placeInTopBar(): void {
  const bar = document.querySelector('[data-top-bar]')
  if (!bar || placed) return
  const host = bar.appendChild(document.createElement('span'))
  host.style.cssText = 'display: inline-flex; flex: none; margin-left: 0.4em'
  placed = createRoot(host)
  flushSync(() => placed!.render(<JamesPresence />))
  // The bar fits its fleet to what stands beside it when it draws; this presence came after.
  const fleet = bar.querySelector<HTMLElement>('.frame-fleet')
  if (fleet) fitFleet(fleet)
}

/** Every state his presence has, each over a store of its own, in a strip under the top bar. */
export function showPresences(): void {
  const of = (patch: Partial<JarvisState>) => {
    const store = createJarvisStore()
    store.setState(patch)
    return store
  }
  const failed = [line({ who: 'note', text: 'Voz: nenhum microfone encontrado', error: true })]
  const rows: [string, Partial<JarvisState>][] = [
    ['at rest', {}],
    ['listening', { voice: 'listening' }],
    ['thinking', { busy: true }],
    ['speaking', { voice: 'speaking' }],
    ['he still listens', { voice: 'waiting' }],
    ['failed', { lines: failed }],
    ['two approvals wait', { parents: [...parents(), ...foldParent([], { kind: 'approval', parent: ref('p-harbor', 'harbor-cli', 'publica a 2.4'), question: 'npm publish' })] }],
    ['the panel open', { open: true, voice: 'speaking' }],
  ]
  const host = document.querySelector('.mn[data-view]')!.appendChild(document.createElement('div'))
  host.style.cssText = 'position: absolute; inset: 5em auto auto 50%; transform: translateX(-50%); z-index: 90; display: grid; grid-template-columns: auto auto; align-items: center; gap: 1.1em 2em; padding: 2em 2.4em; border: 1px solid var(--line-2); background: #000'
  createRoot(host).render(
    <>
      {rows.map(([name, patch]) => [
        <span key={`${name}-label`} className="mn-label">
          {name}
        </span>,
        <span key={name}>
          <Presence store={of(patch)} shortcut={shortcutLabel('jarvis.toggle')} />
        </span>,
      ])}
    </>,
  )
}
