/** First run, in one dialog: the setup check, then the "what mnemo learned" consent. Opens by
 *  itself when `claude` or `mnemo` is missing at launch, or when the open repo has history to
 *  learn from; ⌘K opens it by hand. */
import { useEffect } from 'react'
import { Check } from 'lucide-react'
import { Dialog, DialogContent } from '@/ui'
import { cn } from '@/ui/cn'
import { cwdForNewShell } from '../layout/cwd'
import { learned } from '../learned/app-store'
import { setup, useSetup } from '../setup/app-store'
import { needsSetup } from '../setup/tools'
import { onboarding, useOnboarding } from './app-store'
import { LearnedStep } from './learned-step'
import { SetupStep } from './setup-step'
import { STEPS, type Step } from './store'

const TITLE: Record<Step, string> = { setup: 'Setup', learned: 'What mnemo learned' }

/** A review that shows nothing worth keeping on screen: the learned step asks again. */
const stale = (kind: string) => kind === 'idle' || kind === 'nothing' || kind === 'no-repo' || kind === 'error'

function Steps({ step }: { step: Step }) {
  const rows = useSetup((s) => s.rows)
  const setupDone = !!rows && !needsSetup(rows)
  return (
    <ol className="flex items-center gap-1.5 text-xs" aria-label="onboarding steps">
      {STEPS.map((s, i) => {
        const active = s === step
        const done = s === 'setup' && setupDone && !active
        return (
          <li key={s} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-5 bg-border" />}
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2 py-0.5',
                active ? 'bg-accent text-foreground' : 'text-muted-foreground',
              )}
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-full border text-[10px] tabular-nums',
                  active ? 'border-brand bg-brand text-brand-foreground' : done ? 'border-state-done text-state-done' : 'border-border',
                )}
              >
                {done ? <Check className="size-2.5" /> : i + 1}
              </span>
              {TITLE[s]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function Onboarding() {
  const open = useOnboarding((s) => s.open)
  const step = useOnboarding((s) => s.step)

  // Each time a step comes into view it looks again: back from the tab an installer ran in, the
  // list is current; on the learned step, a repo opened since is the one offered.
  useEffect(() => {
    if (!open) return
    if (step === 'setup' && !setup.getState().checking) void setup.getState().check()
    if (step === 'learned' && stale(learned.getState().phase.kind)) void learned.getState().openCwd(cwdForNewShell())
  }, [open, step])

  const close = () => onboarding.getState().close()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="gap-5 sm:max-w-xl"
        data-onboarding={step}
        // It opens by itself, maybe mid-keystroke in a terminal: focus lands on the dialog, never
        // on a button an Enter would press (Read my history starts model calls).
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <Steps step={step} />
        {step === 'setup' ? <SetupStep onContinue={() => onboarding.setState({ step: 'learned' })} /> : <LearnedStep onBack={() => onboarding.setState({ step: 'setup' })} onClose={close} />}
      </DialogContent>
    </Dialog>
  )
}
