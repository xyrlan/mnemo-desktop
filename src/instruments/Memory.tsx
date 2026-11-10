// Memory: what the session was given, what it asked for, and, first, what mnemo found and
// kept to itself.

import { bytes, DIAL_SWEEP, reason, when, type DialMark, type MemoryReading, type Moment } from './read'
import { Capped, Judge, None, Out, Path, Section, plural, score } from './parts'

const RAD = Math.PI / 180
/** A point on the dial: `angle` degrees clockwise from twelve, `r` from the centre. */
const on = (angle: number, r: number): [number, number] => [Math.cos((angle - 90) * RAD) * r, Math.sin((angle - 90) * RAD) * r]
const f = (n: number) => n.toFixed(2)

/** The session's life as one turn of a clock, start at twelve. Inner ring: the rules mnemo
 *  gave it, larger when the judge scored them higher. Middle: the rules it asked for. Outer:
 *  the prompts where mnemo found candidates and stayed silent. */
function Dial({ dial }: { dial: MemoryReading['dial'] }) {
  const arc = (r: number) => {
    const [x, y] = on(DIAL_SWEEP, r)
    return <path className="instruments-dial-ring" d={`M0 ${-r}A${r} ${r} 0 1 1 ${f(x)} ${f(y)}`} />
  }
  const later = (mk: DialMark) => mk.later || undefined
  return (
    <div className="instruments-dial">
      <svg viewBox="-100 -100 200 200" aria-hidden="true">
        <g className="instruments-dial-ticks">
          {Array.from({ length: 34 }, (_, i) => {
            const [x1, y1] = on(i * 10, i % 3 === 0 ? 91 : 94)
            const [x2, y2] = on(i * 10, 97)
            return <line key={i} x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)} />
          })}
        </g>
        {arc(80)}
        {arc(58)}
        {arc(36)}
        <g className="instruments-dial-core" data-asset="memory-core">
          <circle r={15} className="instruments-dial-c1" />
          <circle r={9.5} className="instruments-dial-c2" />
          <circle r={3} className="instruments-dial-c3" />
        </g>
        {dial.held.map((mk, i) => {
          const [x, y] = on(mk.angle, 80)
          return <circle key={`h${i}`} className="instruments-dial-held" data-later={later(mk)} cx={f(x)} cy={f(y)} r={2.6} />
        })}
        {dial.asked.map((mk, i) => {
          const [x, y] = on(mk.angle, 58)
          return <rect key={`a${i}`} className="instruments-dial-asked" data-later={later(mk)} x={f(x - 2.2)} y={f(y - 2.2)} width={4.4} height={4.4} transform={`rotate(45 ${f(x)} ${f(y)})`} />
        })}
        {dial.given.map((mk, i) => {
          const [x, y] = on(mk.angle, 36)
          const [sx, sy] = on(mk.angle, 15)
          return (
            <g key={`g${i}`} data-later={later(mk)}>
              <line className="instruments-dial-spoke" x1={f(sx)} y1={f(sy)} x2={f(x)} y2={f(y)} />
              <circle className="instruments-dial-given" cx={f(x)} cy={f(y)} r={f(2.2 + (mk.judge ?? 0.5) * 2.4)} />
            </g>
          )
        })}
        <path className="instruments-dial-start" d="M0 -99V-30" />
        {dial.hand != null && (
          <line className="instruments-dial-hand" x1={0} y1={0} x2={f(on(dial.hand, 97)[0])} y2={f(on(dial.hand, 97)[1])} />
        )}
      </svg>
      <span className="instruments-dial-12 mn-label">start</span>
    </div>
  )
}

