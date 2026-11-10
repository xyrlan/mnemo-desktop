// Rasterizes src/brand/icon.svg into app-icon.png (1024x1024, on a black tile
// with rounded corners and a faint edge, so it stands off a dark taskbar),
// used by `pnpm icons` as the source for `tauri icon`. The art itself is
// untouched; this only crops+centers it so it fills the icon's safe area
// instead of sitting small in the middle of its own canvas (the art's viewBox
// may carry margin that app icons don't need).
//
// The icon is the crystal as the new front draws it. src/brand/mark.svg, the
// pixel-art crystal, is still what the classic interface's bar shows.
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'

const SIZE = 1024
const SAFE_AREA = 0.74
const CONTENT_PADDING = 1.04 // small breathing room around the art's own bbox
const GROUND = '#000000'
const CORNER = 0.22 // the tile's corner radius, as a part of its side

const svg = readFileSync('src/brand/icon.svg', 'utf8')
const [, attrs, inner] = svg.match(/<svg([^>]*)>([\s\S]*)<\/svg>/)
// What the art's root sets for everything inside it (fill, stroke, joins) goes with it.
const paint = [...attrs.matchAll(/\s((?:fill|stroke)[\w-]*="[^"]*")/g)].map((m) => m[1]).join(' ')

const bbox = new Resvg(svg).innerBBox()
const cx = bbox.x + bbox.width / 2
const cy = bbox.y + bbox.height / 2
const contentSide = Math.max(bbox.width, bbox.height) * CONTENT_PADDING
const frameSide = contentSide / SAFE_AREA
const half = frameSide / 2
const viewBox = `${cx - half} ${cy - half} ${frameSide} ${frameSide}`

// The tile: the whole square, its corners rounded, with a hairline just inside its edge.
const x = cx - half
const y = cy - half
const edge = frameSide / SIZE
const tile =
  `<rect x="${x}" y="${y}" width="${frameSide}" height="${frameSide}" rx="${frameSide * CORNER}" fill="${GROUND}" stroke="none"/>` +
  `<rect x="${x + 4 * edge}" y="${y + 4 * edge}" width="${frameSide - 8 * edge}" height="${frameSide - 8 * edge}" rx="${frameSide * CORNER - 4 * edge}" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="${8 * edge}"/>`

const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${tile}<g ${paint}>${inner}</g></svg>`

const png = new Resvg(wrapped, { fitTo: { mode: 'width', value: SIZE } }).render().asPng()

writeFileSync('app-icon.png', png)
console.log(`app-icon.png written (${SIZE}x${SIZE})`)
