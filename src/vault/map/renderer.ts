import Sigma from 'sigma'
import { NodeCircleProgram } from 'sigma/rendering'
import type { NodeDisplayData, PartialButFor } from 'sigma/types'
import { createNodeBorderProgram } from '@sigma/node-border'
import FA2Layout from 'graphology-layout-forceatlas2/worker'
import { inferSettings } from 'graphology-layout-forceatlas2'
import { Effects } from './live'
import { applyMap, buildGraph, firedIds, mix, needsLayout, positionsOf, slugIndex, type EdgeAttrs, type MapGraph, type NodeAttrs, type Palette } from './model'
import type { Positions, VaultMap } from './types'

/** How long ForceAtlas2 runs on a map with no saved layout, or on "Re-layout". */
export const LAYOUT_MS = 3000
/** Labels show on nodes drawn at least this many pixels wide; hover shows any. */
const LABEL_PX = 9

export type RendererOptions = {
  palette: Palette
  /** A node click: the page (or proposal) at `path`. */
  onSelect(path: string, ghost: boolean): void
  /** After a layout settles, a drag ends, or new nodes are placed: every node's position. */
  onPositions(positions: Positions): void
  /** A layout started (true) or stopped (false). */
  onLayout?(running: boolean): void
}

/** What `MapView` drives; `createRenderer` makes the sigma one, tests a fake. */
export interface Renderer {
  /** Brings the map to `map`: born pages pulse, recoloured ones fade. */
  update(map: VaultMap): void
  /** Flash the nodes these slugs (or names) name. */
  fire(slugs: readonly string[]): void
  select(path: string | null): void
  relayout(): void
  resize(): void
  destroy(): void
}

function drawHover(p: Palette) {
  return (ctx: CanvasRenderingContext2D, data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>, settings: { labelSize: number; labelFont: string }) => {
    if (!data.label) return
    const size = settings.labelSize
    ctx.font = `${size}px ${settings.labelFont}`
    const w = ctx.measureText(data.label).width
    const [x, y, h] = [data.x + data.size + 4, data.y - size / 2 - 4, size + 8]
    ctx.fillStyle = p.bgElev
    ctx.strokeStyle = p.muted
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x - 4, y, w + 12, h, 3)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = p.label
    ctx.fillText(data.label, x + 2, data.y + size / 3)
  }
}

class SigmaRenderer implements Renderer {
  private graph: MapGraph
  private sigma: Sigma<NodeAttrs, EdgeAttrs>
  private effects = new Effects()
  private index: Map<string, string[]>
  private layout: FA2Layout | null = null
  private layoutTimer = 0
  private frame = 0
  private hovered: string | null = null
  private near = new Set<string>()
  private selected: string | null = null
  private dragging: string | null = null
  private dragged = false

  constructor(container: HTMLElement, map: VaultMap, positions: Positions, private opts: RendererOptions) {
    const p = opts.palette
    const built = buildGraph(map, positions, p)
    this.graph = built.graph
    this.index = slugIndex(this.graph)
    this.sigma = new Sigma<NodeAttrs, EdgeAttrs>(this.graph, container, {
      defaultNodeType: 'circle',
      nodeProgramClasses: {
        circle: NodeCircleProgram,
        ghost: createNodeBorderProgram({ borders: [{ size: { value: 0.35 }, color: { attribute: 'color' } }, { size: { fill: true }, color: { value: p.bg } }] }),
      },
      labelColor: { color: p.label },
      labelFont: 'JetBrains Mono, ui-monospace, monospace',
      labelSize: 11,
      labelRenderedSizeThreshold: LABEL_PX,
      labelDensity: 0.5,
      defaultDrawNodeHover: drawHover(p),
      zIndex: true,
      minCameraRatio: 0.03,
      maxCameraRatio: 3,
      hideLabelsOnMove: true,
      nodeReducer: (id, a) => this.nodeLook(id, a),
      edgeReducer: (id, a) => this.edgeLook(id, a),
    })
    this.bind()
    if (needsLayout(this.graph.order, built.missing)) this.relayout()
    else if (built.missing > 0) opts.onPositions(positionsOf(this.graph))
  }

  private nodeLook(id: string, a: NodeAttrs): Partial<NodeDisplayData> {
    const now = performance.now()
    const out: Partial<NodeDisplayData> = { ...a }
    const fx = this.effects.node(id, a, now, this.opts.palette)
    if (fx) Object.assign(out, fx)
    if (this.hovered && !this.near.has(id)) {
      out.color = mix(out.color ?? a.color, this.opts.palette.bg, 0.8)
      out.label = null
      out.zIndex = 0
    }
    if (id === this.selected) Object.assign(out, { highlighted: true, forceLabel: true, zIndex: 3 })
    return out
  }

  private edgeLook(id: string, a: EdgeAttrs): Partial<EdgeAttrs & { hidden: boolean; zIndex: number }> {
    const [s, t] = this.graph.extremities(id)
    if (this.hovered && s !== this.hovered && t !== this.hovered) return { ...a, hidden: true }
    // Hovered: the node's own edges, topic ones brought up to readable.
    if (this.hovered) return { ...a, color: a.kind === 'topic' ? mix(a.color, this.opts.palette.label, 0.45) : a.color, size: a.size + 0.5 }
    const fx = this.effects.edge(s, t, a, performance.now(), this.opts.palette)
    return fx ? { ...a, ...fx } : a
  }

