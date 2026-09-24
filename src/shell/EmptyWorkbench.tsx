import { FolderGit2, FolderOpen, GitBranch, Sparkles, SquareTerminal } from 'lucide-react'
import { Button, Kbd, KbdGroup } from '@/ui'
import { detectPlatform } from '../actions/keys'

const MOD = detectPlatform() === 'mac' ? '⌘' : 'Ctrl'

function Keys({ keys }: { keys: string[] }) {
  return (
    <KbdGroup className="ml-auto">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </KbdGroup>
  )
}

function Hint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex items-center gap-6">
      <span>{label}</span>
      <Keys keys={keys} />
    </div>
  )
}

/** A worktree with no tab open: what it is, and the two ways to start in it. */
export function EmptyWorktree({
  name,
  branch,
  repo,
  agentCommand,
  onNewTerminal,
  onLaunchAgent,
}: {
  name: string
  branch: string | null
  repo: string | null
  /** What "Launch agent" types, shown on hover. */
  agentCommand: string
  onNewTerminal(): void
  onLaunchAgent(): void
}) {
  // A main checkout is usually named after its repo: saying it twice says nothing.
  if (repo === name) repo = null
  return (
    <div data-shell-empty="worktree" className="absolute inset-0 flex items-center justify-center overflow-auto bg-background p-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-6 text-center animate-in fade-in-0 duration-200">
        <div className="flex min-w-0 max-w-full flex-col items-center gap-1.5">
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-xs">
            <FolderGit2 className="size-5" />
          </div>
          <h2 className="max-w-full truncate text-base font-semibold text-foreground">{name}</h2>
          {(branch || repo) && (
            <p className="flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
              {branch && (
                <>
                  <GitBranch className="size-3 shrink-0" />
                  <span className="truncate font-mono">{branch}</span>
                </>
              )}
              {branch && repo && <span aria-hidden>·</span>}
              {repo && <span className="truncate">{repo}</span>}
            </p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2">
          <Button variant="outline" className="w-full justify-start" onClick={onNewTerminal}>
            <SquareTerminal />
            New terminal
            <Keys keys={[MOD, 'T']} />
          </Button>
          <Button variant="outline" className="w-full justify-start" title={agentCommand} onClick={onLaunchAgent}>
            <Sparkles />
            Launch agent
            <span className="ml-auto font-mono text-xs text-muted-foreground">claude</span>
          </Button>
        </div>
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <Hint label="Jump to a workspace" keys={[MOD, 'J']} />
          <Hint label="New workspace" keys={[MOD, 'N']} />
          <Hint label="All commands" keys={[MOD, 'K']} />
        </div>
      </div>
    </div>
  )
}

/** No repo known yet: the one thing to do first. */
export function NoProjects({ onOpenFolder }: { onOpenFolder(): void }) {
  return (
    <div data-shell-empty="projects" className="absolute inset-0 flex items-center justify-center overflow-auto bg-background p-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center animate-in fade-in-0 duration-200">
        <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-xs">
          <FolderGit2 className="size-5" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">No projects yet</h2>
          <p className="text-sm text-muted-foreground">Open a folder with a git repository to start working in it.</p>
        </div>
        <Button variant="outline" onClick={onOpenFolder}>
          <FolderOpen />
          Open a folder
        </Button>
      </div>
    </div>
  )
}
