import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { checkAgain, setup, useLookForUpdate, useSetup } from '../../../setup/app-store'
import type { Run } from '../../../setup/store'
import { currentOs, installRoute, isNeeded, neededTools, needsSetup, newerMnemo, TOOLS, UPDATE_HINT, WHAT, type Route, type ToolName, type ToolStatus } from '../../../setup/tools'
import { registerWindow } from '../../ui/windows'
import { inTerminal } from './terminal'
import './setup.css'

const say = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The tools listed: every one, `grok` once the status has a row for it. */
const shownTools = (rows: ToolStatus[]) => TOOLS.filter((n) => n !== 'grok' || rows.some((r) => r.name === 'grok'))

/** Opens `route`'s terminal; the window gives way to the drawer that shows it. A terminal that did
 *  not open says why. */
type Open = (route: Route, label: string) => void

function RunOutput({ run, head }: { run: Run; head: string }) {
  if (!run.running && !run.lines.length && !run.ok && !run.error) return null
  return (
    <div className="nx-su-out" data-tone={run.error ? 'danger' : run.ok ? 'ok' : undefined}>
      <div className="nx-su-out-head">{run.error ? `${head} failed` : (run.ok ?? `${head}…`)}</div>
      {run.lines.length > 0 && <pre>{run.lines.join('\n')}</pre>}
      {run.error && <pre className="nx-su-err">{run.error}</pre>}
    </div>
  )
}

/** A button, and what it does beside it. */
function ActionRow({ button, hint }: { button: ReactNode; hint: ReactNode }) {
  return (
    <div className="nx-su-action">
      {button}
      <span className="nx-muted">{hint}</span>
    </div>
  )
}

/** What the app knows of a newer release, for the mnemo it installed. */
function MnemoUpdate({ version }: { version: string | null }) {
  const latest = useSetup((s) => s.latest)
  const mnemo = useSetup((s) => s.mnemo)
  const line = (text: string) => <div className="nx-muted nx-su-latest">{text}</div>
  if (latest.error) return line(`could not look for a newer mnemo: ${latest.error}`)
  if (!latest.tag) return latest.asking ? line('looking for a newer release…') : null
  if (!newerMnemo(version, latest.tag)) return line('the latest release')
  return (
    <ActionRow
      button={
        <button type="button" className="nx-btn" data-tone="go" disabled={mnemo.running} onClick={() => void setup.getState().installMnemo()}>
          {mnemo.running ? 'Updating…' : `Update to ${latest.tag}`}
        </button>
      }
      hint={UPDATE_HINT}
    />
  )
}

function Terminal({ label, route, open, after }: { label: string; route: Route; open: Open; after?: string }) {
  return (
    <ActionRow
      button={
        <button type="button" className="nx-btn" title={`opens a terminal with ${route.shows}`} onClick={() => open(route, label)}>
          {label}
        </button>
      }
      hint={
        <>
          opens a terminal with <code>{route.shows}</code>
          {after && `, ${after}`}
        </>
      }
    />
  )
}

function Action({ name, open }: { name: ToolName; open: Open }) {
  const mnemo = useSetup((s) => s.mnemo)
  const os = currentOs()
  switch (name) {
    case 'mnemo':
      return (
        <ActionRow
          button={
            <button type="button" className="nx-btn" data-tone="go" disabled={mnemo.running} onClick={() => void setup.getState().installMnemo()}>
              {mnemo.running ? 'Installing…' : 'Install mnemo'}
            </button>
          }
          hint="downloads the latest release into the app's own folder, checks it, then runs mnemo init"
        />
      )
    case 'claude':
      return <Terminal label="Install Claude Code" route={installRoute('claude', os)} open={open} after="then starts claude there to log in" />
    case 'grok':
      return <Terminal label="Install Grok Build" route={installRoute('grok', os)} open={open} after="then runs grok login there" />
    case 'git':
      return <Terminal label="Install git" route={installRoute('git', os)} open={open} />
    case 'gh':
      return <Terminal label="Install gh" route={installRoute('gh', os)} open={open} />
  }
}