  private bind() {
    const s = this.sigma
    s.on('enterNode', ({ node }) => {
      this.hovered = node
      this.near = new Set([node, ...this.graph.neighbors(node)])
      s.refresh()
    })
    s.on('leaveNode', () => {
      this.hovered = null
      this.near.clear()
      s.refresh()
    })
    s.on('clickNode', ({ node }) => {
      if (this.dragged) return
      this.opts.onSelect(node, this.graph.getNodeAttribute(node, 'ghost'))
    })
    s.on('downNode', ({ node }) => {
      this.dragging = node
      this.dragged = false
      if (!s.getCustomBBox()) s.setCustomBBox(s.getBBox())
    })
    s.getMouseCaptor().on('mousemovebody', (e) => {
      if (!this.dragging) return
      const { x, y } = s.viewportToGraph(e)
      this.graph.mergeNodeAttributes(this.dragging, { x, y })
      this.dragged = true
      e.preventSigmaDefault()
      e.original.preventDefault()
      e.original.stopPropagation()
    })
    const drop = () => {
      if (this.dragging && this.dragged) this.opts.onPositions(positionsOf(this.graph))
      this.dragging = null
      // The click that ends a drag must not select; clear after it has fired.
      setTimeout(() => (this.dragged = false), 0)
    }
    s.getMouseCaptor().on('mouseup', drop)
  }

  /** Runs frames while an effect animates, reprocessing only the nodes and edges it touches. */
  private animate() {
    if (this.frame) return
    const tick = () => {
      // Taken before pruning, so a node whose effect ends this frame is drawn at rest.
      const nodes = this.effects.ids().filter((id) => this.graph.hasNode(id))
      const live = this.effects.active(performance.now())
      // One more full frame after the last effect ends, so nothing is left mid-flash.
      this.sigma.refresh(live ? { partialGraph: { nodes, edges: nodes.flatMap((n) => this.graph.edges(n)) } } : undefined)
      this.frame = live ? requestAnimationFrame(tick) : 0
    }
    this.frame = requestAnimationFrame(tick)
  }

  update(map: VaultMap) {
    const delta = applyMap(this.graph, map, this.opts.palette)
    this.index = slugIndex(this.graph)
    const now = performance.now()
    this.effects.birth(delta.added, now)
    this.effects.recolour(delta.recoloured, now)
    if (this.hovered && !this.graph.hasNode(this.hovered)) this.hovered = null
    if (delta.added.length || delta.removed.length) {
      // New nodes may sit outside the frozen drag box.
      this.sigma.setCustomBBox(null)
      this.opts.onPositions(positionsOf(this.graph))
    }
    this.sigma.refresh()
    this.animate()
  }

  fire(slugs: readonly string[]) {
    const ids = firedIds(this.index, slugs)
    if (!ids.length) return
    this.effects.fire(ids, performance.now())
    this.animate()
  }

  select(path: string | null) {
    const was = this.selected
    this.selected = path && this.graph.hasNode(path) ? path : null
    if (was === this.selected) return
    this.sigma.refresh({ partialGraph: { nodes: [was, this.selected].filter((x): x is string => !!x) } })
    const at = this.selected && this.sigma.getNodeDisplayData(this.selected)
    if (at && !this.dragging) void this.sigma.getCamera().animate({ x: at.x, y: at.y }, { duration: 400 })
  }

  relayout() {
    this.stopLayout(false)
    if (this.graph.order < 2) return
    this.sigma.setCustomBBox(null)
    void this.sigma.getCamera().animatedReset({ duration: 300 })
    // Inferred settings, a little faster: in 3 s on the real vault (2.3k pages) they already pull
    // each repo into its own region. linLog and weak gravity left an unconverged hairball.
    const settings = { ...inferSettings(this.graph), slowDown: 3 }
    this.layout = new FA2Layout(this.graph, { settings, getEdgeWeight: (_e, a) => (a.kind === 'topic' ? 0.3 : 1) })
    this.layout.start()
    this.opts.onLayout?.(true)
    this.layoutTimer = window.setTimeout(() => this.stopLayout(true), LAYOUT_MS)
  }

  private stopLayout(save: boolean) {
    window.clearTimeout(this.layoutTimer)
    if (!this.layout) return
    this.layout.kill()
    this.layout = null
    this.opts.onLayout?.(false)
    if (save) this.opts.onPositions(positionsOf(this.graph))
  }

  resize() {
    this.sigma.resize()
    this.sigma.refresh()
  }

  destroy() {
    this.stopLayout(false)
    cancelAnimationFrame(this.frame)
    this.sigma.kill()
  }
}

export function createRenderer(container: HTMLElement, map: VaultMap, positions: Positions, opts: RendererOptions): Renderer {
  return new SigmaRenderer(container, map, positions, opts)
}
