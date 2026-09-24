// adapted from stablyai/orca src/main/browser/browser-grab-payload.ts and
// src/renderer/src/components/browser-pane/annotate/browser-annotation-output.ts (MIT, 122b8c25)

/** What Design Mode picks from a page: the element's HTML, a subset of its computed CSS and
 *  where it sits, in the shape Orca's grab script builds (`grab-guest.ts`), and how that is
 *  written up for the agent. */

export type GrabRect = { x: number; y: number; width: number; height: number }

export type GrabStyles = {
  display: string
  position: string
  width: string
  height: string
  margin: string
  padding: string
  color: string
  backgroundColor: string
  border: string
  borderRadius: string
  fontFamily: string
  fontSize: string
  fontWeight: string
  lineHeight: string
  textAlign: string
  zIndex: string
}

export type GrabPayload = {
  page: {
    sanitizedUrl: string
    title: string
    viewportWidth: number
    viewportHeight: number
    scrollX: number
    scrollY: number
    devicePixelRatio: number
    capturedAt: string
  }
  target: {
    tagName: string
    selector: string
    elementPath: string
    fullPath: string
    cssClasses: string
    nearbyElements: string[]
    selectedText: string | null
    isFixed: boolean
    reactComponents: string | null
    sourceFile: string | null
    textSnippet: string
    htmlSnippet: string
    attributes: Record<string, string>
    accessibility: { role: string | null; accessibleName: string | null; ariaLabel: string | null; ariaLabelledBy: string | null }
    rectViewport: GrabRect
    rectPage: GrabRect
    computedStyles: GrabStyles
  }
  nearbyText: string[]
  ancestorPath: string[]
}

/** The page script's own limits, enforced again here (Orca's `GRAB_BUDGET`). */
export const GRAB_BUDGET = {
  textSnippetMaxLength: 200,
  nearbyTextEntryMaxLength: 200,
  nearbyTextMaxEntries: 10,
  htmlSnippetMaxLength: 4096,
  ancestorPathMaxEntries: 10,
  nearbyElementsMaxEntries: 6,
  nearbyElementMaxLength: 160,
  selectorMaxLength: 700,
  pathMaxLength: 900,
  cssClassesMaxLength: 500,
  selectedTextMaxLength: 500,
  sourceFileMaxLength: 500,
  reactComponentsMaxLength: 500,
  noteMaxLength: 2000,
}

const SAFE_ATTRS = new Set(['id', 'class', 'name', 'type', 'role', 'href', 'src', 'alt', 'title', 'placeholder', 'for', 'action', 'method'])

const SECRET_PATTERNS = [
  'access_token',
  'auth_token',
  'api_key',
  'apikey',
  'client_secret',
  'oauth_state',
  'x-amz-',
  'session_id',
  'sessionid',
  'csrf',
  'secret',
  'password',
  'passwd',
]

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

const containsSecret = (val: string) => {
  const lower = val.toLowerCase()
  return SECRET_PATTERNS.some((p) => lower.includes(p))
}

const clampStr = (s: unknown, max: number): string => {
  const str = typeof s === 'string' ? s : ''
  return str.length <= max ? str : `${str.slice(0, max)} (truncated)`
}

const safeNum = (n: unknown, fallback = 0): number => (typeof n === 'number' && Number.isFinite(n) ? n : fallback)

/** http(s) and file URLs without their query or fragment, where tokens live; anything else
 *  (a `javascript:` URI, a parse failure) is dropped. */
