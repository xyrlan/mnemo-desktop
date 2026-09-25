import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { ChatAgent } from '../conversation/agent'
import type { SessionStatus } from '../conversation/types'
import { answerPrompt, type Answer, type Choice } from '../cockpit/approve'
import { missionStore } from './app-store'
import { answerQuestion, answerQuestionOther } from './ask'
import { allChildren, childWord, type ChildSession } from './types'

/** How the chat answers a dispatched child, for each kind of block (the Dispatch tab's spec,
 *  *Answering*):
 *
 *  - a permission prompt: Approve / Deny, typed into `claude attach` (`answerPrompt`);
 *  - a question it asked as it ended its turn: the composer, by the route picked beside it;
 *  - the multiple-choice dialog (AskUserQuestion): its option, or words, typed into a hidden
 *    `claude attach` (`ask.ts`).
 *
 *  A child has no shell mode: what it runs is its own business, and "as me" typing a `!` would
 *  run the reply as a command, so the agent has no `bash` and the composer offers no `!`. */

/** Where the composer's text goes: typed into the child's own terminal as the maintainer, which
 *  can approve a push or a PR (#84, #86), or its inbox as a message from another session, which
 *  cannot. */
export type Route = 'as-me' | 'message'

/** "As me" is the default: it is the maintainer answering, and a question like "may I add a
 *  crate?" needs their consent. */
export const DEFAULT_ROUTE: Route = 'as-me'

export const routeStore = createStore<{ routes: Record<string, Route> }>(() => ({ routes: {} }))
export const useRoute = (id: string): Route => useStore(routeStore, (s) => s.routes[id] ?? DEFAULT_ROUTE)
export const setRoute = (id: string, route: Route) => routeStore.setState((s) => ({ routes: { ...s.routes, [id]: route } }))

export type ChildAgentDeps = {
  answerPrompt(child: ChildSession, choice: Choice): Promise<Answer>
  answerQuestion(id: string, index: number): Promise<void>
  answerQuestionOther(id: string, text: string): Promise<void>
}

const defaults: ChildAgentDeps = {
  answerPrompt: (child, choice) => answerPrompt(child, choice),
  answerQuestion: (id, index) => answerQuestion(id, index),
  answerQuestionOther: (id, text) => answerQuestionOther(id, text),
}

/** The chat's answers for `child`. Each reads the child as the latest snapshot has it, so one
 *  agent serves a pane across polls; each rejects with what went wrong when nothing reached it. */
export function childAgent(child: ChildSession, deps: Partial<ChildAgentDeps> = {}): ChatAgent {
  const d = { ...defaults, ...deps }
  const latest = () => allChildren(missionStore.getState().snapshot).find((c) => c.id === child.id) ?? child
  const approve = async (choice: Choice) => {
    const a = await d.answerPrompt(latest(), choice)
    if (a.phase === 'error') throw new Error(a.error ?? 'the answer did not go through')
  }
  return {
    async send(text) {
      const c = latest()
      if (!c.live) throw new Error('the child is not running: nothing reaches it')
      const m = missionStore.getState()
      // The store sends its draft: the composer's text becomes it for this one send.
      m.setDraft(c.id, text)
      const route = routeStore.getState().routes[c.id] ?? DEFAULT_ROUTE
      const ok = route === 'as-me' ? await m.replyAsMe(c.id, c.suggested_reply) : await m.sendReply(c.id)
      if (!ok) throw new Error(missionStore.getState().replyErrors[c.id] || 'not sent')
    },
    allow: () => approve('yes'),
    deny: () => approve('no'),
    answer: (index) => d.answerQuestion(child.id, index),
    other: (text) => d.answerQuestionOther(child.id, text),
  }
}

/** What the chat needs to know of `child` from the snapshot: whether it works, and what it is
 *  parked on. Only a dialog the chat can answer is `waiting`: a permission prompt, or the
 *  multiple-choice dialog (`input needed`). A question asked as it ended its turn waits on
 *  nothing but a reply, so the composer answers it; any other dialog (`dialog open`, a sandbox
 *  request) is `parked`, and answered in the terminal. `claude agents` is read fresher than the
 *  child's tempo, so a dialog it reports counts even before the tempo says blocked. */
export function childStatus(child: ChildSession): SessionStatus {
  const word = childWord(child)
  if (word === 'done' || word === 'stopped') return { busy: false, waiting: null }
  const on = child.waiting_for?.toLowerCase() ?? ''
  if (on.includes('permission') || (!on && word === 'BLOCKED' && child.needs?.startsWith('approve '))) return { busy: false, waiting: 'permission' }
  if (on.includes('input needed')) return { busy: false, waiting: 'question' }
  if (on) return { busy: false, waiting: null, parked: true }
  return { busy: word === 'active', waiting: null }
}
