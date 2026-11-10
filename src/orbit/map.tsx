// The scene, small: "where it stands", at the head of the roster while a session is on
// stage. The same bands, sectors and rays as the whole scene, with `focus`'s family lit; no
// names, and nothing that moves.

import { useMemo } from 'react'
import { Label } from '../ds'
import { drawsSession } from '../menu'
import { WORD } from '../world/format'
import { go, openOnStage } from '../world/route'
import { sessionOf, useWorld } from '../world/store'
import { geom, stageOf } from './layout'
import { BANDS, buildScene } from './model'
import { Glyph } from './scene'
import { keptOrder } from './state'

/** The scene the map is a picture of: the maintainer's window at the frame's middle size. */
const G = geom(1920, 1026, 14)
/** Bodies are drawn larger than in the scene, so they survive the scale. */
const GROW = 3.2
const MARGIN = 30

export function OrbitMap({ focus }: { focus: string | null }) {
  const world = useWorld((w) => w)
  const scene = useMemo(() => buildScene(world, { order: keptOrder(world.source, world.at) }), [world])
  const stage = useMemo(() => stageOf(scene, G), [scene])
  const on = sessionOf(world, focus)
  const lit = scene.bodyOf(on?.id)
  const point = (rho: number, th: number) => `${(G.cx + G.rx * rho * Math.cos(th)).toFixed(1)} ${(G.cy + G.ry * rho * Math.sin(th)).toFixed(1)}`
  return (
    <div className="orbit-map" data-orbit-map data-focus={focus ?? undefined} role="button" aria-label="Where it stands: back to the whole scene" onClick={() => go({ view: 'orbit' })}>
      <Label className="orbit-map-name">where it stands</Label>
      <svg viewBox={`${G.cx - G.rx - MARGIN} ${G.cy - G.ry - MARGIN} ${(G.rx + MARGIN) * 2} ${(G.ry + MARGIN) * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {BANDS.map((b) => (
          <ellipse key={b.id} className="orbit-map-ring" data-band={b.id} cx={G.cx} cy={G.cy} rx={G.rx * b.lo} ry={G.ry * b.lo} />
        ))}
        <ellipse className="orbit-map-ring" data-rim="true" cx={G.cx} cy={G.cy} rx={G.rx} ry={G.ry} />
        {stage.sectors.map((s) => !s.whole && <path key={s.name} className="orbit-map-ring" d={`M${point(BANDS[0].lo, s.a0)}L${point(1, s.a0)}`} />)}
        <g className="orbit-map-core" transform={`translate(${G.cx} ${G.cy})`}>
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2
            const r = i % 2 ? 46 : 64
            return <line key={i} x1={Math.cos(a) * 14} y1={Math.sin(a) * 14} x2={Math.cos(a) * r} y2={Math.sin(a) * r} />
          })}
          <circle r={11} />
        </g>
        {stage.beads.map((b) => (
          <circle key={b.id} className="orbit-map-bead" {...drawsSession(b.id)} cx={b.x} cy={b.y} r={7} data-lit={lit?.id === b.id || undefined} />
        ))}
        {stage.placed.map((p) => {
          const s = p.body.root
          const r = Math.max(15, p.shape.r * GROW * 0.8)
          const isLit = lit?.id === p.id
          const reach = Math.max(r * 1.5, p.shape.rings.length ? p.shape.rings[p.shape.rings.length - 1].r * GROW * 0.62 + 16 : 0)
          return (
            <g
              key={p.id}
              className="orbit-map-body"
              data-map-body={s.id}
              {...drawsSession(s.id)}
              data-state={s.state}
              data-lit={isLit || undefined}
              transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
              onClick={(e) => {
                e.stopPropagation()
                openOnStage(s.id)
              }}
            >
              <title>{`${s.title} · ${WORD[s.state]}`}</title>
              <circle className="orbit-map-hit" r={Math.max(reach, 34)} />
              {isLit && <circle className="orbit-map-halo" r={reach + 14} />}
              <Glyph state={s.state} r={r} />
              {p.shape.rings.flatMap((ring) =>
                ring.moons.map((m) => {
                  const kid = sessionOf(world, m.id)
                  if (!kid) return null
                  const a = (m.angle * Math.PI) / 180
                  const d = ring.r * GROW * 0.62
                  return (
                    <g key={m.id} data-map-moon={kid.id} {...drawsSession(kid.id)} data-state={kid.state} data-lit={on?.id === kid.id || undefined} transform={`translate(${(Math.cos(a) * d).toFixed(1)} ${(Math.sin(a) * d * G.k).toFixed(1)})`}>
                      {on?.id === kid.id && <circle className="orbit-map-halo" r={17} />}
                      <Glyph state={kid.state} r={kid.state === 'ended' ? 5 : 8} />
                    </g>
                  )
                }),
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
