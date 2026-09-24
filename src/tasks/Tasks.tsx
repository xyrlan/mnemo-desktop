// Tasks draws with Orca's list grammar, adapted from stablyai/orca
// components/right-sidebar/local-port-section.tsx and local-port-row.tsx (MIT, 122b8c25):
// sticky collapsible section headers with a count, compact rows with hover-revealed actions.
// Orca's own tasks page is not vendored; the data is Home's (issues and PRs per repo).
import { useEffect, useState, type ReactNode } from 'react'
import { Bot, Check, ChevronRight, CircleDot, ExternalLink, FolderPlus, GitPullRequest, GitPullRequestDraft, ListTodo, RefreshCw, Search, Send, X } from 'lucide-react'
import type { PaneViewProps } from '../panes/registry'
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from '@/ui'
import { cn } from '@/ui/cn'
import { homeStore, useHome } from '../home/app-store'
import { childSession, relTime, type HomeRepo, type Pr } from '../home/types'
import PrPane from '../home/pr-pane'
import { useMission } from '../mission/app-store'
import { selectionStore, useSelection } from '../github/app-store'
import { dispatchIssue, dispatchIssues, openIssue, openUrl } from '../github/actions'
import { linkIssues, linkWord, type Issue, type IssueLink } from '../github/types'
import { checksOf, dispatchable, EFFORTS, MAY, MODELS, taskRepos, totals, type TaskRepo } from './model'
import { openNewWorkspace } from './upstream'
import '../home/home.css'

const short = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

/** Hover-revealed row actions, as Orca's port rows have them; kept visible while focused. */
const ROW_ACTIONS = 'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
const ROW = 'group flex h-8 items-center gap-2 rounded-md px-2 transition-colors hover:bg-accent/50'

function SectionLabel({ children, count }: { children: string; count: number }) {
  return (
    <div className="flex items-center gap-1 px-2 pt-2 pb-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      <span className="ml-1 text-[10px] text-muted-foreground/60">{count}</span>
    </div>
  )
}

/** A dispatchable issue's pick for a batch: a click toggles it, shift-click extends the range
 *  from the last pick through `order`. A batch belongs to one repo; picking in another starts
 *  a fresh one (`selectionStore`). */
function PickBox({ root, order, n, on }: { root: string; order: number[]; n: number; on: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={`select #${n} for a batch dispatch`}
      title="select for a batch dispatch (shift: range)"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-opacity',
        on ? 'border-brand bg-brand text-brand-foreground' : 'border-muted-foreground/40 opacity-40 group-hover:opacity-100 focus-visible:opacity-100',
      )}
      onClick={(e) => {
        e.stopPropagation()
        selectionStore.getState().pick(root, order, n, { shift: e.shiftKey, meta: !e.shiftKey })
      }}
    >
      {on && <Check className="size-3" strokeWidth={3} />}
    </button>
  )
}

/** What already works on a linked issue, one word (`linkWord`), with the colour of its state. */
function LinkChip({ link }: { link: IssueLink }) {
  const word = linkWord(link)
  if (!word) return null
  const tone = /BLOCKED|✗/.test(word) ? 'bg-state-needs-you' : /active/.test(word) ? 'bg-state-working' : /✓|done/.test(word) ? 'bg-state-done' : 'bg-state-idle'
  return (
    <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px] font-normal text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', tone)} />
      {word}
    </Badge>
  )
}

function IssueRow({ root, issue, link, order, picked }: { root: string; issue: Issue; link?: IssueLink; order: number[]; picked: boolean }) {
  return (
    <div className={cn(ROW, picked && 'bg-accent/60')} data-issue={issue.number}>
      {link ? <span className="size-4 shrink-0" /> : <PickBox root={root} order={order} n={issue.number} on={picked} />}
      <CircleDot size={13} className="shrink-0 text-muted-foreground" />
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" title={issue.url} onClick={() => openIssue(issue)}>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{issue.number}</span>
        <span className="truncate text-[13px] text-foreground">{issue.title}</span>
        {issue.labels.slice(0, 3).map((l) => (
          <Badge key={l} variant="outline" className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
            {l}
          </Badge>
        ))}
      </button>
      {link && <LinkChip link={link} />}
      <div className={ROW_ACTIONS}>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground hover:text-foreground"
          title="a new workspace for this issue: a worktree, and claude in it"
          onClick={() => openNewWorkspace({ repo: root, issue: { number: issue.number, title: issue.title } })}
        >
          <FolderPlus />
          New workspace
        </Button>
        {!link && (
          <Button type="button" variant="ghost" size="xs" className="text-muted-foreground hover:text-foreground" title={`mnemo dispatch ${issue.number}`} onClick={() => dispatchIssue(root, issue.number)}>
            <Send />
            Dispatch
          </Button>
        )}
      </div>
    </div>
  )
}

