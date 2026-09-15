/** A small Markdown reader for vault pages: enough for what mnemo and Claude Code write
 *  (headings, paragraphs, lists, fences, quotes, rules, inline code/bold/italic, links,
 *  `[[wikilinks]]`). It builds a tree the view renders as React elements, so page text
 *  never reaches the DOM as HTML. */

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] }
  | { t: 'wiki'; target: string; label: string }

export type Block =
  | { t: 'heading'; level: number; children: Inline[] }
  | { t: 'para'; children: Inline[] }
  | { t: 'list'; ordered: boolean; items: { depth: number; children: Inline[] }[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; children: Inline[] }
  | { t: 'rule' }

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const FENCE = /^\s*(```|~~~)\s*([\w-]*)\s*$/

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n')
  const out: Block[] = []
  let i = 0
  const isBreak = (l: string) => /^\s*$/.test(l) || /^#{1,6}\s/.test(l) || FENCE.test(l) || /^\s*>/.test(l) || ITEM.test(l) || isRule(l)
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++
      out.push({ t: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      out.push({ t: 'heading', level: h[1].length, children: parseInline(h[2]) })
      i++
      continue
    }
    if (isRule(line)) {
      out.push({ t: 'rule' })
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push({ t: 'quote', children: parseInline(body.join(' ')) })
      continue
    }
    const first = ITEM.exec(line)
    if (first) {
      const ordered = /\d/.test(first[2])
      const items: { depth: number; text: string }[] = []
      while (i < lines.length) {
        const m = ITEM.exec(lines[i])
        // A top-level item of the other kind (`1.` after `-`) starts a new list.
        if (m && !m[1] && /\d/.test(m[2]) !== ordered) break
        if (m) items.push({ depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2), text: m[3] })
        else if (/^\s+\S/.test(lines[i])) items[items.length - 1].text += ' ' + lines[i].trim() // a wrapped item
        else break
        i++
      }
      out.push({ t: 'list', ordered, items: items.map((it) => ({ depth: it.depth, children: parseInline(it.text) })) })
      continue
    }
    const para: string[] = []
    while (i < lines.length && (para.length === 0 || !isBreak(lines[i]))) para.push(lines[i++].trim())
    out.push({ t: 'para', children: parseInline(para.join(' ')) })
  }
  return out
}

function isRule(l: string) {
  return /^\s*([-*_])(\s*\1){2,}\s*$/.test(l)
}

/** Inline spans, earliest match first; unmatched markers stay text. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  const push = (text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last?.t === 'text') last.text += text
    else out.push({ t: 'text', text })
  }
  const rules: [RegExp, (m: RegExpExecArray) => Inline][] = [
    [/`([^`]+)`/, (m) => ({ t: 'code', text: m[1] })],
    [/\[\[([^\]]+)\]\]/, (m) => ({ t: 'wiki', target: m[1].split('|')[0].trim(), label: (m[1].split('|')[1] ?? m[1].split('|')[0]).trim() })],
    [/\[([^\]]+)\]\(([^)\s]+)\)/, (m) => ({ t: 'link', href: m[2], children: parseInline(m[1]) })],
    [/\*\*(.+?)\*\*|__(.+?)__/, (m) => ({ t: 'strong', children: parseInline(m[1] ?? m[2]) })],
    [/\*(?!\s)(.+?)\*|(?<![\w])_(?!\s)(.+?)_(?![\w])/, (m) => ({ t: 'em', children: parseInline(m[1] ?? m[2]) })],
  ]
  let rest = s
  while (rest) {
    let best: { at: number; len: number; node: Inline } | null = null
    for (const [re, make] of rules) {
      const m = re.exec(rest)
      if (m && (!best || m.index < best.at)) best = { at: m.index, len: m[0].length, node: make(m) }
    }
    if (!best) {
      push(rest)
      break
    }
    push(rest.slice(0, best.at))
    out.push(best.node)
    rest = rest.slice(best.at + best.len)
  }
  return out
}