export function MemoryBody({ r, m }: { r: MemoryReading; m: Moment }) {
  const loaded = r.instructions.length + r.briefings.length
  const touched = r.touches.length + r.skills.length
  const lacks = [
    r.given.length ? '' : 'no rule given',
    r.asked.length ? '' : 'none asked for',
    loaded ? '' : 'no instruction file or briefing recorded at its start',
    touched ? '' : "Claude Code's own memory untouched",
  ].filter(Boolean)
  return (
    <>
      <div className="instruments-mem-top">
        <Dial dial={r.dial} />
        <div className="instruments-legend">
          <div className="instruments-lg" data-k="given">
            <i />
            <b className="mn-num">{r.givenCount}</b>
            <span>given by mnemo</span>
          </div>
          <div className="instruments-lg" data-k="asked">
            <i />
            <b className="mn-num">{r.askedCount}</b>
            <span>asked for</span>
          </div>
          <div className="instruments-lg" data-k="held">
            <i />
            <b className="mn-num">{r.heldCount}</b>
            <span>held back</span>
          </div>
          <div className="instruments-lg" data-k="prompts">
            <b className="mn-num">{r.prompts.toLocaleString('en-US')}</b>
            <span>{plural(r.prompts, 'prompt')} mnemo read</span>
          </div>
        </div>
      </div>

      <Section title="Held back" count={r.heldCount} note="candidates mnemo found and kept to itself, and why">
        {r.held.length ? (
          <>
            <div className="instruments-reasons">
              {r.reasons.map((x) => (
                <span key={x.code}>
                  <b className="mn-num">{x.count}</b> {x.words}
                </span>
              ))}
            </div>
            <Capped items={r.held} cap={12} what="earlier">
              {(h) => (
                <div key={h.at + h.reason} className="instruments-held" data-later={h.later || undefined}>
                  <div className="instruments-held-h">
                    <span className="instruments-held-r">{reason(h.reason)}</span>
                    <span className="instruments-when mn-num">{when(h.at, m)}</span>
                  </div>
                  {h.candidates.map((k) => (
                    <div key={k.slug} className="instruments-cand">
                      <span className="instruments-slug mn-mono">{k.name ?? k.slug}</span>
                      <span className="instruments-score mn-num">{score(k.score)}</span>
                      <Judge value={k.judge} />
                    </div>
                  ))}
                </div>
              )}
            </Capped>
          </>
        ) : (
          <None>Nothing held back: mnemo found no candidate it kept to itself.</None>
        )}
      </Section>

      {r.given.length > 0 && (
        <Section title="Given" count={r.givenCount} note="retrieval score · judge">
          {r.given.map((k) => (
            <div key={k.at + k.slug} className="instruments-cand" data-kind="given" data-later={k.later || undefined}>
              <i className="instruments-mk" data-k="given" />
              <span className="instruments-slug mn-mono">{k.name ?? k.slug}</span>
              <span className="instruments-score mn-num">{score(k.score)}</span>
              <Judge value={k.judge} tone="memory" />
              <span className="instruments-when mn-num">{when(k.at, m)}</span>
            </div>
          ))}
        </Section>
      )}

      {r.asked.length > 0 && (
        <Section title="Asked for" count={r.askedCount}>
          {r.asked.map((k) => (
            <div key={k.at + k.what} className="instruments-cand" data-kind="asked" data-later={k.later || undefined}>
              <i className="instruments-mk" data-k="asked" />
              <span className="instruments-slug mn-mono">{k.what}</span>
              <span className="instruments-cand-q">
                {k.tool.replace(/_/g, ' ')}
                {k.slug ? '' : ` · ${k.hits.length} ${plural(k.hits.length, 'hit')}`}
              </span>
              <span className="instruments-when mn-num">{when(k.at, m)}</span>
            </div>
          ))}
        </Section>
      )}

      {loaded > 0 && (
        <Section title="Loaded at the start" count={loaded}>
          {r.instructions.map((x) => (
            <div key={x.path} className="instruments-file" data-later={x.later || undefined}>
              <span className="instruments-file-k">{x.kind}</span>
              <Out to={x.path} className="instruments-file-p">
                <Path path={x.path} />
              </Out>
              <span className="instruments-when mn-num">{bytes(x.bytes)}</span>
            </div>
          ))}
          {r.briefings.map((b) => (
            <div key={b.path} className="instruments-file" data-later={b.later || undefined}>
              <span className="instruments-file-k">briefing</span>
              <span className="instruments-file-p">
                {b.project} <span className="instruments-q">{b.date ?? ''}</span>
              </span>
              <span className="instruments-when mn-num">{b.entries != null ? `${b.entries} ${plural(b.entries, 'entry', 'entries')}` : (b.source ?? '')}</span>
            </div>
          ))}
        </Section>
      )}

      {touched > 0 && (
        <Section title="Claude Code's memory since" count={touched}>
          <Capped items={r.touches} cap={14} what="earlier">
            {(x) => (
              <div key={x.at + x.path} className="instruments-file" data-later={x.later || undefined}>
                <span className="instruments-file-k" data-op={x.op}>
                  {x.op}
                </span>
                <Out to={x.path} className="instruments-file-p">
                  <Path path={x.path} />
                </Out>
                <span className="instruments-when mn-num">{when(x.at, m)}</span>
              </div>
            )}
          </Capped>
          {r.skills.map((k) => (
            <div key={k.at + k.name} className="instruments-file" data-later={k.later || undefined}>
              <span className="instruments-file-k">skill</span>
              <span className="instruments-file-p mn-mono">{k.name}</span>
              <span className="instruments-when mn-num">{when(k.at, m)}</span>
            </div>
          ))}
        </Section>
      )}

      {r.corrections.length > 0 && (
        <Section title="Corrections mnemo wrote down" count={r.corrections.filter((x) => !x.later).length}>
          {r.corrections.map((x) => (
            <div key={x.at + x.rule} className="instruments-fr" data-later={x.later || undefined}>
              <q>{x.quote}</q>
              <span className="instruments-fr-r">{x.rule}</span>
            </div>
          ))}
        </Section>
      )}

      {lacks.length > 0 && <p className="instruments-note instruments-lacks">Also: {lacks.join(', ')}.</p>}
      <p className="instruments-note instruments-vault">
        The vault holds <b className="mn-num">{r.vault.rules == null ? '–' : r.vault.rules.toLocaleString('en-US')}</b> rules. Across every session mnemo read{' '}
        <b className="mn-num">{r.vault.prompts.toLocaleString('en-US')}</b> prompts, spoke on <b className="mn-num">{r.vault.spoke.toLocaleString('en-US')}</b> and stayed silent on{' '}
        <b className="mn-num">{r.vault.silent.toLocaleString('en-US')}</b>.
      </p>
    </>
  )
}