function Checks({ pr }: { pr: Pr }) {
  const c = checksOf(pr)
  if (!c) return null
  return (
    <span role="img" aria-label={c.label} title={c.label} className="flex size-3.5 shrink-0 items-center justify-center">
      {c.tone === 'pass' && <Check className="size-3.5 text-status-success" strokeWidth={2.5} />}
      {c.tone === 'fail' && <X className="size-3.5 text-destructive" strokeWidth={2.5} />}
      {c.tone === 'pending' && <span className="size-1.5 animate-pulse rounded-full bg-status-warning" />}
    </span>
  )
}

function PrRow({ repo, pr, onOpen }: { repo: HomeRepo; pr: Pr; onOpen(): void }) {
  const kid = pr.child ? childSession(repo, pr.child) : null
  const Icon = pr.state === 'draft' ? GitPullRequestDraft : GitPullRequest
  return (
    <div className={ROW} data-pr={pr.number}>
      <span className="size-4 shrink-0" />
      <Icon size={13} className="shrink-0 text-muted-foreground" />
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" title="open the PR view" onClick={onOpen}>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{pr.number}</span>
        <span className="truncate text-[13px] text-foreground">{pr.title}</span>
        {pr.state === 'draft' && (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
            draft
          </Badge>
        )}
        <Checks pr={pr} />
      </button>
      {pr.child &&
        (kid ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-5 text-[11px] text-muted-foreground hover:text-foreground"
            title={`opened by ${kid.title || kid.id}`}
            onClick={() => homeStore.getState().openSession(repo, kid)}
          >
            <Bot />
            {pr.child}
          </Button>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={`opened by job ${pr.child}`}>
            <Bot className="size-3" />
            {pr.child}
          </span>
        ))}
      <div className={ROW_ACTIONS}>
        <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label="Open on GitHub" title="open on GitHub" onClick={() => openUrl(pr.url, `PR #${pr.number}`)}>
          <ExternalLink />
        </Button>
      </div>
    </div>
  )
}

function RepoGroup({ group, links, picked, onOpenPr }: { group: TaskRepo; links: Map<number, IssueLink>; picked: number[]; onOpenPr(pr: Pr): void }) {
  const [collapsed, setCollapsed] = useState(false)
  const { repo, issues, prs, error } = group
  const order = dispatchable(issues, links)
  const id = `tasks-${repo.root}`
  return (
    <section className="px-2 pt-2" data-root={repo.root}>
      <button
        type="button"
        className="sticky top-0 z-10 flex w-full items-center gap-1 border-b border-border/40 bg-background px-1 py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={!collapsed}
        aria-controls={id}
        title={repo.root}
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronRight size={12} className={cn('shrink-0 transition-transform', !collapsed && 'rotate-90')} />
        <span className="text-xs font-semibold text-foreground">{repo.name}</span>
        <span className="truncate text-[11px] text-muted-foreground/70">{short(repo.root)}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">{issues.length + prs.length}</span>
      </button>
      {!collapsed && (
        <div id={id}>
          {error && <div className="px-2 py-1 text-xs text-muted-foreground">GitHub could not read this repo: {error}</div>}
          {issues.length > 0 && (
            <>
              <SectionLabel count={issues.length}>Issues</SectionLabel>
              {issues.map((i) => (
                <IssueRow key={i.number} root={repo.root} issue={i} link={links.get(i.number)} order={order} picked={picked.includes(i.number)} />
              ))}
            </>
          )}
          {prs.length > 0 && (
            <>
              <SectionLabel count={prs.length}>Pull requests</SectionLabel>
              {prs.map((p) => (
                <PrRow key={p.number} repo={repo} pr={p} onOpen={() => onOpenPr(p)} />
              ))}
            </>
          )}
        </div>
      )}
    </section>
  )
}

const FLAG_SELECT =
  'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'

function Flag({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange(v: string): void }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <select className={FLAG_SELECT} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o || 'default'}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The batch's confirmation: what will be dispatched, and `--model`, `--effort` and `--may`
 *  before anything is spent — the board's sheet, in Orca's dialog. */
