// A page for eyes, not the app: every primitive in `@/ui`, open where it can be, and the three
// accent candidates side by side. Served by `pnpm dev` at /src/ui/gallery.html; `?dialog` opens
// the dialog over it.
import { createRoot } from 'react-dom/client'
import { Bell, GitBranch, Play, Settings } from 'lucide-react'
import '../theme.css'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Input,
  Kbd,
  KbdGroup,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from '@/ui'

const STATES = ['working', 'needs-you', 'done', 'idle'] as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-ui className="flex flex-col gap-3">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Accent({ id, name }: { id: 'a' | 'b' | 'c'; name: string }) {
  return (
    <div data-ui className="dark flex flex-col gap-3 rounded-lg border border-border bg-card p-4" data-accent={id}>
      <div className="text-sm font-medium">
        {id} · {name}
      </div>
      <div className="flex items-center gap-2">
        <span className="size-6 rounded-md bg-brand" />
        <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
          <Play /> New workspace
        </Button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <GitBranch className="size-4 text-brand" />
        <span className="text-brand">feat/orca-redesign</span>
      </div>
      <Switch defaultChecked />
    </div>
  )
}

function Gallery() {
  const dialog = new URLSearchParams(location.search).has('dialog')
  return (
    <TooltipProvider>
      <main data-ui className="flex min-h-screen flex-col gap-8 bg-background p-8 font-sans text-foreground">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">mnemo · ui primitives</h1>
          <p className="text-sm text-muted-foreground">Adapted from Orca's shadcn set. Pick an accent.</p>
        </header>

        <Section title="Accent candidates">
          <div className="grid grid-cols-3 gap-4">
            <Accent id="a" name="blue (today's)" />
            <Accent id="b" name="violet" />
            <Accent id="c" name="cyan" />
          </div>
        </Section>

        <Section title="Buttons, badges, keys">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button size="icon" variant="ghost">
              <Settings />
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <Badge>badge</Badge>
            <Badge variant="secondary">secondary</Badge>
            <Badge variant="outline">outline</Badge>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </div>
        </Section>

        <Section title="States">
          <div className="flex gap-4 text-sm">
            {STATES.map((s) => (
              <span key={s} className={`flex items-center gap-1.5 text-state-${s}`}>
                <span className="size-2 rounded-full bg-current" /> {s}
              </span>
            ))}
          </div>
        </Section>

        <Section title="Inputs and tabs">
          <div className="flex max-w-xl flex-col gap-3">
            <Input placeholder="Workspace name" />
            <Tabs defaultValue="terminal">
              <TabsList>
                <TabsTrigger value="terminal">Terminal</TabsTrigger>
                <TabsTrigger value="diff">Diff</TabsTrigger>
                <TabsTrigger value="browser">Browser</TabsTrigger>
              </TabsList>
              <TabsContent value="terminal" className="text-sm text-muted-foreground">
                Terminal tab
              </TabsContent>
            </Tabs>
          </div>
        </Section>

        <Section title="Open: dropdown, popover, tooltip">
          <div className="flex h-56 items-start gap-40">
            <DropdownMenu open modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Workspace</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>
                  Open in terminal <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  Dispatch <DropdownMenuShortcut>⌘⇧D</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">Remove worktree</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover open>
              <PopoverTrigger asChild>
                <Button variant="outline">Memory</Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-3 text-sm">
                3 rules fired in this session.
              </PopoverContent>
            </Popover>
            <Tooltip open>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost">
                  <Bell />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>
          </div>
        </Section>

        <Button variant="outline" className="self-start" onClick={() => toast.success('Workspace created')}>
          Toast
        </Button>
        <Toaster />

        <Dialog open={dialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove worktree?</DialogTitle>
              <DialogDescription>mnemo-desktop-wt-c-foundation has uncommitted changes.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">Cancel</Button>
              <Button variant="destructive">Remove</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Gallery />)
// A toast is on screen in every shot, so its look is reviewed too.
setTimeout(() => toast.success('Workspace created', { description: 'feat/orca-redesign · setup running' }), 300)
