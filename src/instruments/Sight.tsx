// Sight: what the session is seeing and making. Pages with the screenshots it took itself,
// searches and their sources, fetched documents, artifacts, pull requests, files.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { actions, type Actions } from '../world/actions'
import { Capped, Out, Path, Section } from './parts'
import { bare, bytes, host, took, when, type Moment, type SightReading } from './read'

type Shot = SightReading['shots'][number]

// A picture is asked for once per session and shot, for as long as the same actions are in
// force: a redraw, or the same shot shown large, never asks the core again.
const asked = new WeakMap<Actions, Map<string, Promise<string | null>>>()

function shotUrl(sessionId: string, shotId: string): Promise<string | null> {
  const acting = actions()
  let mine = asked.get(acting)
  if (!mine) asked.set(acting, (mine = new Map()))
  const key = `${sessionId}\n${shotId}`
  let url = mine.get(key)
  if (!url) {
    url = acting.shot(sessionId, shotId).catch(() => null)
    mine.set(key, url)
  }
  return url
}

/** The picture of a shot: undefined while it is asked for, null when it is gone. */
function useShot(sessionId: string, shotId: string): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void shotUrl(sessionId, shotId).then((url) => live && setSrc(url))
    return () => {
      live = false
    }
  }, [sessionId, shotId])
  return src
}

function Picture({ sessionId, shot }: { sessionId: string; shot: Shot }) {
  const src = useShot(sessionId, shot.id)
  if (src === undefined) return <span className="instruments-shot-wait" />
  if (src === null) return <span className="instruments-shot-gone">the picture is gone</span>
  return <img src={src} alt={shot.title ?? shot.url ?? 'screenshot'} decoding="async" />
}

/** One screenshot, large, over the window: arrows walk the session's shots, Esc leaves. */
function Light({ sessionId, shots, index, m, mount, onStep, onClose }: { sessionId: string; shots: Shot[]; index: number; m: Moment; mount: Element; onStep: (step: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const shot = shots[index]
  return createPortal(
    <div
      ref={ref}
      className="instruments-veil"
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot"
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (e.key !== 'Escape' && !step) return
        // These keys are the picture's while it is open: the fleet does not walk under it.
        e.preventDefault()
        e.stopPropagation()
        if (step) onStep(step)
        else onClose()
      }}
    >
      <figure className="instruments-light" onClick={(e) => e.stopPropagation()}>
        <div className="instruments-light-f">
          <Picture key={shot.id} sessionId={sessionId} shot={shot} />
        </div>
        <figcaption>
          <b>{shot.title ?? ''}</b>
          <span className="mn-mono">{shot.url ?? ''}</span>
          <span className="instruments-light-n mn-num">
            {index + 1} of {shots.length} · {when(shot.at, m)}
          </span>
        </figcaption>
      </figure>
    </div>,
    mount,
  )
}

