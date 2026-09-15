import { useState } from 'react'
import { createRoot } from 'react-dom/client'

type Submit = (url: string) => Promise<string | null>

function SourcePrompt({ submit, close }: { submit: Submit; close(): void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (busy || !value.trim()) return
    setBusy(true)
    const err = await submit(value)
    setBusy(false)
    if (err) setError(err)
    else close()
  }
  return (
    <div className="palette-overlay" onMouseDown={close}>
      <div className="palette mk-prompt" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          aria-label="Git URL"
          placeholder="https://github.com/you/rules or git@host:you/rules.git"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'Enter') void go()
          }}
        />
        <div className={error ? 'mk-prompt-hint mk-error' : 'mk-prompt-hint'}>
          {error ?? (busy ? 'fetching…' : 'Enter: add as a marketplace source and fetch its rule sets')}
        </div>
      </div>
    </div>
  )
}

/** A one-field overlay mounted on demand, open until `submit` resolves with no error. */
export function promptSource(submit: Submit): Promise<void> {
  return new Promise((resolve) => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    const close = () => {
      root.unmount()
      host.remove()
      resolve()
    }
    root.render(<SourcePrompt submit={submit} close={close} />)
  })
}
