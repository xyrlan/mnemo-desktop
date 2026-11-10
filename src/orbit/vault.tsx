// The centre, opened: what the vault holds and what mnemo did lately. Memory is not only a
// backdrop.

import { useMemo } from 'react'
import { Kbd, Label } from '../ds'
import { age } from '../world/format'
import { sessionOf } from '../world/store'
import type { World } from '../world/types'
import { readVault } from './model'

const int = (n: number | null | undefined): string => (n == null ? '–' : Math.round(n).toLocaleString('en-US'))

function Bar({ value, of, memory }: { value: number; of: number; memory?: boolean }) {
  return (
    <span className="orbit-bar" data-tone={memory ? 'memory' : undefined}>
      <i style={{ transform: `scaleX(${(of > 0 ? value / of : 0).toFixed(4)})` }} />
    </span>
  )
}

export function Vault({ world, onClose, onOpen }: { world: World; onClose: () => void; onOpen: (sessionId: string) => void }) {
  const v = useMemo(() => readVault(world), [world])
  const learned = world.vault.learned
  const most = Math.max(1, ...v.outcomes.map((o) => o.n))
  const widest = Math.max(1, ...v.byProject.map((p) => p.n))
  return (
    <section className="orbit-vault" data-orbit-vault aria-label="Memory" onClick={(e) => e.stopPropagation()}>
      <div className="orbit-v-col">
        <h2 className="orbit-v-title">what memory holds</h2>
        <div className="orbit-hero">
          <div className="orbit-hero-n mn-num" data-tone="memory" data-figure="rules">
            {int(v.rules)}
          </div>
          <div className="orbit-hero-t">
            <b>rules in the vault</b>
            <span>
              <span className="mn-num">{learned.length}</span> learned lately
            </span>
            <span>
              <span className="mn-num">{v.byProject.length}</span> {v.byProject.length === 1 ? 'project drew' : 'projects drew'} on it
            </span>
          </div>
        </div>
        <section className="orbit-sec">
          <h3 className="orbit-sec-head">
            <Label>where it went</Label>
            <span className="orbit-sec-note">rules handed over or asked for, by project</span>
          </h3>
          {v.byProject.length ? (
            <div className="orbit-rows">
              {v.byProject.slice(0, 9).map((p) => (
                <div className="orbit-row" key={p.name}>
                  <span className="orbit-row-name">{p.name}</span>
                  <Bar value={p.n} of={widest} />
                  <span className="mn-num orbit-row-v">{int(p.n)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="orbit-none">No session has been handed a rule yet.</p>
          )}
        </section>
        <section className="orbit-sec">
          <h3 className="orbit-sec-head">
            <Label>learned lately</Label> <b className="mn-num">{learned.length}</b>
            <span className="orbit-sec-note">new rules, newest first</span>
          </h3>
          {learned.length ? (
            <div className="orbit-rows" data-tight="true">
              {learned.slice(0, 10).map((l) => (
                <div className="orbit-row" data-plain="true" key={l.slug + l.at}>
                  <span className="mn-num orbit-row-age">{age(l.at, world.at)}</span>
                  <span className="orbit-row-what">
                    <b>{l.name || l.slug}</b>
                    <small className="mn-mono">{l.slug}</small>
                  </span>
                  <span className="orbit-row-s">{l.projects.join(', ')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="orbit-none">Nothing learned lately.</p>
          )}
        </section>
      </div>

      <div className="orbit-v-mid">
        <button type="button" className="orbit-v-close" onClick={onClose}>
          <Kbd>Esc</Kbd> back to the scene
        </button>
      </div>

      <div className="orbit-v-col">
        <h2 className="orbit-v-title">what mnemo did</h2>
        <div className="orbit-hero">
          <div className="orbit-hero-n mn-num" data-tone="memory" data-figure="spoke">
            {int(v.spoke)}
          </div>
          <div className="orbit-hero-t">
            <b>times it spoke</b>
            <span>
              of <span className="mn-num">{int(v.prompts)}</span> prompts it looked at
            </span>
            <span>{v.spokePercent}% of the time</span>
          </div>
          <div className="orbit-hero-n mn-num" data-tone="quiet" data-figure="silent">
            {int(v.silent)}
          </div>
          <div className="orbit-hero-t">
            <b>times it stayed silent</b>
            <span>a rule that does not fit is noise</span>
            <span>
              <span className="mn-num">{v.corrections}</span> {v.corrections === 1 ? 'correction' : 'corrections'} written down as candidates
            </span>
          </div>
        </div>
        <section className="orbit-sec">
          <h3 className="orbit-sec-head">
            <Label>what it did with each prompt</Label>
            <span className="orbit-sec-note">one outcome per prompt</span>
          </h3>
          <div className="orbit-rows">
            {v.outcomes.map((o) => (
              <div className="orbit-row" key={o.key} data-outcome={o.key}>
                <span className="orbit-row-name">{o.words}</span>
                <Bar value={o.n} of={most} memory={o.spoke} />
                <span className="mn-num orbit-row-v">{int(o.n)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="orbit-sec">
          <h3 className="orbit-sec-head">
            <Label>rules it reached for most</Label> <b className="mn-num">{v.handed}</b>
            <span className="orbit-sec-note">handed to the sessions here</span>
          </h3>
          {v.top.length ? (
            <div className="orbit-rows" data-tight="true">
              {v.top.map((u) => {
                const to = sessionOf(world, u.last.session)
                return (
                  <button type="button" className="orbit-row" data-plain="true" data-rule={u.slug} key={u.slug} disabled={!to} onClick={() => to && onOpen(to.id)}>
                    <span className="mn-num orbit-row-age">{u.n}×</span>
                    <span className="mn-mono orbit-slug">{u.slug}</span>
                    <span className="orbit-row-s">
                      {to ? `last to ${to.title.slice(0, 34)} · ` : ''}
                      {age(u.last.at, world.at)}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="orbit-none">No rule was handed to a session here.</p>
          )}
        </section>
      </div>
    </section>
  )
}