export function sanitizeUrl(raw: unknown): string {
  const str = typeof raw === 'string' ? raw : ''
  if (!str) return ''
  try {
    const url = new URL(str)
    if (url.protocol === 'about:') return url.toString() === 'about:blank' ? 'about:blank' : ''
    if (!SAFE_URL_PROTOCOLS.has(url.protocol)) return ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

/** Re-validates and clamps what the page handed over. The page is untrusted: whatever its
 *  own script returned (or a page pretending to be it), what reaches the card and the agent
 *  keeps to the budgets, drops unsafe attributes and redacts secret-looking values. Null
 *  when it is not a payload at all. */
export function clampGrabPayload(raw: unknown): GrabPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (!obj.page || typeof obj.page !== 'object' || !obj.target || typeof obj.target !== 'object') return null
  const page = obj.page as Record<string, unknown>
  const target = obj.target as Record<string, unknown>

  const clampArray = (arr: unknown, maxEntries: number, maxEntryLength: number) =>
    (Array.isArray(arr) ? arr : []).slice(0, maxEntries).map((item) => clampStr(item, maxEntryLength))
  const safeStr = (s: unknown, max = 500) => clampStr(s, max)
  const metaStr = (value: unknown, max: number) => {
    const s = safeStr(value, max)
    return s && containsSecret(s) ? '[redacted]' : s
  }
  const metaArray = (arr: unknown, maxEntries: number, maxEntryLength: number) =>
    (Array.isArray(arr) ? arr : [])
      .slice(0, maxEntries)
      .map((item) => metaStr(item, maxEntryLength))
      .filter(Boolean)
  const safeAttributes = (attrs: unknown): Record<string, string> => {
    if (!attrs || typeof attrs !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
      const name = key.toLowerCase()
      if (!name.startsWith('aria-') && !SAFE_ATTRS.has(name)) continue
      const v = safeStr(value, 2000)
      if (containsSecret(v)) out[name] = '[redacted]'
      else if ((name === 'href' || name === 'src' || name === 'action') && v) out[name] = sanitizeUrl(v)
      else out[name] = safeStr(value, name === 'class' ? 200 : 500)
    }
    return out
  }
  const safeRect = (r: unknown): GrabRect => {
    const rect = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    return { x: safeNum(rect.x), y: safeNum(rect.y), width: safeNum(rect.width), height: safeNum(rect.height) }
  }
  const a11y = (target.accessibility ?? {}) as Record<string, unknown>
  const css = (target.computedStyles ?? {}) as Record<string, unknown>
  const style = (k: keyof GrabStyles) => safeStr(css[k])

  return {
    page: {
      sanitizedUrl: sanitizeUrl(page.sanitizedUrl),
      title: safeStr(page.title),
      viewportWidth: safeNum(page.viewportWidth),
      viewportHeight: safeNum(page.viewportHeight),
      scrollX: safeNum(page.scrollX),
      scrollY: safeNum(page.scrollY),
      devicePixelRatio: safeNum(page.devicePixelRatio, 1),
      capturedAt: safeStr(page.capturedAt, 100),
    },
    target: {
      tagName: safeStr(target.tagName, 50),
      selector: safeStr(target.selector, GRAB_BUDGET.selectorMaxLength),
      elementPath: metaStr(target.elementPath, GRAB_BUDGET.pathMaxLength),
      fullPath: metaStr(target.fullPath, GRAB_BUDGET.pathMaxLength),
      cssClasses: metaStr(target.cssClasses, GRAB_BUDGET.cssClassesMaxLength),
      nearbyElements: metaArray(target.nearbyElements, GRAB_BUDGET.nearbyElementsMaxEntries, GRAB_BUDGET.nearbyElementMaxLength),
      selectedText: metaStr(target.selectedText, GRAB_BUDGET.selectedTextMaxLength) || null,
      isFixed: target.isFixed === true,
      reactComponents: metaStr(target.reactComponents, GRAB_BUDGET.reactComponentsMaxLength) || null,
      sourceFile: metaStr(target.sourceFile, GRAB_BUDGET.sourceFileMaxLength) || null,
      textSnippet: clampStr(target.textSnippet, GRAB_BUDGET.textSnippetMaxLength),
      htmlSnippet: clampStr(target.htmlSnippet, GRAB_BUDGET.htmlSnippetMaxLength),
      attributes: safeAttributes(target.attributes),
      accessibility: {
        role: metaStr(a11y.role, 500) || null,
        accessibleName: metaStr(a11y.accessibleName, 500) || null,
        ariaLabel: metaStr(a11y.ariaLabel, 500) || null,
        ariaLabelledBy: metaStr(a11y.ariaLabelledBy, 500) || null,
      },
      rectViewport: safeRect(target.rectViewport),
      rectPage: safeRect(target.rectPage),
      computedStyles: {
        display: style('display'),
        position: style('position'),
        width: style('width'),
        height: style('height'),
        margin: style('margin'),
        padding: style('padding'),
        color: style('color'),
        backgroundColor: style('backgroundColor'),
        border: style('border'),
        borderRadius: style('borderRadius'),
        fontFamily: style('fontFamily'),
        fontSize: style('fontSize'),
        fontWeight: style('fontWeight'),
        lineHeight: style('lineHeight'),
        textAlign: style('textAlign'),
        zIndex: style('zIndex'),
      },
    },
    nearbyText: clampArray(obj.nearbyText, GRAB_BUDGET.nearbyTextMaxEntries, GRAB_BUDGET.nearbyTextEntryMaxLength),
    ancestorPath: clampArray(obj.ancestorPath, GRAB_BUDGET.ancestorPathMaxEntries, 200),
  }
}

/** What `TAKE_SCRIPT` answered. */
export type Take = { kind: 'waiting' } | { kind: 'unarmed' } | { kind: 'cancelled' } | { kind: 'picked'; payload: GrabPayload } | { kind: 'error'; message: string }

/** Decodes what the webview hands back for `TAKE_SCRIPT`. WebKit serializes the script's
 *  value as JSON, so the page's own JSON string arrives quoted once more; an empty answer
 *  means the script threw before its own catch could run, which reads as "not armed" so the
 *  overlay is laid again. */
export function parseTake(raw: string): Take {
  if (!raw) return { kind: 'unarmed' }
  let value: unknown
  try {
    value = JSON.parse(raw)
    if (typeof value === 'string') value = JSON.parse(value)
  } catch {
    return { kind: 'error', message: 'the page answered something that is not JSON' }
  }
  if (!value || typeof value !== 'object') return { kind: 'unarmed' }
  const v = value as Record<string, unknown>
  if ('picked' in v) {
    const payload = clampGrabPayload(v.picked)
    return payload ? { kind: 'picked', payload } : { kind: 'error', message: 'the page handed over something that is not an element' }
  }
  if (v.cancelled === true) return { kind: 'cancelled' }
  if (typeof v.error === 'string') return { kind: 'error', message: clampStr(v.error, 300) }
  return v.armed === true ? { kind: 'waiting' } : { kind: 'unarmed' }
}

// ---------------------------------------------------------------------------------------
// The write-up for the agent.

/** Collapses whitespace, since page text can be paste-sized and spread over many lines. */
export function inlineText(content: string, max = 2048): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** A fence longer than any backtick run in `content`, so page HTML cannot close it early. */
function fence(language: string, content: string): string[] {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length))
  const marker = '`'.repeat(longest + 1)
  return [`${marker}${language}`, content, marker]
}

