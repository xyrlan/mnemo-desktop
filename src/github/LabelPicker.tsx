import { useEffect, useRef, useState } from 'react'
import { setIssueLabels } from './actions'
import './github.css'

/** The recent-issues label filter of one repo: a chip that opens a checklist of the repo's
 *  labels. Persisted per repo in settings (`issueLabels`). */
export default function LabelPicker({ root, name, labels, selected }: { root: string; name?: string; labels: string[]; selected: string[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const toggle = (l: string) => setIssueLabels(root, selected.includes(l) ? selected.filter((x) => x !== l) : [...selected, l])
  // A saved label the repo no longer has still shows, so it can be unticked.
  const all = [...new Set([...labels, ...selected])]
  return (
    <span className="gh-picker" ref={box}>
      <button className={`gh-picker-chip${selected.length ? ' on' : ''}`} onClick={() => setOpen(!open)} title={`labels of the recent issues shown${name ? ` in ${name}` : ''}`}>
        {name ? `${name}: ` : ''}
        {selected.length ? selected.join(', ') : 'all labels'} ▾
      </button>
      {open && (
        <span className="gh-picker-menu">
          {all.length === 0 && <span className="gh-quiet">no labels</span>}
          {all.map((l) => (
            <label key={l}>
              <input type="checkbox" checked={selected.includes(l)} onChange={() => toggle(l)} />
              {l}
            </label>
          ))}
          {selected.length > 0 && (
            <button className="gh-link" onClick={() => setIssueLabels(root, [])}>
              clear
            </button>
          )}
        </span>
      )}
    </span>
  )
}
