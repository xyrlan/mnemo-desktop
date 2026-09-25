// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatCopyButton.tsx
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/ui/cn'

/** Copies `text` whole, whatever the row shows of it, and says so for a moment with a check.
 *  A clipboard that refuses (the window lost focus) says that instead. */
export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [said, setSaid] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), [])
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => {
        setSaid('copied')
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setSaid('idle'), 1500)
      },
      () => setSaid('failed'),
    )
  const title = said === 'copied' ? 'Copied' : said === 'failed' ? 'Copy failed' : label
  return (
    <button
      type="button"
      onClick={() => void copy()}
      onBlur={() => said === 'failed' && setSaid('idle')}
      aria-label={title}
      title={title}
      data-copy={said}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        said === 'copied' && 'text-status-success',
        said === 'failed' && 'text-destructive',
        className,
      )}
    >
      {said === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}
