import { useCallback, useEffect, useState } from 'react'
import type { Entry, FsClient } from './client'
import { join, basename, visibleEntries } from './paths'

type Listing = Entry[] | { error: string }

type Props = {
  fs: Pick<FsClient, 'list'>
  root: string
  current: string
  expanded: string[]
  onToggleDir(dir: string): void
  /** `split` is true for ⌘-click (Ctrl-click off macOS). */
  onOpen(path: string, split: boolean): void
  modKey: 'metaKey' | 'ctrlKey'
}

export default function Tree({ fs, root, current, expanded, onToggleDir, onOpen, modKey }: Props) {
  const [listings, setListings] = useState<Record<string, Listing>>({})

  const load = useCallback(
    (dir: string) => {
      fs.list(dir).then(
        (entries) => setListings((l) => ({ ...l, [dir]: visibleEntries(entries) })),
        (e) => setListings((l) => ({ ...l, [dir]: { error: String(e) } })),
      )
    },
    [fs],
  )

  useEffect(() => {
    setListings({})
    load(root)
  }, [root, load])

  // Directories expanded in a previous mount (or just now) load lazily.
  useEffect(() => {
    for (const d of expanded) if (!(d in listings)) load(d)
  }, [expanded, listings, load])

  const refresh = () => {
    setListings({})
    load(root)
  }

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const listing = listings[dir]
    if (!listing) return <div className="editor-tree-note" style={{ paddingLeft: indent(depth) }}>…</div>
    if ('error' in listing) return <div className="editor-tree-note error" style={{ paddingLeft: indent(depth) }}>{listing.error}</div>
    if (listing.length === 0) return <div className="editor-tree-note" style={{ paddingLeft: indent(depth) }}>empty</div>
    return listing.map((e) => {
      const path = join(dir, e.name)
      if (e.is_dir) {
        const open = expanded.includes(path)
        return (
          <div key={path} role="treeitem" aria-expanded={open}>
            <div className="editor-tree-row" style={{ paddingLeft: indent(depth) }} onClick={() => onToggleDir(path)} title={path}>
              <span className="editor-tree-chevron">{open ? '▾' : '▸'}</span>
              {e.name}
            </div>
            {open && renderDir(path, depth + 1)}
          </div>
        )
      }
      return (
        <div
          key={path}
          role="treeitem"
          className={`editor-tree-row file${path === current ? ' current' : ''}`}
          style={{ paddingLeft: indent(depth) }}
          onClick={(ev) => onOpen(path, ev[modKey])}
          title={path}
        >
          {e.name}
        </div>
      )
    })
  }

  return (
    <div className="editor-tree" role="tree">
      <div className="editor-tree-head" title={root}>
        <span>{basename(root)}</span>
        <button onClick={refresh} title="Refresh">↻</button>
      </div>
      {renderDir(root, 0)}
    </div>
  )
}

const indent = (depth: number) => `${8 + depth * 12}px`
