/** Setup (round 19): the four programs the app runs, found or missing, and a click that
 *  installs each missing one. mnemo installs inside the app; git, gh and Claude Code install
 *  in a terminal tab through this OS's own route. Since the Orca redesign it is onboarding's
 *  first step (`src/onboarding/`), which opens by itself at launch when `claude` or `mnemo` is
 *  missing; the pane stays for a workspace saved with it open. */
import { useEffect } from 'react'
import { store, useApp } from '../layout/app-store'
import { leaves } from '../layout/tree'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { ghInstall, installGh } from '../github/actions'
import { setup, useSetup } from './app-store'
import { onboarding } from '../onboarding/app-store'
import { afterRestore, openIfMissing } from './launch'
import type { Run } from './store'
import { currentOs, installRoute, TOOLS, WHAT, needsSetup, type Route, type ToolName, type ToolStatus } from './tools'
import './setup.css'

const inTab = (command: string) => void store.getState().openCommandTab(undefined, command)

function RunOutput({ run, head }: { run: Run; head: string }) {
  if (!run.running && !run.lines.length && !run.ok && !run.error) return null
  return (
    <div className={`su-output${run.error ? ' su-output-error' : run.ok ? ' su-output-ok' : ''}`}>
      <div className="su-output-head">{run.error ? `${head} failed` : run.ok ?? `${head}…`}</div>
      {run.lines.length > 0 && <pre>{run.lines.join('\n')}</pre>}
      {run.error && <pre className="su-error">{run.error}</pre>}
    </div>
  )
}

/** Stays under mnemo's row after the install, so its lines and its error outlive the button. */
function MnemoRun() {
  return <RunOutput run={useSetup((s) => s.mnemo)} head="installing mnemo" />
}

/** The button a missing tool gets, with the command it runs underneath. */
function Terminal({ label, route, onClick, after }: { label: string; route: Route; onClick: () => void; after?: string }) {
  return (
    <div className="su-action">
      <button className="su-primary" onClick={onClick} title={`opens a terminal with ${route.shows}`}>
        {label}
      </button>
      <span className="su-hint">
        opens a terminal with <code>{route.shows}</code>
        {after && `, ${after}`}
      </span>
    </div>
  )
}

function Action({ name }: { name: ToolName }) {
  const mnemo = useSetup((s) => s.mnemo)
  const os = currentOs()
  switch (name) {
    case 'mnemo':
      return (
        <div className="su-action">
          <button className="su-primary" disabled={mnemo.running} onClick={() => void setup.getState().installMnemo()}>
            {mnemo.running ? 'installing…' : 'Install mnemo'}
          </button>
          <span className="su-hint">downloads the latest release into the app's own folder, checks it, then runs mnemo init</span>
        </div>
      )
    case 'claude': {
      const route = installRoute('claude', os)
      return <Terminal label="Install Claude Code" route={route} onClick={() => inTab(route.command)} after="then starts claude there to log in" />
    }
    case 'git': {
      const route = installRoute('git', os)
      return <Terminal label="Install git" route={route} onClick={() => inTab(route.command)} />
    }
    case 'gh':
      return <Terminal label="Install gh" route={ghInstall()} onClick={installGh} />
  }
}

function Tool({ name, row }: { name: ToolName; row: ToolStatus | undefined }) {
  const path = row?.path ?? null
  return (
    <li className={`su-tool ${path ? 'su-found' : 'su-missing'}`} data-tool={name}>
      <div className="su-tool-head">
        <span className="su-mark">{path ? '✓' : '✗'}</span>
        <span className="su-name">{name}</span>
        <span className="su-state">{path ? 'found' : 'missing'}</span>
        {row?.managed && <span className="su-badge">managed by the app</span>}
        {row?.version && <span className="su-version">{row.version}</span>}
      </div>
      <div className="su-what">{WHAT[name]}</div>
      {path && <div className="su-path" title={path}>{path}</div>}
      {!path && <Action name={name} />}
      {name === 'mnemo' && <MnemoRun />}
    </li>
  )
}

function SetupPane({ id }: PaneViewProps) {
  const rows = useSetup((s) => s.rows)
  const checking = useSetup((s) => s.checking)
  const statusError = useSetup((s) => s.statusError)
  const path = useSetup((s) => s.path)
  // Checks again whenever this pane comes into view: back from the tab an installer ran in,
  // the list is already current.
  const shown = useApp((s) => !!s.tabs.find((t) => t.id === s.activeTab && leaves(t.root).includes(id)))
  useEffect(() => {
    if (shown && !setup.getState().checking) void setup.getState().check()
  }, [shown])

  return (
    <div className="pane-body setup">
      <header className="su-head">
        <span className="su-title">Setup</span>
        <span className="su-sub">what the app runs, and where it found it</span>
        <button disabled={checking} onClick={() => void setup.getState().check()}>
          {checking ? 'checking…' : 'Check again'}
        </button>
      </header>
      {statusError && <pre className="su-error su-status-error">could not check the tools: {statusError}</pre>}
      {!rows && !statusError && <div className="su-empty">checking…</div>}
      {rows && (
        <>
          <div className={`su-summary ${needsSetup(rows) ? 'su-summary-missing' : ''}`}>
            {needsSetup(rows)
              ? 'claude and mnemo are both needed. Install what is missing, one click each.'
              : TOOLS.every((n) => rows.find((r) => r.name === n)?.path)
                ? 'Everything is in place.'
                : 'claude and mnemo are in place.'}
          </div>
          <ul className="su-tools">
            {TOOLS.map((n) => (
              <Tool key={n} name={n} row={rows.find((r) => r.name === n)} />
            ))}
          </ul>
        </>
      )}
      <section className="su-path-section">
        <div className="su-what">
          The app finds what it installed by itself. Terminals outside it do not, until the app's tool folders are on your own PATH.
        </div>
        <div className="su-action">
          <button disabled={path.running} onClick={() => void setup.getState().addToPath()}>
            {path.running ? 'adding…' : 'Add to PATH'}
          </button>
          {path.ok && <span className="su-ok">{path.ok}</span>}
          {path.error && <span className="su-error">{path.error}</span>}
        </div>
      </section>
    </div>
  )
}

registerPaneView('setup', SetupPane)

register({ id: 'setup.open', title: 'Setup: install git, claude, mnemo and gh', run: () => onboarding.getState().show('setup') })

// Once per app run, not once per hot reload: the first launch with `claude` or `mnemo` missing
// opens onboarding at setup instead of leaving the user on a Home that cannot do anything.
const hot = import.meta.hot?.data as { setupChecked?: boolean } | undefined
if (!hot?.setupChecked) {
  if (hot) hot.setupChecked = true
  void openIfMissing({
    restored: afterRestore(store),
    check: () => setup.getState().check(),
    open: () => onboarding.getState().show('setup'),
  })
}
