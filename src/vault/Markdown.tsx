import { Fragment, type ReactNode } from 'react'
import { parseBlocks, type Inline } from './md'

export type LinkHandlers = {
  onWiki(target: string): void
  onLink(href: string): void
}

function inline(nodes: Inline[], h: LinkHandlers): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>
      case 'code':
        return <code key={i}>{n.text}</code>
      case 'strong':
        return <strong key={i}>{inline(n.children, h)}</strong>
      case 'em':
        return <em key={i}>{inline(n.children, h)}</em>
      case 'wiki':
        return (
          <a key={i} className="vt-wiki" href="#" title={n.target} onClick={(e) => (e.preventDefault(), h.onWiki(n.target))}>
            {n.label}
          </a>
        )
      case 'link':
        return (
          <a key={i} href="#" title={n.href} onClick={(e) => (e.preventDefault(), h.onLink(n.href))}>
            {inline(n.children, h)}
          </a>
        )
    }
  })
}

export function Markdown({ text, ...h }: { text: string } & LinkHandlers) {
  return (
    <div className="vt-md">
      {parseBlocks(text).map((b, i) => {
        switch (b.t) {
          case 'heading': {
            // The page title is the pane header's, so `#` renders one level down.
            const H = `h${Math.min(b.level + 1, 6)}` as 'h2'
            return <H key={i}>{inline(b.children, h)}</H>
          }
          case 'para':
            return <p key={i}>{inline(b.children, h)}</p>
          case 'quote':
            return <blockquote key={i}>{inline(b.children, h)}</blockquote>
          case 'rule':
            return <hr key={i} />
          case 'code':
            return (
              <pre key={i} data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            )
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul'
            return (
              <L key={i}>
                {b.items.map((it, j) => (
                  <li key={j} style={it.depth ? { marginLeft: `${it.depth * 1.2}em` } : undefined}>
                    {inline(it.children, h)}
                  </li>
                ))}
              </L>
            )
          }
        }
      })}
    </div>
  )
}
