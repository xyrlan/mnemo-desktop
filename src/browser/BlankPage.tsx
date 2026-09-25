import { ExternalLink, Globe, SquareDashedMousePointer } from 'lucide-react'
import { Button, Kbd, KbdGroup } from '@/ui'

export type BlankPageProps = {
  /** Design Mode is on and waits for a page to arm. */
  waiting: boolean
  /** Turns Design Mode on (it waits for the page) or off. */
  onDesign(): void
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

/** What a browser pane with no page shows where the page goes: what the pane is for, Design
 *  Mode first. The page's webview stays hidden meanwhile, or it would cover this. */
export function BlankPage({ waiting, onDesign }: BlankPageProps) {
  return (
    <div data-ui className="browser-blank absolute inset-0 flex overflow-auto p-6 text-sm text-muted-foreground">
      {/* m-auto, not centring: a short pane scrolls from the top instead of cutting it off. */}
      <div className="m-auto flex max-w-md flex-col gap-4">
        <div className="flex items-center gap-2 text-foreground">
          <Globe className="size-4" />
          <span className="font-medium">Type a URL or a search in the bar above</span>
        </div>
        <p className="text-xs leading-5">
          Your dev server opens as it is: <span className="font-mono text-foreground">localhost:3000</span> goes over
          http.
        </p>
        <div className="flex gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground">
          <SquareDashedMousePointer className="mt-0.5 size-4 flex-none" />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="text-xs font-medium">Design Mode</div>
            <p className="text-xs leading-5 text-muted-foreground">
              Click <span className="font-medium text-foreground">Design</span> in the bar, then click any element on the page. Its screenshot,
              selector and styles go to this worktree's agent with your note: “make this button smaller”.
            </p>
            <div>
              <Button size="xs" variant={waiting ? 'outline' : 'default'} onClick={onDesign} aria-pressed={waiting}>
                <SquareDashedMousePointer />
                {waiting ? 'Waiting for a page… (turn off)' : 'Turn on Design Mode'}
              </Button>
            </div>
          </div>
        </div>
        <ul className="flex flex-col gap-1.5 text-xs">
          <li className="flex items-center gap-2">
            <ExternalLink className="size-3.5 flex-none" />
            <span>The last button in the bar hands the page to Chrome.</span>
          </li>
          <li className="flex items-center gap-2">
            <KbdGroup>
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>B</Kbd>
            </KbdGroup>
            <span>opens another browser tab, as does the “+” by the tabs.</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