function inlineCode(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length))
  const marker = '`'.repeat(longest + 1)
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : ''
  return `${marker}${pad}${content}${pad}${marker}`
}

/** The picked element in a few words: `button "Save"`, with its React component when known. */
export function elementLabel(p: GrabPayload): string {
  const t = p.target
  const name = t.accessibility.accessibleName
  const base = name ? `${t.tagName} "${inlineText(name, 60)}"` : t.textSnippet ? `${t.tagName} "${inlineText(t.textSnippet, 60)}"` : t.tagName
  return t.reactComponents ? `${inlineText(t.reactComponents)} ${base}` : base
}

/** Computed styles worth reading: defaults (`auto`, `static`, a transparent background…)
 *  say nothing and are left out. */
export function styleLines(s: GrabStyles): string[] {
  const entries: [string, string][] = [
    ['display', s.display],
    ['position', s.position],
    ['width', s.width],
    ['height', s.height],
    ['margin', s.margin],
    ['padding', s.padding],
    ['color', s.color],
    ['background', s.backgroundColor],
    ['border', s.border],
    ['border-radius', s.borderRadius],
    ['font-family', s.fontFamily],
    ['font-size', s.fontSize],
    ['font-weight', s.fontWeight],
    ['line-height', s.lineHeight],
    ['text-align', s.textAlign],
    ['z-index', s.zIndex],
  ]
  const skip = (name: string, v: string) =>
    !v ||
    v === 'auto' ||
    v === 'normal' ||
    (name === 'position' && v === 'static') ||
    (name === 'display' && v === 'inline') ||
    (name === 'background' && v === 'rgba(0, 0, 0, 0)')
  return entries.filter(([name, v]) => !skip(name, v)).map(([name, v]) => `- ${name}: ${v}`)
}

function pageHeading(p: GrabPayload): string {
  try {
    const url = new URL(p.page.sanitizedUrl)
    return url.pathname
  } catch {
    return p.page.sanitizedUrl || 'current page'
  }
}

/** The message the agent gets: the user's note first, then the element (selector, HTML,
 *  computed CSS) and where its screenshot is. `shot` is the saved PNG's path, or why there
 *  is none. */
export function formatGrab(p: GrabPayload, note: string, shot: { path: string } | { error: string }): string {
  const t = p.target
  const r = t.rectViewport
  const lines = [
    `## Design feedback: ${pageHeading(p)}`,
    '',
    note.trim() || '(no note)',
    '',
    `**URL:** ${p.page.sanitizedUrl}`,
    `**Viewport:** ${p.page.viewportWidth}x${p.page.viewportHeight}`,
    `**Element:** ${elementLabel(p)}`,
    `**Selector:** ${inlineCode(t.selector)}`,
  ]
  if (t.elementPath) lines.push(`**Location:** ${inlineCode(t.elementPath)}`)
  if (t.sourceFile) lines.push(`**Source:** ${inlineText(t.sourceFile)}`)
  if (t.reactComponents) lines.push(`**React:** ${inlineText(t.reactComponents)}`)
  lines.push(`**Bounds:** x=${Math.round(r.x)}, y=${Math.round(r.y)}, ${Math.round(r.width)}x${Math.round(r.height)}`)
  if (t.cssClasses) lines.push(`**Classes:** ${inlineCode(t.cssClasses)}`)
  if (t.selectedText) lines.push(`**Selected text:** "${inlineText(t.selectedText)}"`)
  else if (t.textSnippet) lines.push(`**Text:** "${inlineText(t.textSnippet)}"`)
  lines.push('path' in shot ? `**Screenshot:** ${shot.path}` : `**Screenshot:** none (${shot.error})`)
  const css = styleLines(t.computedStyles)
  if (css.length) lines.push('**Computed styles:**', ...css)
  if (p.nearbyText.length) lines.push('**Nearby text:**', ...p.nearbyText.map((x) => `- ${inlineText(x)}`))
  if (t.htmlSnippet) lines.push('**HTML:**', ...fence('html', t.htmlSnippet))
  return lines.join('\n').trimEnd()
}