function BatchDialog({ root, ns, open, onOpenChange }: { root: string; ns: number[]; open: boolean; onOpenChange(v: boolean): void }) {
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [may, setMay] = useState('')
  const sorted = [...ns].sort((a, b) => a - b)
  const go = () => {
    dispatchIssues(root, sorted, { model: model || undefined, effort: effort || undefined, may: may || undefined })
    selectionStore.getState().clearSelection()
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Dispatch {sorted.length} issue{sorted.length === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription>
            {sorted.map((n) => `#${n}`).join(', ')} in {root.split('/').pop()}, one child each.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          <Flag label="Model" value={model} options={MODELS} onChange={setModel} />
          <Flag label="Effort" value={effort} options={EFFORTS} onChange={setEffort} />
          <Flag label="May" value={may} options={MAY} onChange={setMay} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={go}>
            <Send />
            Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The picked issues, floating over the list's foot while there are any. */
function BatchBar({ root, ns, onDispatch }: { root: string; ns: number[]; onDispatch(): void }) {
  return (
    <div className="absolute bottom-3 left-1/2 z-20 flex h-10 -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-popover pr-1 pl-3 text-sm text-popover-foreground shadow-floating" role="toolbar" aria-label="batch dispatch">
      <span className="whitespace-nowrap text-muted-foreground">
        <span className="font-medium text-foreground">{ns.length}</span> selected in {root.split('/').pop()}
      </span>
      <Button type="button" size="sm" onClick={onDispatch}>
        <Send />
        Dispatch {ns.length}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => selectionStore.getState().clearSelection()}>
        Clear
      </Button>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">{children}</div>
}

/** Every repo's open issues and PRs, from Home's GitHub read. An issue starts a new workspace or
 *  is dispatched, alone or picked into a batch; a PR opens the PR view over the list. */
export default function Tasks(_: PaneViewProps) {
  const snap = useHome((s) => s.snapshot)
  const github = useHome((s) => s.github)
  const githubAt = useHome((s) => s.githubAt)
  const opened = useHome((s) => s.openedPr)
  const mission = useMission((s) => s.snapshot)
  const selRoot = useSelection((s) => s.root)
  const selNs = useSelection((s) => s.ns)
  const [query, setQuery] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  // The PR view is Home's (`openedPr`, one at a time, one webview). This pane draws it only when
  // it opened it, so Home or a second Tasks pane never draws a second copy over itself.
  const [mine, setMine] = useState(false)

  // Opening is "the lens became visible", as it is for Home: sessions first, GitHub after.
  useEffect(() => {
    const h = homeStore.getState()
    void h.load().then(() => h.refreshGithub())
  }, [])
  useEffect(() => {
    if (!opened) setMine(false)
  }, [opened])

  const groups = taskRepos(snap, query)
  const total = totals(snap)
  const reading = github === 'loading'
  const linksOf = (root: string) => {
    const g = mission.repos.find((r) => r.root === root)
    return g ? linkIssues(g, snap.repos.find((r) => r.root === root)?.issues ?? []) : new Map<number, IssueLink>()
  }
  const batch = selRoot && selNs.length > 0 && groups.some((g) => g.repo.root === selRoot) ? { root: selRoot, ns: selNs } : null

  let body: ReactNode
  if (snap.repos.length === 0) body = <Empty>No projects yet. Add one from the sidebar, and its issues and pull requests show here.</Empty>
  else if (groups.length === 0 && query.trim()) body = <Empty>Nothing matches “{query.trim()}”.</Empty>
  else if (groups.length === 0 && github !== 'ready') body = <Empty>Reading issues and pull requests from GitHub…</Empty>
  else if (groups.length === 0) body = <Empty>No open issues or pull requests.</Empty>
  else
    body = (
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto pb-16">
        {groups.map((g) => (
          <RepoGroup
            key={g.repo.root}
            group={g}
            links={linksOf(g.repo.root)}
            picked={selRoot === g.repo.root ? selNs : []}
            onOpenPr={(pr) => {
              setMine(true)
              homeStore.getState().openPr(g.repo.root, pr)
            }}
          />
        ))}
      </div>
    )

  return (
    <div className="pane-body tasks">
      {/* `data-ui`: new UI, out of reach of the old views' element styles (`src/theme.css`).
          The PR view is today's, drawn with those styles, so it sits beside it, not in it. */}
      <div data-ui className="absolute inset-0 flex flex-col bg-background font-sans text-foreground" inert={!!(opened && mine)}>
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <ListTodo size={14} className="text-muted-foreground" />
          <span className="text-[13px] font-semibold">Tasks</span>
          <span className="text-xs text-muted-foreground">
            {total.issues} issue{total.issues === 1 ? '' : 's'} · {total.prs} PR{total.prs === 1 ? '' : 's'}
          </span>
          <div className="relative ml-auto w-56">
            <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-7 pl-7 text-xs md:text-xs" placeholder="Filter issues and PRs" aria-label="filter issues and PRs" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            disabled={reading}
            aria-label="Read GitHub again"
            title={githubAt ? `read ${relTime(githubAt)} ago` : 'not read yet'}
            onClick={() => void homeStore.getState().refreshGithub()}
          >
            <RefreshCw className={cn(reading && 'animate-spin')} />
          </Button>
        </header>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {body}
          {batch && <BatchBar root={batch.root} ns={batch.ns} onDispatch={() => setBatchOpen(true)} />}
        </div>
        {batch && <BatchDialog root={batch.root} ns={batch.ns} open={batchOpen} onOpenChange={setBatchOpen} />}
      </div>
      {opened && mine && <PrPane opened={opened} />}
    </div>
  )
}
