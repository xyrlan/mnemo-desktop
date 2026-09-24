import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { PromptFn, PromptResult } from './actions'

function PathPrompt({ initial, hint, done }: { initial: string; hint: string; done(r: PromptResult | null): void }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="palette-overlay" onMouseDown={() => done(null)}>
      <div className="palette editor-prompt" data-ui onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          aria-label="File path"
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') done(null)
            if (e.key === 'Enter') done({ value, place: e.metaKey || e.ctrlKey ? 'tab' : 'split-row' })
          }}
        />
        <div className="editor-prompt-hint">{hint}</div>
      </div>
    </div>
  )
}

/** A one-field overlay, mounted on demand: the editor piece cannot render into App. */
export const promptPath: PromptFn = ({ initial, hint }) =>
  new Promise((resolve) => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    const done = (r: PromptResult | null) => {
      root.unmount()
      host.remove()
      resolve(r)
    }
    root.render(<PathPrompt initial={initial} hint={hint} done={done} />)
  })
