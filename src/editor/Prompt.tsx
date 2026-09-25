import { useState } from 'react'
import { FileSearch } from 'lucide-react'
import { FieldPrompt, mountPrompt } from '../palette/FieldPrompt'
import type { PromptFn, PromptResult } from './actions'

function PathPrompt({ initial, hint, done }: { initial: string; hint: string; done(r: PromptResult | null): void }) {
  const [value, setValue] = useState(initial)
  return (
    <FieldPrompt
      label="File path"
      value={value}
      hint={hint}
      icon={<FileSearch aria-hidden />}
      onChange={setValue}
      onDismiss={() => done(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') done(null)
        if (e.key === 'Enter') done({ value, place: e.metaKey || e.ctrlKey ? 'tab' : 'split-row' })
      }}
    />
  )
}

/** A one-field overlay, mounted on demand: the editor piece cannot render into App. */
export const promptPath: PromptFn = ({ initial, hint }) =>
  new Promise((resolve) =>
    mountPrompt((close) => (
      <PathPrompt
        initial={initial}
        hint={hint}
        done={(r) => {
          close()
          resolve(r)
        }}
      />
    )),
  )