function Tool({ name, row, needed, open }: { name: ToolName; row: ToolStatus | undefined; needed: boolean; open: Open }) {
  const mnemo = useSetup((s) => s.mnemo)
  const path = row?.path ?? null
  const state = path ? 'found' : needed ? 'needed' : 'missing'
  return (
    <li className="nx-row nx-su-tool" data-tool={name} data-state={state}>
      <span className="nx-su-mark" aria-hidden>
        {path ? '✓' : needed ? '✕' : '○'}
      </span>
      <div className="nx-su-body">
        <div className="nx-su-head">
          <b>{name}</b>
          <span className="nx-su-state">{path ? 'found' : 'missing'}</span>
          {row?.managed && <span className="nx-su-badge">managed by the app</span>}
          {row?.version && <span className="nx-su-version nx-muted">{row.version}</span>}
        </div>
        <div className="nx-muted">{WHAT[name]}</div>
        {path && (
          <div className="nx-su-path" title={path}>
            {path}
          </div>
        )}
        {!path && <Action name={name} open={open} />}
        {name === 'mnemo' && path && row?.managed && <MnemoUpdate version={row.version} />}
        {name === 'mnemo' && <RunOutput run={mnemo} head={path ? 'updating mnemo' : 'installing mnemo'} />}
      </div>
    </li>
  )
}

/** The tools a summary names, as a sentence says them: `a`, `a and b`, `a, b and c`. */
const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** What the summary says of the tools the app needs (`neededTools`): both, or all, when there is
 *  more than one. */
function summary(rows: ToolStatus[], shown: ToolName[]): string {
  const needed = neededTools(rows)
  const names = listed(needed)
  if (needsSetup(rows)) {
    const each = needed.length === 1 ? 'is needed' : needed.length === 2 ? 'are both needed' : 'are all needed'
    return `${names} ${each}. Install what is missing, one click each.`
  }
  if (shown.every((n) => rows.find((r) => r.name === n)?.path)) return 'Everything is in place.'
  return `${names} ${needed.length === 1 ? 'is' : 'are'} in place.`
}

/** SYSTEMS › Setup (spec `2026-10-15-nexus-app-design.md`, Q8): the programs the app runs, found
 *  or missing, as the setup screen shows them, the ones the accounts need marked (spec
 *  `2026-10-16-grok-accounts-design.md`, decision 10). mnemo installs (and updates) inside the
 *  app; git, gh, Claude Code and Grok Build install in a terminal the drawer shows, and the window
 *  gives way to it. Opened, it checks again, so it is current after an installer ran. `grok` is
 *  listed once the status reads it. */
export function SetupWindow({ close }: { close: () => void }): JSX.Element {
  const rows = useSetup((s) => s.rows)
  const checking = useSetup((s) => s.checking)
  const statusError = useSetup((s) => s.statusError)
  const path = useSetup((s) => s.path)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!setup.getState().checking) void setup.getState().check()
  }, [])
  useLookForUpdate()
  const open: Open = (route, label) => {
    setFailed(null)
    inTerminal(route.command, label).then(close, (e: unknown) => setFailed(`Could not open a terminal: ${say(e)}`))
  }
  return (
    <div className="nx-su" data-nx-setup="">
      <div className="nx-su-top">
        <span className="nx-muted">what the app runs, and where it found it</span>
        <button type="button" className="nx-btn" disabled={checking} onClick={() => void checkAgain()}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      {statusError && <pre className="nx-su-err nx-su-status">could not check the tools: {statusError}</pre>}
      {failed && (
        <p role="alert" className="nx-su-err">
          {failed}
        </p>
      )}
      {!rows && !statusError && <p className="nx-muted">checking…</p>}
      {rows && (
        <>
          <p className="nx-su-summary" data-missing={needsSetup(rows) ? '' : undefined}>
            {summary(rows, shownTools(rows))}
          </p>
          <ul className="nx-su-tools">
            {shownTools(rows).map((n) => (
              <Tool key={n} name={n} row={rows.find((r) => r.name === n)} needed={isNeeded(rows, n)} open={open} />
            ))}
          </ul>
        </>
      )}
      <section className="nx-su-pathsec">
        <h3 className="nx-section">Your own terminals</h3>
        <p className="nx-muted">The app finds what it installed by itself. Terminals outside it do not, until the app's tool folders are on your own PATH.</p>
        <div className="nx-su-action">
          <button type="button" className="nx-btn" disabled={path.running} onClick={() => void setup.getState().addToPath()}>
            {path.running ? 'Adding…' : 'Add to PATH'}
          </button>
          {path.ok && <span className="nx-su-ok">{path.ok}</span>}
          {path.error && <span className="nx-su-err">{path.error}</span>}
        </div>
      </section>
    </div>
  )
}

registerWindow({ id: 'setup', title: 'Setup', group: 'systems', order: 30, width: 640, render: (_params, close) => <SetupWindow close={close} /> })
