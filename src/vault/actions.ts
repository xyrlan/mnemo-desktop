import type { PageInfo } from './types'

export type VaultAction = {
  id: string
  label: string
  /** Tooltip: the command it runs. */
  title: string
  /** The `mnemo` subcommand, one of the Rust allowlist. */
  command: string
  args(page: PageInfo | null): string[]
  /** Needs a selected page (its slug is an argument). */
  needsPage?: boolean
  /** Changes the vault: asks for a second click first. */
  destructive?: boolean
  /** Re-reads the tree and page when it finishes. */
  reloads?: boolean
}

export const WHY_LIMIT = '50'

export const ACTIONS: VaultAction[] = [
  {
    id: 'disable',
    label: 'Disable rule',
    title: 'mnemo disable-rule <slug>',
    command: 'disable-rule',
    args: (p) => (p ? [p.slug] : []),
    needsPage: true,
    destructive: true,
    reloads: true,
  },
  { id: 'why', label: 'Why', title: `mnemo why --json --limit ${WHY_LIMIT}`, command: 'why', args: () => ['--json', '--limit', WHY_LIMIT] },
  { id: 'reverify', label: 'Reverify', title: 'mnemo reverify (dry run)', command: 'reverify', args: () => [] },
  { id: 'rewrites', label: 'Rewrites', title: 'mnemo rewrites (lists staged rewrites)', command: 'rewrites', args: () => [] },
  {
    id: 'rewrites-apply',
    label: 'Apply safe rewrites',
    title: 'mnemo rewrites --apply-safe',
    command: 'rewrites',
    args: () => ['--apply-safe'],
    destructive: true,
    reloads: true,
  },
  { id: 'learn', label: 'Extract now', title: 'mnemo learn', command: 'learn', args: () => [], reloads: true },
  { id: 'status', label: 'Status', title: 'mnemo status', command: 'status', args: () => [] },
]

export const actionById = (id: string) => ACTIONS.find((a) => a.id === id)
