/** The mnemo octopus, one scene per thing mnemo does and per state a child is in.
 *
 *  Pixels, not paths: `src/brand/mark.svg` is 65 vectoriser paths with no groups and no
 *  ids, so no limb is addressable and a new pose would need path morphing. On a grid an
 *  arm *is* a run of addressable rects, and a new pose is moving cells. The mark stays the
 *  logo (`src/brand/Wordmark.tsx`); this is the character. */
import type { PulseEvent, PulseKind } from '../pulse/types'
import type { childWord } from '../mission/types'

/** One pixel: x, y, width, height on a 32×32 grid, and which part it belongs to.
 *  The part decides its colour and which keyframe moves it. */
export type Rect = { x: number; y: number; w: number; h: number; part: Part }

export type Part = 'head' | 'eye' | 'arm' | 'node' | 'object'

export type Scene = {
  /** The CSS class carrying this scene's keyframes, defined in `avatar.css`. */
  className: string
  /** Theme token for the body. The object's own colour is baked into `avatar.css`. */
  tone: 'accent' | 'green' | 'yellow' | 'red' | 'muted'
  rects: Rect[]
  /** Shortest gap between two overlays of this kind, in ms. `0` means every event plays.
   *  The rate of `tool` is unknown until real use; this is the dial, left at zero so the
   *  first run measures the unthrottled truth. */
  minIntervalMs?: number
}

const r = (x: number, y: number, w: number, h: number, part: Part): Rect => ({ x, y, w, h, part })

/** Head, eyes and the node ring: every scene shares them, so a scene lists only what it adds. */
const BODY: Rect[] = [
  r(12, 6, 8, 2, 'head'),
  r(10, 8, 12, 2, 'head'),
  r(9, 10, 14, 4, 'head'),
  r(10, 14, 12, 2, 'head'),
  r(12, 10, 2, 2, 'eye'),
  r(18, 10, 2, 2, 'eye'),
]

/** Five arms hanging from the head, longest in the middle. */
const ARMS: Rect[] = [
  r(9, 16, 2, 7, 'arm'),
  r(12, 16, 2, 9, 'arm'),
  r(15, 16, 2, 10, 'arm'),
  r(18, 16, 2, 9, 'arm'),
  r(21, 16, 2, 7, 'arm'),
]

/** The radial-neural ring the mark is built on. */
const RING: Rect[] = [
  r(7, 7, 2, 2, 'node'),
  r(23, 7, 2, 2, 'node'),
  r(5, 12, 2, 2, 'node'),
  r(25, 12, 2, 2, 'node'),
  r(15, 3, 2, 2, 'node'),
  r(8, 17, 2, 2, 'node'),
]

const pages: Rect[] = [r(14, 17, 5, 4, 'object'), r(14, 17, 5, 4, 'object'), r(14, 17, 5, 4, 'object')]
const scroll: Rect[] = [r(11, 16, 10, 7, 'object'), r(13, 18, 6, 1, 'object'), r(13, 20, 5, 1, 'object')]
const sign: Rect[] = [r(10, 17, 12, 9, 'object'), r(12, 20, 8, 2, 'object')]
const kids: Rect[] = [r(14, 19, 4, 4, 'object'), r(14, 19, 4, 4, 'object'), r(14, 19, 4, 4, 'object')]
const hook: Rect[] = [r(16, 18, 2, 5, 'object'), r(13, 22, 4, 2, 'object')]
const newNode: Rect[] = [r(15, 2, 2, 2, 'object')]

/** What mnemo is doing. The object carries the meaning; the movement carries the life —
 *  gesture alone was tested and the nine could not be told apart. */
export const SCENES: Record<PulseKind, Scene> = {
  reflex: { className: 'av-injecting', tone: 'accent', rects: [...pages, ...BODY, ...ARMS] },
  tool: { className: 'av-reading', tone: 'accent', rects: [...RING, ...BODY, ...ARMS] },
  enrich: { className: 'av-remembering', tone: 'accent', rects: [...BODY, ...scroll, ...ARMS] },
  enforce: { className: 'av-blocked', tone: 'red', rects: [...BODY, ...ARMS, ...sign] },
  briefing: { className: 'av-saving', tone: 'accent', rects: [...BODY, ...scroll, ...ARMS] },
  catchup: { className: 'av-catchup', tone: 'accent', rects: [...BODY, ...scroll, ...ARMS] },
  learned: { className: 'av-learned', tone: 'green', rects: [...RING, ...newNode, ...BODY, ...ARMS] },
  friction: { className: 'av-friction', tone: 'yellow', rects: [...BODY, ...ARMS, ...hook] },
  dispatch: { className: 'av-dispatching', tone: 'accent', rects: [...BODY, ...ARMS, ...kids] },
}

/** What a dispatched child is doing. Derived from `childWord` rather than restated, so a
 *  new child state makes `STATE_SCENES` a build error instead of a silently missing scene. */
export type ChildWord = ReturnType<typeof childWord>

export const STATE_SCENES: Record<ChildWord, Scene> = {
  active: { className: 'av-active', tone: 'accent', rects: [...BODY, ...ARMS] },
  BLOCKED: { className: 'av-blocked-state', tone: 'yellow', rects: [...BODY, ...ARMS] },
  stalled: { className: 'av-stalled', tone: 'muted', rects: [...BODY, ...ARMS] },
  done: { className: 'av-done', tone: 'green', rects: [...BODY, ...ARMS] },
  stopped: { className: 'av-stopped', tone: 'muted', rects: [...BODY, ...ARMS] },
}

/** Pairs each rect with its index *within its own part*, so `avatar.css` can address
 *  "the third arm" as `.av-arm-2` regardless of where the arms sit in the list. Numbering
 *  by position in the whole list would silently break every stagger the moment a scene
 *  put its object before the body instead of after it. */
export function withPartIndex(rects: Rect[]): [Rect, number][] {
  const seen: Partial<Record<Part, number>> = {}
  return rects.map((rect) => {
    const n = seen[rect.part] ?? 0
    seen[rect.part] = n + 1
    return [rect, n]
  })
}

/** Captions that count, as (verb, singular, plural). */
const COUNTED: Partial<Record<PulseKind, [string, string, string]>> = {
  reflex: ['injecting', 'rule', 'rules'],
  dispatch: ['dispatching', 'child', 'children'],
}

const PLAIN: Record<PulseKind, string> = {
  reflex: 'injecting rules',
  tool: 'reading memory',
  enrich: 'remembering before the edit',
  enforce: 'blocked that command',
  briefing: 'saving the briefing',
  catchup: 'catching you up',
  learned: 'learned something',
  friction: 'noted the friction',
  dispatch: 'dispatching children',
}

/** The line under the octopus. Present tense, lowercase, one line. */
export function caption(event: PulseEvent): string {
  const counted = COUNTED[event.kind]
  if (counted && event.hits !== undefined) {
    const [verb, one, many] = counted
    return `${verb} ${event.hits} ${event.hits === 1 ? one : many}`
  }
  return PLAIN[event.kind] ?? ''
}
