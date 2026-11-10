// The Setup panel: the programs the app runs, found or missing, and installing them. mnemo
// installs and updates inside the app; git, gh, Claude Code and Grok Build install in a terminal,
// and the panel gives way to it. Opened, it checks again, so it is current after an installer ran.

import { useEffect, useState, type ReactNode } from 'react'
import { checkAgain, setup, useLookForUpdate, useSetup } from '../../setup/app-store'
import type { Run } from '../../setup/store'
import { currentOs, installRoute, isNeeded, neededTools, needsSetup, newerMnemo, TOOLS, UPDATE_HINT, WHAT, type Route, type ToolName, type ToolStatus } from '../../setup/tools'
import { Btn, closePanel, Loading, Notice, Out, say, Section, short } from '../memory/kit'
import { inTerminal } from './terminal'
import './setup.css'

/** The tools listed, in the order the app needs them: every one, `grok` once the status has a
 *  row for it. */
export const shownTools = (rows: ToolStatus[]): ToolName[] => TOOLS.filter((n) => n !== 'grok' || rows.some((r) => r.name === 'grok'))

/** The tools a sentence names: `a`, `a and b`, `a, b and c`. */
const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** What the panel says first: what is missing that the app needs, or that everything is in place. */
export function summary(rows: ToolStatus[]): { text: string; missing: ToolName[] } {
  const needed = neededTools(rows)
  const missing = needed.filter((n) => !rows.find((r) => r.name === n)?.path)
  if (needsSetup(rows)) {
    return { missing, text: `${listed(missing)} ${missing.length === 1 ? 'is' : 'are'} missing, and the app needs ${missing.length === 1 ? 'it' : 'them'}. One press each installs ${missing.length === 1 ? 'it' : 'them'}.` }
  }
  if (shownTools(rows).every((n) => rows.find((r) => r.name === n)?.path)) return { missing, text: 'Everything is in place.' }
  return { missing, text: `${listed(needed)} ${needed.length === 1 ? 'is' : 'are'} in place: all the app needs.` }
}

/** Opens `route`'s terminal; the panel gives way to it. A terminal that did not open says why. */
type Open = (route: Route, label: string) => void

function RunOutput({ run, head }: { run: Run; head: string }) {
  if (!run.running && !run.lines.length && !run.ok && !run.error) return null
  return (
    <div className="setup-run" data-tone={run.error ? 'bad' : run.ok ? 'ok' : undefined}>
      <div className="mn-label">{run.error ? `${head} failed` : (run.ok ?? `${head}…`)}</div>
      {run.lines.length > 0 && <Out>{run.lines.join('\n')}</Out>}
      {run.error && <Out tone="bad">{run.error}</Out>}
    </div>
  )
}

/** A button, and what it does beside it. */
function Action({ button, hint }: { button: ReactNode; hint: ReactNode }) {
  return (
    <div className="setup-action">
      {button}
      <span className="sp-dim setup-hint">{hint}</span>
    </div>
  )
}

/** What the app knows of a newer release, for the mnemo it installed. */
function MnemoUpdate({ version }: { version: string | null }) {
  const latest = useSetup((s) => s.latest)
  const mnemo = useSetup((s) => s.mnemo)
  if (latest.error) return <p className="setup-line sp-dim">could not look for a newer mnemo: {latest.error}</p>
  if (!latest.tag) return latest.asking ? <p className="setup-line sp-dim">looking for a newer release…</p> : null
  if (!newerMnemo(version, latest.tag)) return <p className="setup-line sp-dim">the latest release</p>
  return (
    <Action
      button={
        <Btn tone="go" disabled={mnemo.running} onClick={() => void setup.getState().installMnemo()}>
          {mnemo.running ? 'Updating…' : `Update to ${latest.tag}`}
        </Btn>
      }
      hint={UPDATE_HINT}
    />
  )
}

function Terminal({ label, route, open, after }: { label: string; route: Route; open: Open; after?: string }) {
  return (
    <Action
      button={<Btn onClick={() => open(route, label)}>{label}</Btn>}
      hint={
        <>
          opens a terminal with <code>{route.shows}</code>
          {after && `, ${after}`}
        </>
      }
    />
  )
}

function Install({ name, open }: { name: ToolName; open: Open }) {
  const mnemo = useSetup((s) => s.mnemo)
  const os = currentOs()
  switch (name) {
    case 'mnemo':
      return (
        <Action
          button={
            <Btn tone="go" disabled={mnemo.running} onClick={() => void setup.getState().installMnemo()}>
              {mnemo.running ? 'Installing…' : 'Install mnemo'}
            </Btn>
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
    <li className="setup-tool" data-tool={name} data-state={state}>
      <span className="setup-mark" aria-hidden="true">
        {path ? '✓' : needed ? '✕' : '○'}
      </span>
      <div className="setup-body">
        <div className="sp-wrap setup-head">
          <span className="setup-name">{name}</span>
          <span className="setup-state">{path ? 'found' : needed ? 'missing · needed' : 'missing · optional'}</span>
          {row?.managed && <span className="sp-tag">installed by the app</span>}
          {row?.version && <span className="sp-dim sp-mono sp-end">{row.version}</span>}
        </div>
        <div className="sp-dim">{WHAT[name]}</div>
        {path && <div className="sp-mono sp-dim setup-path">{short(path)}</div>}
        {!path && <Install name={name} open={open} />}
        {name === 'mnemo' && path && row?.managed && <MnemoUpdate version={row.version} />}
        {name === 'mnemo' && <RunOutput run={mnemo} head={path ? 'updating mnemo' : 'installing mnemo'} />}
      </div>
    </li>
  )
}

export function SetupPanel() {
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
    inTerminal(route.command, label).then(closePanel, (e: unknown) => setFailed(`Could not open a terminal: ${say(e)}`))
  }
  const sum = rows ? summary(rows) : null
  return (
    <div className="setup sp-root" tabIndex={-1} data-setup-panel="">
      <div className="sp-row setup-top">
        {sum ? (
          <p className="setup-summary sp-grow" data-missing={sum.missing.length ? '' : undefined}>
            <span className="setup-summary-mark" aria-hidden="true">
              {sum.missing.length ? '✕' : '✓'}
            </span>
            {sum.text}
          </p>
        ) : (
          <span className="sp-grow">{!statusError && <Loading>checking the tools…</Loading>}</span>
        )}
        <Btn small disabled={checking} onClick={() => void checkAgain()}>
          {checking ? 'Checking…' : 'Check again'}
        </Btn>
      </div>
      {statusError && <Notice tone="bad" text={`Could not check the tools: ${statusError}`} />}
      {failed && <Notice tone="bad" text={failed} onDismiss={() => setFailed(null)} />}
      {rows && (
        <ul className="setup-tools">
          {shownTools(rows).map((n) => (
            <Tool key={n} name={n} row={rows.find((r) => r.name === n)} needed={isNeeded(rows, n)} open={open} />
          ))}
        </ul>
      )}
      <Section title="Your own terminals">
        <p className="setup-line sp-dim">The app finds what it installed by itself. Terminals outside it do not, until the app's tool folders are on your own PATH.</p>
        <div className="setup-action">
          <Btn disabled={path.running} onClick={() => void setup.getState().addToPath()}>
            {path.running ? 'Adding…' : 'Add to PATH'}
          </Btn>
          {path.ok && <span className="setup-ok">✓ {path.ok}</span>}
          {path.error && <span className="setup-err">▲ {path.error}</span>}
        </div>
      </Section>
    </div>
  )
}
