import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { FieldPrompt, mountPrompt } from '../palette/FieldPrompt'

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
    <FieldPrompt
      label="Git URL"
      placeholder="https://github.com/you/rules or git@host:you/rules.git"
      value={value}
      hint={error ?? (busy ? 'fetching…' : 'Enter: add as a marketplace source and fetch its rule sets')}
      error={!!error}
      icon={<GitBranch aria-hidden />}
      onChange={(v) => {
        setValue(v)
        setError(null)
      }}
      onDismiss={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
        if (e.key === 'Enter') void go()
      }}
    />
  )
}

/** A one-field overlay mounted on demand, open until `submit` resolves with no error. */
export function promptSource(submit: Submit): Promise<void> {
  return new Promise((resolve) =>
    mountPrompt((close) => (
      <SourcePrompt
        submit={submit}
        close={() => {
          close()
          resolve()
        }}
      />
    )),
  )
}