export function SightBody({ r, m, sessionId }: { r: SightReading; m: Moment; sessionId: string }) {
  const [light, setLight] = useState<{ index: number; mount: Element; from: HTMLElement } | null>(null)
  const close = () => {
    light?.from.focus()
    setLight(null)
  }
  const onWeb = r.shots.length + r.pages.length + r.searches.length + r.fetches.length + r.artifacts.length
  const lacks = [onWeb ? '' : 'no page, search, fetch or artifact', r.prs.length ? '' : 'no pull request', r.edited.length ? '' : 'no file edited', r.read.length ? '' : 'no file read'].filter(Boolean)
  return (
    <>
      {onWeb > 0 && (
        <Section title="On the web" count={r.webCount} note={r.shots.length ? 'the screenshots are the ones it took' : undefined}>
          {r.shots.length > 0 && (
            <div className="instruments-shots">
              {r.shots.map((x, i) => (
                <button
                  key={x.id}
                  type="button"
                  className="instruments-shot"
                  data-shot={x.id}
                  data-later={x.later || undefined}
                  onClick={(e) => setLight({ index: i, mount: e.currentTarget.closest('.mn') ?? document.body, from: e.currentTarget })}
                >
                  <span className="instruments-shot-f">
                    <Picture sessionId={sessionId} shot={x} />
                  </span>
                  <span className="instruments-shot-t">{x.title || host(x.url ?? '')}</span>
                  <span className="instruments-shot-u mn-mono">{bare(x.url)}</span>
                  <span className="instruments-when mn-num">{when(x.at, m)}</span>
                </button>
              ))}
            </div>
          )}
          <Capped items={r.pages} cap={8} what="earlier pages">
            {(p) => (
              <div key={p.at + p.url} className="instruments-file" data-later={p.later || undefined}>
                <span className="instruments-file-k">page</span>
                <Out to={p.url} className="instruments-file-p">
                  {p.title} <span className="instruments-q mn-mono">{bare(p.url)}</span>
                </Out>
                <span className="instruments-when mn-num">{when(p.at, m)}</span>
              </div>
            )}
          </Capped>
          {r.searches.map((q) => (
            <div key={q.at + q.query} className="instruments-search" data-later={q.later || undefined}>
              <div className="instruments-file">
                <span className="instruments-file-k">search</span>
                <span className="instruments-file-p instruments-search-q">{q.query}</span>
                <span className="instruments-when mn-num">{when(q.at, m)}</span>
              </div>
              <Capped items={q.results} cap={4} what="more sources">
                {(s) => (
                  <Out key={s.url} to={s.url} className="instruments-src">
                    <span>{s.title}</span>
                    <span className="instruments-q mn-mono">{host(s.url)}</span>
                  </Out>
                )}
              </Capped>
            </div>
          ))}
          {r.fetches.map((x) => (
            <div key={x.at + x.url} className="instruments-fetch" data-later={x.later || undefined}>
              <div className="instruments-file">
                <span className="instruments-file-k" data-op={x.code != null && x.code >= 400 ? 'fail' : undefined}>
                  {x.code ?? 'fetch'}
                </span>
                <Out to={x.url} className="instruments-file-p">
                  <span className="mn-mono">{bare(x.url)}</span>
                </Out>
                <span className="instruments-when mn-num">{[bytes(x.bytes), took(x.ms)].filter(Boolean).join(' · ')}</span>
              </div>
              {x.summary && <p className="instruments-fetch-s">{x.summary}</p>}
            </div>
          ))}
          {r.artifacts.map((a) => (
            <div key={a.at + a.url} className="instruments-file" data-later={a.later || undefined}>
              <span className="instruments-file-k">artifact</span>
              <Out to={a.url} className="instruments-file-p">
                {a.title || bare(a.url)}
              </Out>
              <span className="instruments-when mn-num">{when(a.at, m)}</span>
            </div>
          ))}
        </Section>
      )}

      {r.prs.length > 0 && (
        <Section title="Pull requests" count={r.prCount}>
          {r.prs.map((p) => (
            <Out key={p.url} to={p.url} className="instruments-pr" label={`Pull request ${p.number}${p.title ? `: ${p.title}` : ''}`}>
              <span className="instruments-pr-n mn-mono" data-later={p.later || undefined}>
                #{p.number}
              </span>
              <span className="instruments-pr-t" data-later={p.later || undefined}>
                {p.title ?? p.repo}
              </span>
              <span className="instruments-pr-s">
                {[p.state, p.draft ? 'draft' : ''].filter(Boolean).join(' · ')}
              </span>
              <span className="instruments-ci" data-ci={p.ci ?? 'none'}>
                {p.ci ? `checks ${p.ci}` : 'no checks'}
              </span>
            </Out>
          ))}
        </Section>
      )}

      {r.edited.length > 0 && (
        <Section title="Files edited" count={r.editedCount}>
          <Capped items={r.edited} cap={12}>
            {(x) => (
              <div key={x.path} className="instruments-file" data-later={x.later || undefined}>
                <span className="instruments-file-k" data-op="edit">
                  {x.edits}×
                </span>
                <Out to={x.path} className="instruments-file-p">
                  <Path path={x.path} />
                </Out>
                <span className="instruments-when mn-num">{when(x.lastAt, m)}</span>
              </div>
            )}
          </Capped>
        </Section>
      )}

      {r.read.length > 0 && (
        <Section title="Files read" count={r.read.length}>
          <Capped items={r.read} cap={10}>
            {(x) => (
              <div key={x.path} className="instruments-file">
                <span className="instruments-file-k">{x.count}×</span>
                <Out to={x.path} className="instruments-file-p">
                  <Path path={x.path} />
                </Out>
              </div>
            )}
          </Capped>
        </Section>
      )}

      {lacks.length > 0 && (
        <p className="instruments-note instruments-lacks">
          {lacks.length === 4 ? 'This session has looked at nothing yet: ' : 'Also: '}
          {lacks.join(', ')}.
        </p>
      )}

      {light && r.shots[light.index] && (
        <Light
          sessionId={sessionId}
          shots={r.shots}
          index={light.index}
          m={m}
          mount={light.mount}
          onStep={(step) => setLight({ ...light, index: (light.index + step + r.shots.length) % r.shots.length })}
          onClose={close}
        />
      )}
    </>
  )
}
