// Rasterizes src/brand/mark.svg into app-icon.png (1024x1024, #0f1116 ground),
// used by `pnpm icons` as the source for `tauri icon`. The 2048 viewBox art
// itself is untouched; this only crops+centers it so it fills the icon's
// safe area instead of sitting tiny in the middle of the 2048 canvas (the
// mark's own viewBox has a lot of empty margin baked in for the wordmark
// layout, which app icons don't need).
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'

const SIZE = 1024
const SAFE_AREA = 0.82
const CONTENT_PADDING = 1.04 // small breathing room around the octopus's own bbox

const svg = readFileSync('src/brand/mark.svg', 'utf8')
const inner = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1]

const bbox = new Resvg(svg).innerBBox()
const cx = bbox.x + bbox.width / 2
const cy = bbox.y + bbox.height / 2
const contentSide = Math.max(bbox.width, bbox.height) * CONTENT_PADDING
const frameSide = contentSide / SAFE_AREA
const half = frameSide / 2
const viewBox = `${cx - half} ${cy - half} ${frameSide} ${frameSide}`

const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`

const png = new Resvg(wrapped, {
  fitTo: { mode: 'width', value: SIZE },
  background: '#0f1116',
}).render().asPng()

writeFileSync('app-icon.png', png)
console.log(`app-icon.png written (${SIZE}x${SIZE})`)
