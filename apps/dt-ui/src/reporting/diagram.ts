import { escapeHtml } from './escape'

/**
 * A model's data-flow diagram as a standalone SVG, drawn from the graph a report snapshotted when it was generated:
 * boundaries with their position, size and parent, components with theirs, and flows between components. Pure: it never
 * fetches, so a report draws the model as it was when the report was made.
 */

export interface ModelGraphBoundary {
  id: string
  name?: string | null
  positionX?: number | null
  positionY?: number | null
  width?: number | null
  height?: number | null
  parentBoundaryId?: string | null
}

export interface ModelGraphComponent {
  id: string
  name?: string | null
  /** 'process', 'store' or 'external_entity'; anything else draws as a generic node. */
  type?: string | null
  positionX?: number | null
  positionY?: number | null
  width?: number | null
  height?: number | null
  boundaryId?: string | null
}

export interface ModelGraphFlow {
  id?: string
  sourceId?: string | null
  targetId?: string | null
}

export interface ModelGraph {
  boundaries?: ModelGraphBoundary[]
  components?: ModelGraphComponent[]
  flows?: ModelGraphFlow[]
}

export interface DiagramOptions {
  /** The caption, from the caller's own strings (for example "Layout as of <generatedAt>"); the renderer has no text. */
  caption?: string
  /** Components and boundaries outlined in the accent colour. */
  highlightIds?: string[]
  highlightBoundaryIds?: string[]
  /** Components marked with a star. */
  crownJewelIds?: string[]
  /** Components marked with an arrow. */
  entryPointIds?: string[]
}

export interface DiagramResult {
  /** A standalone <svg> with a viewBox, `width="100%"` and no fixed height. */
  svg: string
  /**
   * The drawing as print-ready markup: the svg in a <figure>, with the caption when one was given. A drawing taller than
   * a printed page holds at three quarters of its print size is cut into several figures, one below the other, at the
   * gaps between its boundaries (sliceBounds), each sized to print whole on a page and never enlarged; the caption goes
   * under the last.
   */
  figure: string
  /** The drawing's size, in canvas units. */
  width: number
  height: number
}

/**
 * The canvas size of a component node by type, in canvas pixels, from the editor's node styles. A component's stored
 * size is normally empty (the editor does not write it), so these stand in.
 */
export const NODE_SIZES: Record<string, { w: number; h: number }> = {
  process: { w: 80, h: 80 },
  store: { w: 100, h: 50 },
  external_entity: { w: 80, h: 80 },
}
const DEFAULT_NODE = { w: 80, h: 80 }
/** An empty boundary without a stored size: the editor's boundary node. */
const DEFAULT_BOUNDARY = { w: 90, h: 80 }
const BOUNDARY_PAD = 24
const VIEW_PAD = 24
const NODE_LABEL_MAX = 28
const BOUNDARY_LABEL_MAX = 40
const NODE_LABEL_GAP = 16
const FONT = 12

// Print-safe literal colours: outlines and light fills, no meaning carried by a background alone.
const INK = '#222222'
const BOUNDARY_STROKE = '#666666'
const NODE_FILL = '#f4f4f4'
const FLOW_STROKE = '#555555'
const ACCENT = '#1565c0'

let drawings = 0

type Box = { x: number; y: number; w: number; h: number }

/** A coordinate or size: a missing one is absent; one that is present but not a finite number poisons the graph. */
function num(value: unknown): number | null | 'bad' {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : 'bad'
}

/** Cut on code points before escaping, so a cut never splits a character or an entity. */
function label(name: unknown, max: number): string {
  const chars = [...String(name ?? '')]
  const cut = chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
  return escapeHtml(cut)
}

const f = (n: number) => String(Math.round(n * 10) / 10)

