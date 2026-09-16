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

/* Objects. Three rules learned from looking at the gallery:
   1. An object behind the arms reads as stripes between them, not as a thing being held.
      Anything meant to be recognised sits clear of the arm band (y < 16) or beside it.
   2. Three scenes sharing one object array are three identical pictures with different
      timings. `enrich`, `briefing` and `catchup` are all about a document, so each gets
      its own silhouette: pinned note, rolled bundle, open page.
   3. A single filled rect is a box, whatever you call it. A sign needs a stem and a
      light centre bar to read as a sign. */

/** reflex — loose pages falling in. Three identical rects; the CSS staggers them apart. */
const pages: Rect[] = [r(13, 3, 6, 4, 'object'), r(13, 3, 6, 4, 'object'), r(13, 3, 6, 4, 'object')]

/** enrich — a note pinned above the head: the rule mnemo remembered before the edit.
 *  Pin, then the note body, then two text lines. */
const note: Rect[] = [r(15, 1, 2, 2, 'object'), r(11, 3, 10, 7, 'object'), r(13, 5, 6, 1, 'object'), r(13, 7, 4, 1, 'object')]

/** briefing — a rolled bundle: two end caps and a tight middle, being tucked away. */
const bundle: Rect[] = [r(10, 4, 2, 6, 'object'), r(20, 4, 2, 6, 'object'), r(12, 5, 8, 4, 'object')]

/** catchup — an open page, wider than it is tall, with three lines of text. */
const openPage: Rect[] = [r(8, 2, 16, 9, 'object'), r(10, 4, 12, 1, 'object'), r(10, 6, 12, 1, 'object'), r(10, 8, 8, 1, 'object')]

/** enforce — an octagonal STOP sign on a stem, with a white bar across it. */
const sign: Rect[] = [
  r(13, 1, 6, 2, 'object'),
  r(11, 3, 10, 2, 'object'),
  r(10, 5, 12, 4, 'object'),
  r(11, 9, 10, 2, 'object'),
  r(13, 11, 6, 2, 'object'),
  r(12, 6, 8, 2, 'object'),
]

/** dispatch — three little ones. Identical rects; the CSS fans them out. */
const kids: Rect[] = [r(14, 19, 4, 4, 'object'), r(14, 19, 4, 4, 'object'), r(14, 19, 4, 4, 'object')]

/** friction — a barbed hook one arm snagged, hanging clear of the arm band. */
const hook: Rect[] = [r(24, 14, 2, 7, 'object'), r(21, 20, 4, 2, 'object'), r(25, 12, 3, 2, 'object')]

/** learned — one new node, brighter than the ring it joins. */
const newNode: Rect[] = [r(15, 2, 2, 2, 'object')]

/** What mnemo is doing. The object carries the meaning; the movement carries the life —
 *  gesture alone was tested and the nine could not be told apart. */
export const SCENES: Record<PulseKind, Scene> = {
  reflex: { className: 'av-injecting', tone: 'accent', rects: [...BODY, ...ARMS, ...pages] },
  tool: { className: 'av-reading', tone: 'accent', rects: [...RING, ...BODY, ...ARMS] },
  enrich: { className: 'av-remembering', tone: 'accent', rects: [...BODY, ...ARMS, ...note] },
  enforce: { className: 'av-blocked', tone: 'red', rects: [...BODY, ...ARMS, ...sign] },
  briefing: { className: 'av-saving', tone: 'accent', rects: [...BODY, ...ARMS, ...bundle] },
  catchup: { className: 'av-catchup', tone: 'accent', rects: [...BODY, ...ARMS, ...openPage] },
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

/** mnemo at rest, breathing: the sidebar's vault square shows it between scenes. Not a
 *  `PulseKind` and not a child state, so it is its own export, and `Avatar` (which takes
 *  one of those) does not render it; `src/vaultlevel/` does, and its keyframes live there. */
export const IDLE: Scene = { className: 'av-idle', tone: 'accent', rects: [...RING, ...BODY, ...ARMS] }

/** Arms gathered tight and short: a narrow, compact silhouette against `ARMS_POOR`'s wide flat
 *  one. Kept to five straight runs — an earlier version curled the outer tips with an L of
 *  rects, and at 80px that read as loose pixels stuck to the body rather than a curl. */
const ARMS_WELL: Rect[] = [
  r(11, 16, 2, 4, 'arm'),
  r(14, 16, 2, 6, 'arm'),
  r(17, 16, 2, 6, 'arm'),
  r(20, 16, 2, 4, 'arm'),
]

/** Arms splayed wide and drooping outward, the outer pair falling away from the body: the
 *  silhouette widens and flattens, which is what reads as "sagging" at this size. Length alone
 *  does not — a first attempt only lengthened the arms and the pose was indistinguishable from
 *  `fair` on screen. */
const ARMS_POOR: Rect[] = [
  r(5, 18, 2, 6, 'arm'),
  r(10, 17, 2, 9, 'arm'),
  r(15, 17, 2, 10, 'arm'),
  r(20, 17, 2, 9, 'arm'),
  r(25, 18, 2, 6, 'arm'),
]

/** The three poses the vault square wears, keyed by `poseOf(tone)` in `src/vaultlevel/level.ts`.
 *  Five tones, three silhouettes: colour carries the fine slide, the pose carries the verdict. */
export const POSES = {
  well: { className: 'av-idle av-well', tone: 'accent', rects: [...RING, ...BODY, ...ARMS_WELL] },
  fair: IDLE,
  poor: { className: 'av-idle av-poor', tone: 'accent', rects: [...RING, ...BODY, ...ARMS_POOR] },
} as const satisfies Record<string, Scene>

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