/** Where a line from a shape's centre in direction (dx, dy) leaves the shape. */
function edgePoint(box: Box, round: boolean, dx: number, dy: number): { x: number; y: number } {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const len = Math.hypot(dx, dy) || 1
  if (round) {
    const r = Math.min(box.w, box.h) / 2
    return { x: cx + (dx / len) * r, y: cy + (dy / len) * r }
  }
  const sx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

/** The diagram, or null for an empty graph or one with a coordinate that is not a finite number. */
export function renderModelDiagram(graph: ModelGraph | null | undefined, opts: DiagramOptions = {}): DiagramResult | null {
  if (!graph || typeof graph !== 'object') return null
  const boundaries = Array.isArray(graph.boundaries) ? graph.boundaries.filter((b) => b && typeof b.id === 'string') : []
  const components = Array.isArray(graph.components) ? graph.components.filter((c) => c && typeof c.id === 'string') : []
  const flows = Array.isArray(graph.flows) ? graph.flows.filter(Boolean) : []

  const numbers = new Map<object, Record<string, number | null>>()
  for (const item of [...boundaries, ...components]) {
    const values: Record<string, number | null> = {}
    for (const key of ['positionX', 'positionY', 'width', 'height'] as const) {
      const n = num((item as unknown as Record<string, unknown>)[key])
      if (n === 'bad') return null
      values[key] = n
    }
    numbers.set(item, values)
  }
  const v = (item: object, key: string) => numbers.get(item)?.[key] ?? null

  const boundaryById = new Map(boundaries.map((b) => [b.id, b]))
  // The default boundary (no parent) is not a canvas node: its children sit at the top level.
  const roots = new Set(boundaries.filter((b) => !b.parentBoundaryId).map((b) => b.id))
  const drawn = boundaries.filter((b) => !roots.has(b.id))

  const childBoundaries = new Map<string, ModelGraphBoundary[]>()
  for (const b of drawn) {
    const list = childBoundaries.get(b.parentBoundaryId!) ?? []
    list.push(b)
    childBoundaries.set(b.parentBoundaryId!, list)
  }
  const childComponents = new Map<string, ModelGraphComponent[]>()
  for (const c of components) {
    if (!c.boundaryId) continue
    const list = childComponents.get(c.boundaryId) ?? []
    list.push(c)
    childComponents.set(c.boundaryId, list)
  }

  const nodeSize = (c: ModelGraphComponent) => {
    const w = v(c, 'width')
    const h = v(c, 'height')
    if (w && h && w > 0 && h > 0) return { w, h }
    // Own keys only: a type such as "constructor" must not find a member of the object's prototype.
    const type = String(c.type ?? '').toLowerCase()
    return Object.hasOwn(NODE_SIZES, type) ? NODE_SIZES[type] : DEFAULT_NODE
  }

  // A boundary's box relative to its own top-left: its stored size, or the extent of its children with padding (so a
  // child at a negative position stays inside).
  const relBox = new Map<string, Box>()
  const visiting = new Set<string>()
  const boxOf = (b: ModelGraphBoundary): Box => {
    const known = relBox.get(b.id)
    if (known) return known
    const w = v(b, 'width')
    const h = v(b, 'height')
    let box: Box
    if (w && h && w > 0 && h > 0) {
      box = { x: 0, y: 0, w, h }
    } else if (visiting.has(b.id)) {
      box = { x: 0, y: 0, ...DEFAULT_BOUNDARY }
    } else {
      visiting.add(b.id)
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const cb of childBoundaries.get(b.id) ?? []) {
        const inner = boxOf(cb)
        const x = (v(cb, 'positionX') ?? 0) + inner.x
        const y = (v(cb, 'positionY') ?? 0) + inner.y
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + inner.w)
        maxY = Math.max(maxY, y + inner.h)
      }
      for (const cc of childComponents.get(b.id) ?? []) {
        const size = nodeSize(cc)
        const x = v(cc, 'positionX') ?? 0
        const y = v(cc, 'positionY') ?? 0
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + size.w)
        maxY = Math.max(maxY, y + size.h + NODE_LABEL_GAP + FONT)
      }
      visiting.delete(b.id)
      box = Number.isFinite(minX)
        ? {
            x: Math.min(0, minX - BOUNDARY_PAD),
            y: Math.min(0, minY - BOUNDARY_PAD - FONT),
            w: maxX + BOUNDARY_PAD - Math.min(0, minX - BOUNDARY_PAD),
            h: maxY + BOUNDARY_PAD - Math.min(0, minY - BOUNDARY_PAD - FONT),
          }
        : { x: 0, y: 0, ...DEFAULT_BOUNDARY }
    }
    relBox.set(b.id, box)
    return box
  }

  // A boundary's absolute top-left: its position plus its parents', the default boundary counting as the origin.
  const origin = new Map<string, { x: number; y: number }>()
  const originOf = (id: string | null | undefined, seen = new Set<string>()): { x: number; y: number } => {
    if (!id || roots.has(id)) return { x: 0, y: 0 }
    const cached = origin.get(id)
    if (cached) return cached
    const b = boundaryById.get(id)
    if (!b || seen.has(id)) return { x: 0, y: 0 }
    seen.add(id)
    const parent = originOf(b.parentBoundaryId, seen)
    const o = { x: parent.x + (v(b, 'positionX') ?? 0), y: parent.y + (v(b, 'positionY') ?? 0) }
    origin.set(id, o)
    return o
  }
  const depthOf = (b: ModelGraphBoundary, seen = new Set<string>()): number => {
    if (!b.parentBoundaryId || roots.has(b.parentBoundaryId) || seen.has(b.id)) return 0
    seen.add(b.id)
    const parent = boundaryById.get(b.parentBoundaryId)
    return parent ? depthOf(parent, seen) + 1 : 0
  }

  const boundaryBoxes = drawn
    .map((b) => {
      const o = originOf(b.id)
      const rel = boxOf(b)
      return { b, box: { x: o.x + rel.x, y: o.y + rel.y, w: rel.w, h: rel.h }, depth: depthOf(b) }
    })
    .sort((a, b) => a.depth - b.depth)

  const nodeBoxes = components.map((c) => {
    const o = originOf(c.boundaryId)
    const size = nodeSize(c)
    const type = String(c.type ?? '').toLowerCase()
    return { c, type, box: { x: o.x + (v(c, 'positionX') ?? 0), y: o.y + (v(c, 'positionY') ?? 0), ...size } }
  })
  if (boundaryBoxes.length === 0 && nodeBoxes.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const extend = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  // A label's width, estimated: about 0.6 of the font size per character (wide glyphs included).
  const labelWidth = (name: unknown, max: number) => Math.min([...String(name ?? '')].length, max) * FONT * 0.6
  for (const { b, box } of boundaryBoxes) {
    extend(box.x, box.y, box.w, box.h)
    extend(box.x + 8, box.y, labelWidth(b.name, BOUNDARY_LABEL_MAX), FONT + 6)
  }
  for (const { c, box } of nodeBoxes) {
    extend(box.x, box.y, box.w, box.h + NODE_LABEL_GAP + FONT)
    // A label wider than its node.
    const width = labelWidth(c.name, NODE_LABEL_MAX)
    extend(box.x + box.w / 2 - width / 2, box.y, width, box.h)
  }
  minX -= VIEW_PAD
  minY -= VIEW_PAD
  maxX += VIEW_PAD
  maxY += VIEW_PAD
  const width = maxX - minX
  const height = maxY - minY

  const n = ++drawings
  const root = `rk-dg-${n}`
  const arrow = `${root}-arrow`
  const highlight = new Set(opts.highlightIds ?? [])
  const highlightBoundary = new Set(opts.highlightBoundaryIds ?? [])
  const jewels = new Set(opts.crownJewelIds ?? [])
  const entries = new Set(opts.entryPointIds ?? [])

  const parts: string[] = []
  parts.push(
    `<style>` +
      `.${root} .b{fill:none;stroke:${BOUNDARY_STROKE};stroke-width:1.5;stroke-dasharray:6 4}` +
      `.${root} .b.hl{stroke:${ACCENT};stroke-width:3;stroke-dasharray:none}` +
      `.${root} .bl{fill:${INK};font:600 ${FONT}px sans-serif}` +
      `.${root} .n{fill:${NODE_FILL};stroke:${INK};stroke-width:1.5}` +
      `.${root} .n.hl{stroke:${ACCENT};stroke-width:3.5}` +
      `.${root} .nf{fill:${NODE_FILL};stroke:none}` +
      `.${root} .s{stroke:${INK};stroke-width:2}` +
      `.${root} .s.hl{stroke:${ACCENT};stroke-width:3.5}` +
      `.${root} .nl{fill:${INK};font:${FONT}px sans-serif;text-anchor:middle}` +
      `.${root} .f{fill:none;stroke:${FLOW_STROKE};stroke-width:1.5}` +
      `.${root} .ah{fill:${FLOW_STROKE}}` +
      `.${root} .mk{fill:${ACCENT};font:bold 16px sans-serif;text-anchor:middle}` +
      `</style>`,
  )
  parts.push(
    `<defs><marker id="${MARKER_ID}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" ` +
      `orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`,
  )

  for (const { b, box } of boundaryBoxes) {
    const cls = highlightBoundary.has(b.id) ? 'b hl' : 'b'
    parts.push(`<rect class="${cls}" x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}" rx="6"/>`)
    parts.push(`<text class="bl" x="${f(box.x + 8)}" y="${f(box.y + FONT + 6)}">${label(b.name, BOUNDARY_LABEL_MAX)}</text>`)
  }

  const nodeById = new Map(nodeBoxes.map((node) => [node.c.id, node]))
  for (const flow of flows) {
    const src = flow.sourceId ? nodeById.get(flow.sourceId) : undefined
    const dst = flow.targetId ? nodeById.get(flow.targetId) : undefined
    if (!src || !dst || src === dst) continue
    const dx = dst.box.x + dst.box.w / 2 - (src.box.x + src.box.w / 2)
    const dy = dst.box.y + dst.box.h / 2 - (src.box.y + src.box.h / 2)
    if (dx === 0 && dy === 0) continue
    const a = edgePoint(src.box, src.type === 'process', dx, dy)
    const z = edgePoint(dst.box, dst.type === 'process', -dx, -dy)
    parts.push(`<line class="f" x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(z.x)}" y2="${f(z.y)}" marker-end="url(#${MARKER_ID})"/>`)
  }

  for (const { c, type, box } of nodeBoxes) {
    const hl = highlight.has(c.id) ? ' hl' : ''
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    if (type === 'process') {
      parts.push(`<circle class="n${hl}" cx="${f(cx)}" cy="${f(cy)}" r="${f(Math.min(box.w, box.h) / 2)}"/>`)
    } else if (type === 'store') {
      parts.push(`<rect class="nf" x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}"/>`)
      parts.push(`<line class="s${hl}" x1="${f(box.x)}" y1="${f(box.y)}" x2="${f(box.x + box.w)}" y2="${f(box.y)}"/>`)
      parts.push(
        `<line class="s${hl}" x1="${f(box.x)}" y1="${f(box.y + box.h)}" x2="${f(box.x + box.w)}" y2="${f(box.y + box.h)}"/>`,
      )
    } else if (type === 'external_entity') {
      parts.push(`<rect class="n${hl}" x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}"/>`)
    } else {
      parts.push(`<rect class="n${hl}" x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}" rx="10"/>`)
    }
    if (jewels.has(c.id)) parts.push(`<text class="mk" x="${f(box.x + box.w)}" y="${f(box.y + 4)}">★</text>`)
    if (entries.has(c.id)) parts.push(`<text class="mk" x="${f(box.x - 10)}" y="${f(cy + 6)}">➜</text>`)
    parts.push(`<text class="nl" x="${f(cx)}" y="${f(box.y + box.h + NODE_LABEL_GAP)}">${label(c.name, NODE_LABEL_MAX)}</text>`)
  }

  const caption = typeof opts.caption === 'string' && opts.caption !== '' ? escapeHtml(opts.caption) : ''
  const body = parts.join('')
  const svgOf = (y: number, h: number, marker: string, size: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" class="rk-diagram ${root}" viewBox="${f(minX)} ${f(y)} ${f(width)} ` +
    `${f(h)}" width="${size}" preserveAspectRatio="xMidYMid meet" role="img"` +
    `${caption ? ` aria-label="${caption}"` : ''}>${body.split(MARKER_ID).join(marker)}</svg>`
  const svg = svgOf(minY, height, arrow, '100%')
  const captionHtml = caption ? `<figcaption class="rk-figcaption">${caption}</figcaption>` : ''

  // A node spans its marks above it (a crown jewel's star) to its label below. A boundary is a gap's obstacle twice
  // over: its whole box first, and failing a gap outside every box, only its label band and its bottom edge, so a cut
  // may run between the nodes inside it, across its side lines only.
  const nodeSpans = nodeBoxes.map(({ box }) => ({ top: box.y - FONT, bottom: box.y + box.h + NODE_LABEL_GAP + FONT }))
  const solid = [...boundaryBoxes.map(({ box }) => ({ top: box.y, bottom: box.y + box.h })), ...nodeSpans]
  const inner = [
    ...boundaryBoxes.flatMap(({ box }) => [
      { top: box.y, bottom: box.y + FONT + 10 },
      { top: box.y + box.h - 2, bottom: box.y + box.h + 2 },
    ]),
    ...nodeSpans,
  ]
  // Printed at its own size, or smaller where it is wider than the page, and shrunk no further than MIN_SLICE_SCALE of
  // that to fit a page: the height one printed figure holds, in drawing units.
  const printScale = Math.min(1, PRINT_CONTENT_PX / width)
  const slices = sliceBounds(minY, maxY, PRINT_FIGURE_PX / (printScale * MIN_SLICE_SCALE), solid, inner)
  if (!slices || slices.length === 1) {
    return { svg, figure: `<figure class="rk-figure">${svg}${captionHtml}</figure>`, width: Math.round(width), height: Math.round(height) }
  }
  // One scale for every slice, so a boundary cut across two pages lines up: the one the tallest slice needs to print
  // whole on a page, never enlarged. Rounded down, so the printed height stays within the page.
  const scale = Math.min(printScale, ...slices.map(([top, bottom]) => PRINT_FIGURE_PX / (bottom - top)))
  const size = f(Math.floor(width * scale * 10) / 10)
  const figure = slices
    .map(([top, bottom], i) => {
      // Each slice is its own svg, with its own marker id.
      const sliceSvg = svgOf(top, bottom - top, `${arrow}-${i + 1}`, size)
      return `<figure class="rk-figure">${sliceSvg}${i === slices.length - 1 ? captionHtml : ''}</figure>`
    })
    .join('')
  return { svg, figure, width: Math.round(width), height: Math.round(height) }
}

/** The arrow marker's id in the markup, filled per svg; it holds '<', which no escaped label can. */
const MARKER_ID = '<marker-id>'
/** The printed page's content width, in CSS pixels: 178 mm, A4 less the side margins (Letter is wider). */
const PRINT_CONTENT_PX = 673
/**
 * The tallest figure the print stylesheet allows, 205 mm, in CSS pixels: what is left of a Letter page after its
 * margins, the page mark, the figure's own margin, the section title a first figure carries and the caption.
 */
const PRINT_FIGURE_PX = 774
/** How far a slice may shrink below its print size to hold more of the drawing: labels stay at about 9 px. */
const MIN_SLICE_SCALE = 0.75
/** More slices than this, and the drawing prints as one shrunken figure instead. */
const MAX_SLICES = 20

type Span = { top: number; bottom: number }

/** The gaps between the spans, merged where they overlap, as [from, to] pairs. */
function gapsBetween(spans: Span[]): [number, number][] {
  const sorted = spans
    .filter((o) => Number.isFinite(o.top) && Number.isFinite(o.bottom))
    .map((o) => ({ top: Math.min(o.top, o.bottom), bottom: Math.max(o.top, o.bottom) }))
    .sort((a, b) => a.top - b.top)
  const gaps: [number, number][] = []
  let reach = -Infinity
  for (const span of sorted) {
    if (reach > -Infinity && span.top > reach) gaps.push([reach, span.top])
    reach = Math.max(reach, span.bottom)
  }
  return gaps
}

/**
 * Where to cut a drawing from `top` to `bottom` into slices no taller than `maxHeight`, as [top, bottom] pairs: at the
 * lowest gap in `solid` that fits (nothing spans it), failing that in `inner` (only the side lines of a boundary that
 * holds others cross it), failing that at the height limit. A stretch of nothing taller than a slice is left out. Null
 * when it would take more than MAX_SLICES slices; a drawing that fits is one slice.
 */
export function sliceBounds(
  top: number,
  bottom: number,
  maxHeight: number,
  solid: Span[],
  inner: Span[] = [],
): [number, number][] | null {
  if (!(maxHeight > 0) || !Number.isFinite(maxHeight) || !(bottom - top > maxHeight)) return [[top, bottom]]
  const solidGaps = gapsBetween(solid)
  const innerGaps = gapsBetween(inner)
  // Where a gap is cut: its middle, or just below its top in a wide one, so the slice above stays short.
  const cutOf = ([from, to]: [number, number]) => Math.min((from + to) / 2, from + maxHeight * 0.05)
  const slices: [number, number][] = []
  let start = top
  while (bottom - start > maxHeight) {
    if (slices.length >= MAX_SLICES) return null
    // A blank stretch taller than a slice from here: skip it, keeping a margin above what follows.
    const blank = solidGaps.find(([from, to]) => from <= start && to - start > maxHeight)
    if (blank) {
      start = blank[1] - (maxHeight * 0.05)
      continue
    }
    const limit = start + maxHeight
    const fits = (gaps: [number, number][]) =>
      gaps.map(cutOf).filter((c) => c > start + maxHeight * 0.25 && c <= limit).pop()
    const cut = fits(solidGaps) ?? fits(innerGaps) ?? limit
    // At coordinates too large for the height to register, stop rather than cut nowhere.
    if (!(cut > start)) break
    slices.push([start, cut])
    start = cut
  }
  slices.push([start, bottom])
  return slices.length > MAX_SLICES ? null : slices
}
