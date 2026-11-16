import { describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@vue-flow/core'
import { DtModel } from '@dethernety/dt-core'
import canvasCss from '@/components/DataFlow/Style/main.css?raw'
import { NODE_SIZES, renderModelDiagram, sliceBounds, type ModelGraph } from '../diagram'
import exportFixture from './fixtures/platform-export-structure.json'

/** The per-call id normalised, so a golden does not depend on how many diagrams ran before it. */
const golden = (svg: string) => svg.replace(/rk-dg-\d+/g, 'rk-dg-N')

const ROOT = { id: 'root', name: 'Default', positionX: 0, positionY: 0, width: null, height: null, parentBoundaryId: null }

const oneBoundary: ModelGraph = {
  boundaries: [ROOT, { id: 'b1', name: 'DMZ', positionX: 100, positionY: 50, width: 400, height: 300, parentBoundaryId: 'root' }],
  components: [
    { id: 'c1', name: 'Web', type: 'process', positionX: 40, positionY: 60, width: null, height: null, boundaryId: 'b1' },
    { id: 'c2', name: 'DB', type: 'store', positionX: 220, positionY: 160, width: null, height: null, boundaryId: 'b1' },
  ],
  flows: [{ id: 'f1', sourceId: 'c1', targetId: 'c2' }],
}

const nested: ModelGraph = {
  boundaries: [
    ROOT,
    { id: 'outer', name: 'Cloud', positionX: 0, positionY: 0, width: 600, height: 400, parentBoundaryId: 'root' },
    { id: 'inner', name: 'VPC', positionX: 50, positionY: 60, width: 300, height: 200, parentBoundaryId: 'outer' },
  ],
  components: [
    { id: 'u', name: 'User', type: 'external_entity', positionX: 700, positionY: 100, boundaryId: 'root' },
    { id: 'api', name: 'API', type: 'process', positionX: 30, positionY: 40, boundaryId: 'inner' },
  ],
  flows: [{ id: 'f', sourceId: 'u', targetId: 'api' }],
}

describe('renderModelDiagram', () => {
  it('draws one boundary with its components and a flow', () => {
    const result = renderModelDiagram(oneBoundary)!
    expect(result.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="rk-diagram rk-dg-\d+" viewBox="[-\d. ]+" width="100%"/)
    expect(result.svg.match(/^<svg[^>]*>/)![0]).not.toMatch(/\sheight=/)
    expect(golden(result.svg)).toMatchSnapshot()
  })

  it('draws nested boundaries, and a flow across them', () => {
    expect(golden(renderModelDiagram(nested)!.svg)).toMatchSnapshot()
  })

  it('does not draw the default boundary (no parent), and draws its children at the top level', () => {
    const svg = renderModelDiagram(oneBoundary)!.svg
    expect(svg).not.toContain('>Default<')
    expect(svg).toContain('>DMZ<')
    // The DMZ at its own position: the default boundary adds no offset.
    expect(svg).toContain('<rect class="b" x="100" y="50" width="400" height="300"')
  })

  it('places a component by its top-left corner inside its boundary, at the canvas size of its type', () => {
    const svg = renderModelDiagram(oneBoundary)!.svg
    // Web: a process at (100 + 40, 50 + 60), 80 x 80, so its centre is (180, 150).
    expect(svg).toContain(`<circle class="n" cx="180" cy="150" r="${NODE_SIZES.process.w / 2}"/>`)
    // DB: a store at (320, 210), 100 x 50.
    expect(svg).toContain('<rect class="nf" x="320" y="210" width="100" height="50"/>')
  })

  it('starts and ends a flow on the shapes\' outlines, with an arrowhead', () => {
    const svg = renderModelDiagram(oneBoundary)!.svg
    const [, x1, y1, x2, y2] = svg.match(/<line class="f" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/)!.map(Number)
    // Leaves the circle (radius 40 around (180, 150)) and arrives at the store's box (320..420, 210..260).
    expect(Math.hypot(x1 - 180, y1 - 150)).toBeCloseTo(40, 0)
    expect(x2 >= 320 && x2 <= 420 && y2 >= 210 && y2 <= 260).toBe(true)
    expect(svg).toMatch(/marker-end="url\(#rk-dg-\d+-arrow\)"/)
  })

  it('sizes a boundary without stored dimensions from its children, keeping children at negative positions inside', () => {
    const graph: ModelGraph = {
      boundaries: [ROOT, { id: 'b', name: 'Auto', positionX: 200, positionY: 200, parentBoundaryId: 'root' }],
      components: [
        { id: 'a', name: 'A', type: 'process', positionX: -60, positionY: -40, boundaryId: 'b' },
        { id: 'z', name: 'Z', type: 'process', positionX: 120, positionY: 90, boundaryId: 'b' },
      ],
    }
    const svg = renderModelDiagram(graph)!.svg
    const [, x, y, w, h] = svg.match(/<rect class="b" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/)!.map(Number)
    // A sits at (140, 160) and Z ends at (400, 370): both inside the boundary's box.
    expect(x).toBeLessThanOrEqual(140)
    expect(y).toBeLessThanOrEqual(160)
    expect(x + w).toBeGreaterThanOrEqual(400)
    expect(y + h).toBeGreaterThanOrEqual(370)
    expect(golden(svg)).toMatchSnapshot()
  })

  it('puts every shape and flow end of a real model where the canvas puts it', async () => {
    // A platform export's stored positions and sizes, as the threat report reads them from the same nodes, against the
    // canvas's own mapping (dt-core's dumpModelData) and its stylesheet's node sizes.
    await expectCanvasLayout(exportedModel())
  })

  it('does the same with a boundary nested in another and a component in the default boundary', async () => {
    // The export nests one level only: here the same model with one boundary moved inside another, and one component
    // moved out to the default boundary, so grandparent offsets and the root's own children are checked as well.
    const model = exportedModel()
    const inner = model.boundaries.find((b) => b.id === 'p-040')!
    const outer = model.boundaries.find((b) => b.id === 'p-039')!
    inner.parentBoundary = { id: outer.id }
    const loose = model.components.find((c) => c.id === 'p-031')!
    loose.parentBoundary = { id: model.root.id }
    await expectCanvasLayout(model)
  })

  it('is null for an empty graph, and for a coordinate that is not a finite number', () => {
    expect(renderModelDiagram({ boundaries: [], components: [], flows: [] })).toBeNull()
    expect(renderModelDiagram({ boundaries: [ROOT] })).toBeNull()
    expect(renderModelDiagram(null)).toBeNull()
    const bad = (positionX: unknown) =>
      renderModelDiagram({ components: [{ id: 'c', name: 'C', type: 'process', positionX: positionX as number, positionY: 0 }] })
    expect(bad(Number.NaN)).toBeNull()
    expect(bad(Number.POSITIVE_INFINITY)).toBeNull()
    expect(bad('12px')).toBeNull()
    expect(bad('12')).not.toBeNull()
  })

  it('keeps a long boundary label inside the drawing', () => {
    const name = 'W'.repeat(40)
    const graph: ModelGraph = {
      boundaries: [ROOT, { id: 'b', name, positionX: 0, positionY: 0, parentBoundaryId: 'root' }],
    }
    const svg = renderModelDiagram(graph)!.svg
    const [minX, , width] = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) /)!.slice(1).map(Number)
    // The empty boundary is 90 wide; its label starts 8 in and is about 40 x 12 x 0.6 = 288 wide.
    expect(minX + width).toBeGreaterThanOrEqual(8 + 288)
  })

  it('draws a large graph quickly', () => {
    const graph: ModelGraph = {
      boundaries: [ROOT, ...Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, positionX: (i % 10) * 500, positionY: Math.floor(i / 10) * 400, parentBoundaryId: 'root' }))],
      components: Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, type: 'process', positionX: (i % 6) * 70, positionY: Math.floor(i / 6) % 5 * 70, boundaryId: `b${i % 50}` })),
      flows: Array.from({ length: 150 }, (_, i) => ({ id: `f${i}`, sourceId: `c${i}`, targetId: `c${i + 1}` })),
    }
    const start = performance.now()
    expect(renderModelDiagram(graph)).not.toBeNull()
    expect(performance.now() - start).toBeLessThan(500)
  })

  it('has no theme variables, no components, no disclosure and no external reference in its output', () => {
    for (const graph of [oneBoundary, nested]) {
      const { svg, figure } = renderModelDiagram(graph, { caption: 'Layout as of today' })!
      for (const out of [svg, figure]) {
        expect(out).not.toContain('var(')
        expect(out).not.toContain('<v-')
        expect(out).not.toContain('<details')
        expect(out).not.toMatch(/(href|src)="http/)
      }
    }
  })

  it('gives every drawing its own root class and marker id', () => {
    const a = renderModelDiagram(oneBoundary)!.svg
    const b = renderModelDiagram(oneBoundary)!.svg
    const id = (svg: string) => svg.match(/class="rk-diagram (rk-dg-\d+)"/)![1]
    expect(id(a)).not.toBe(id(b))
    expect(b).not.toContain(`id="${id(a)}-arrow"`)
  })

  it('escapes hostile names, and never cuts inside a character or an entity', () => {
    const graph: ModelGraph = {
      boundaries: [ROOT, { id: 'b', name: '<script>alert(1)</script>', positionX: 0, positionY: 0, width: 100, height: 100, parentBoundaryId: 'root' }],
      components: [
        { id: 'c', name: `"quoted" & <b>bold</b>`, type: 'process', positionX: 10, positionY: 10, boundaryId: 'b' },
        { id: 'd', name: `${'&'.repeat(40)}`, type: 'process', positionX: 10, positionY: 10, boundaryId: 'b' },
        { id: 'e', name: `${'a'.repeat(26)}\u{1F6E1}\u{1F6E1}\u{1F6E1}`, type: 'process', positionX: 10, positionY: 10, boundaryId: 'b' },
      ],
    }
    const svg = renderModelDiagram(graph)!.svg
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('&quot;quoted&quot; &amp; &lt;b&gt;')
    expect(svg).toContain(`>${'&amp;'.repeat(27)}…<`)
    expect(svg).toContain(`>${'a'.repeat(26)}\u{1F6E1}…<`)
  })

  it('prints the caller\'s caption and adds no text of its own', () => {
    const withCaption = renderModelDiagram(oneBoundary, { caption: 'Layout as of 2026-11-20' })!
    expect(withCaption.figure).toContain('<figcaption class="rk-figcaption">Layout as of 2026-11-20</figcaption>')
    const without = renderModelDiagram(oneBoundary)!
    expect(without.figure).not.toContain('figcaption')
    const texts = [...without.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
    expect(texts.sort()).toEqual(['DB', 'DMZ', 'Web'])
  })

  it('marks highlights, crown jewels and entry points without verdict colours', () => {
    const svg = renderModelDiagram(oneBoundary, {
      highlightIds: ['c1'],
      highlightBoundaryIds: ['b1'],
      crownJewelIds: ['c2'],
      entryPointIds: ['c1'],
    })!.svg
    expect(svg).toContain('<rect class="b hl"')
    expect(svg).toContain('<circle class="n hl"')
    expect(svg).toContain('★')
    expect(svg).toContain('➜')
    expect(svg.toLowerCase()).not.toMatch(/#f44336|#c62828|red/)
  })
})

// --- a real model, laid out by the canvas ---------------------------------------------------------------------------

type ExportedBoundary = {
  id: string
  name: string
  positionX?: number
  positionY?: number
  dimensionsWidth?: number
  dimensionsHeight?: number
  parentBoundary: { id: string }
  boundaries?: ExportedBoundary[]
  components?: ExportedComponent[]
}
type ExportedComponent = {
  id: string
  name: string
  type: string
  positionX?: number
  positionY?: number
  dimensionsWidth?: number
  dimensionsHeight?: number
  parentBoundary: { id: string }
}
type ExportedFlow = { id: string; name: string; source: { id: string }; target: { id: string } }

/** The structure and flows of a platform model export (dethereal's acceptance fixture), flattened; a fresh copy. */
function exportedModel() {
  const fixture = structuredClone(exportFixture)
  const root = fixture['structure.json'].defaultBoundary as unknown as ExportedBoundary
  const boundaries: ExportedBoundary[] = []
  const components: ExportedComponent[] = [...(root.components ?? [])]
  const walk = (b: ExportedBoundary) => {
    for (const child of b.boundaries ?? []) {
      boundaries.push(child)
      components.push(...(child.components ?? []))
      walk(child)
    }
  }
  walk(root)
  const flows = fixture['dataflows.json'].dataFlows as ExportedFlow[]
  return { root, boundaries, components, flows }
}

type ExportedModel = ReturnType<typeof exportedModel>

/**
 * Renders the model as the threat report stores it, and checks the diagram against the canvas: every boundary and
 * component shape at its canvas box, nothing else drawn, and every flow from its source's outline to its target's,
 * on the line between their centres and facing each other.
 */
async function expectCanvasLayout({ root, boundaries, components, flows }: ExportedModel) {
  // As computeModelGraph reads the model: the default boundary included, with no position and no parent.
  const snapshot: ModelGraph = {
    boundaries: [
      { id: root.id, name: root.name, positionX: null, positionY: null, width: null, height: null, parentBoundaryId: null },
      ...boundaries.map((b) => ({
        id: b.id,
        name: b.name,
        positionX: b.positionX ?? null,
        positionY: b.positionY ?? null,
        width: b.dimensionsWidth ?? null,
        height: b.dimensionsHeight ?? null,
        parentBoundaryId: b.parentBoundary.id,
      })),
    ],
    components: components.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type.toLowerCase(),
      positionX: c.positionX ?? null,
      positionY: c.positionY ?? null,
      width: c.dimensionsWidth ?? null,
      height: c.dimensionsHeight ?? null,
      boundaryId: c.parentBoundary.id,
    })),
    flows: flows.map((d) => ({ id: d.id, sourceId: d.source.id, targetId: d.target.id })),
  }
  const svg = renderModelDiagram(snapshot)!.svg

  const canvas = await canvasNodes(root, boundaries, components, flows)
  const abs = (id: string): { x: number; y: number } => {
    const n = canvas.byId.get(id)!
    const parent = n.parentNode ? abs(n.parentNode) : { x: 0, y: 0 }
    return { x: parent.x + n.position.x, y: parent.y + n.position.y }
  }
  const boxOf = (id: string) => {
    const n = canvas.byId.get(id)!
    const css = CANVAS_SIZES[n.type!]
    // A boundary carries its stored size; vue-flow sets a node size only when it is truthy, else the stylesheet's holds.
    return { ...abs(id), w: Number(n.width) || css.w, h: Number(n.height) || css.h, type: n.type! }
  }
  const count = (pattern: RegExp) => svg.match(pattern)?.length ?? 0
  const ofType = (type: string) => canvas.components.filter((c) => c.type === type).length

  expect(Object.keys(CANVAS_SIZES).sort()).toEqual(['BOUNDARY', 'EXTERNAL_ENTITY', 'PROCESS', 'STORE'])
  expect(canvas.boundaries).toHaveLength(boundaries.length)
  expect(canvas.components).toHaveLength(components.length)
  expect(canvas.components.some((c) => c.parentNode)).toBe(true)

  // The default boundary is not drawn, and nothing is drawn twice.
  expect(svg).not.toContain(`>${root.name}<`)
  expect(count(/<rect class="b"/g)).toBe(canvas.boundaries.length)
  expect(count(/<circle class="n"/g)).toBe(ofType('PROCESS'))
  expect(count(/<rect class="nf"/g)).toBe(ofType('STORE'))
  expect(count(/<rect class="n"/g)).toBe(ofType('EXTERNAL_ENTITY'))
  expect(ofType('PROCESS') + ofType('STORE') + ofType('EXTERNAL_ENTITY')).toBe(canvas.components.length)

  for (const b of canvas.boundaries) {
    const { x, y, w, h } = boxOf(b.id)
    expect(svg).toContain(`<rect class="b" x="${x}" y="${y}" width="${w}" height="${h}"`)
  }
  for (const c of canvas.components) {
    const { x, y, w, h, type } = boxOf(c.id)
    if (type === 'PROCESS') expect(svg).toContain(`<circle class="n" cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}"/>`)
    else if (type === 'STORE') expect(svg).toContain(`<rect class="nf" x="${x}" y="${y}" width="${w}" height="${h}"/>`)
    else expect(svg).toContain(`<rect class="n" x="${x}" y="${y}" width="${w}" height="${h}"/>`)
  }

  const lines = [...svg.matchAll(/<line class="f" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)].map(
    (m) => m.slice(1).map(Number),
  )
  expect(lines).toHaveLength(canvas.flows.length)
  canvas.flows.forEach((edge, i) => {
    const [x1, y1, x2, y2] = lines[i]
    const src = boxOf(edge.source)
    const dst = boxOf(edge.target)
    expect(onOutline(src, x1, y1)).toBe(true)
    expect(onOutline(dst, x2, y2)).toBe(true)
    expect(onCentreLine(src, dst, x1, y1)).toBe(true)
    expect(onCentreLine(src, dst, x2, y2)).toBe(true)
    // Each end on the side of its shape that faces the other shape, not the far side.
    expect(facing(src, dst, x1, y1)).toBe(true)
    expect(facing(dst, src, x2, y2)).toBe(true)
  })
}

/** The canvas's nodes and edges for the model, from dt-core's dumpModelData, which the editor loads its nodes from. */
async function canvasNodes(
  root: ExportedBoundary,
  boundaries: ExportedBoundary[],
  components: ExportedComponent[],
  flows: ExportedFlow[],
) {
  const dtModel = new DtModel({} as never) as unknown as {
    dtUtils: { performQuery: unknown }
    dumpModelData: (args: { modelId: string }) => Promise<{ boundaries: Node[]; components: Node[]; dataFlows: Edge[] }>
  }
  // The query answer has the shape the GraphQL API returns: every relation is a list.
  const asList = <T extends { parentBoundary: { id: string } }>(n: T) => ({ ...n, parentBoundary: [n.parentBoundary] })
  dtModel.dtUtils.performQuery = vi.fn().mockResolvedValue({
    models: [
      {
        id: 'm',
        name: 'M',
        controls: [],
        dataItems: [],
        defaultBoundary: [
          {
            id: root.id,
            name: root.name,
            controls: [],
            dataItems: [],
            allDescendantBoundaries: boundaries.map(asList),
            allDescendantComponents: components.map(asList),
            allDescendantDataFlows: flows.map((d) => ({ ...d, source: [d.source], target: [d.target] })),
          },
        ],
      },
    ],
  })
  const dump = await dtModel.dumpModelData({ modelId: 'm' })
  const byId = new Map<string, Node>([...dump.boundaries, ...dump.components].map((n) => [n.id, n]))
  return { boundaries: dump.boundaries, components: dump.components, flows: dump.dataFlows, byId }
}

/** The canvas's node sizes, read from its stylesheet: `.vue-flow__node-<TYPE> { width: Npx; height: Npx; ... }`. */
const CANVAS_SIZES: Record<string, { w: number; h: number }> = Object.fromEntries(
  [...canvasCss.matchAll(/\.vue-flow__node-([A-Z_]+)\s*\{[^}]*?width:\s*(\d+)px;[^}]*?height:\s*(\d+)px;/g)].map((m) => [
    m[1],
    { w: Number(m[2]), h: Number(m[3]) },
  ]),
)

const near = (a: number, b: number) => Math.abs(a - b) <= 0.1

/** Whether (x, y) lies on the shape's outline: the circle of a process, the rectangle of anything else. */
function onOutline(box: { x: number; y: number; w: number; h: number; type: string }, x: number, y: number) {
  if (box.type === 'PROCESS') {
    return near(Math.hypot(x - (box.x + box.w / 2), y - (box.y + box.h / 2)), Math.min(box.w, box.h) / 2)
  }
  const inX = x >= box.x - 0.1 && x <= box.x + box.w + 0.1
  const inY = y >= box.y - 0.1 && y <= box.y + box.h + 0.1
  return (inX && (near(y, box.y) || near(y, box.y + box.h))) || (inY && (near(x, box.x) || near(x, box.x + box.w)))
}

/** Whether (x, y) lies on the line through the two shapes' centres. */
function onCentreLine(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
) {
  const ax = a.x + a.w / 2
  const ay = a.y + a.h / 2
  const dx = b.x + b.w / 2 - ax
  const dy = b.y + b.h / 2 - ay
  return Math.abs((x - ax) * dy - (y - ay) * dx) / Math.hypot(dx, dy) <= 0.2
}

/** Whether (x, y) lies on the side of shape a that faces shape b: ahead of a's centre, towards b's. */
function facing(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
) {
  const ax = a.x + a.w / 2
  const ay = a.y + a.h / 2
  return (x - ax) * (b.x + b.w / 2 - ax) + (y - ay) * (b.y + b.h / 2 - ay) > 0
}

describe('a drawing taller than a printed page', () => {
  const TIERS = 7
  const tall: ModelGraph = {
    boundaries: [
      { id: 'root', name: 'Default', positionX: null, positionY: null, width: null, height: null, parentBoundaryId: null },
      ...Array.from({ length: TIERS }, (_, i) => ({
        id: `t${i}`, name: `Tier ${i + 1}`, positionX: 0, positionY: i * 520, width: 480, height: 440, parentBoundaryId: 'root',
      })),
    ],
    components: Array.from({ length: TIERS }, (_, i) => ({
      id: `n${i}`, name: `Node ${i + 1}`, type: 'process', positionX: 180, positionY: 160, boundaryId: `t${i}`,
    })),
    flows: Array.from({ length: TIERS - 1 }, (_, i) => ({ id: `f${i}`, sourceId: `n${i}`, targetId: `n${i + 1}` })),
  }
  const figuresOf = (figure: string) => figure.match(/<figure class="rk-figure">[\s\S]*?<\/figure>/g) ?? []
  const viewBoxOf = (svg: string) => svg.match(/viewBox="([-\d. ]+)"/)![1].split(' ').map(Number)

  it('is cut into figures at the gaps between its boundaries, each printing whole on a page at a readable size', () => {
    const result = renderModelDiagram(tall, { caption: 'Layout as of now' })!
    const figures = figuresOf(result.figure)
    expect(figures.length).toBeGreaterThan(1)
    const boxes = Array.from({ length: TIERS }, (_, i) => ({ top: i * 520, bottom: i * 520 + 440 }))
    let reach = -Infinity
    for (const [i, fig] of figures.entries()) {
      const [, y, w, h] = viewBoxOf(fig)
      const printed = Number(fig.match(/<svg[^>]* width="([\d.]+)"/)![1])
      // Never enlarged, at least three quarters of its own size, and no taller than the 205 mm (774 px) a figure gets.
      expect(printed).toBeLessThanOrEqual(w)
      expect(printed / w).toBeGreaterThanOrEqual(0.75)
      expect((h * printed) / w).toBeLessThanOrEqual(774)
      // Contiguous, and every cut between two boundaries, never through one.
      if (i > 0) expect(y).toBeCloseTo(reach, 5)
      reach = y + h
      if (i > 0) expect(boxes.some((b) => y > b.top && y < b.bottom)).toBe(false)
    }
    expect(reach).toBeCloseTo(viewBoxOf(result.svg)[1] + viewBoxOf(result.svg)[3], 5)
    // The caption once, under the last figure; one arrow marker per figure.
    expect(result.figure.match(/<figcaption/g)).toHaveLength(1)
    expect(figures.at(-1)).toContain('<figcaption class="rk-figcaption">Layout as of now</figcaption>')
    const markers = [...result.figure.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(markers).size).toBe(figures.length)
    // The whole drawing is still available as one svg.
    expect(result.svg).toContain('width="100%"')
  })

  it('stays one figure when it fits', () => {
    const short = { ...tall, boundaries: tall.boundaries!.slice(0, 2), components: tall.components!.slice(0, 1), flows: [] }
    const result = renderModelDiagram(short)!
    expect(figuresOf(result.figure)).toHaveLength(1)
    expect(result.figure).toContain(result.svg)
  })
})

describe('sliceBounds', () => {
  const spans = [{ top: 0, bottom: 40 }, { top: 50, bottom: 90 }, { top: 100, bottom: 140 }, { top: 150, bottom: 190 }]

  it('keeps what fits whole', () => {
    expect(sliceBounds(0, 190, 200, spans)).toEqual([[0, 190]])
  })

  it('cuts at the lowest gap that keeps a slice within the height', () => {
    expect(sliceBounds(0, 190, 100, spans)).toEqual([[0, 95], [95, 190]])
  })

  it('cuts at the height where no gap allows, as inside one tall boundary', () => {
    expect(sliceBounds(0, 250, 100, [{ top: 0, bottom: 250 }])).toEqual([[0, 100], [100, 200], [200, 250]])
  })

  it('cuts between the nodes inside a boundary that holds them all, before cutting through one', () => {
    const wrapper = { top: 0, bottom: 300 }
    const nodes = [{ top: 20, bottom: 80 }, { top: 120, bottom: 180 }, { top: 220, bottom: 280 }]
    const inner = [{ top: 0, bottom: 10 }, { top: 298, bottom: 302 }, ...nodes]
    // Between the nodes (80-120, 180-220), just below the node above: never through one.
    expect(sliceBounds(0, 300, 120, [wrapper, ...nodes], inner)).toEqual([[0, 86], [86, 186], [186, 300]])
  })

  it('leaves out a stretch of nothing taller than a slice', () => {
    const far = [{ top: 0, bottom: 50 }, { top: 10000, bottom: 10050 }]
    const slices = sliceBounds(0, 10050, 100, far)!
    expect(slices.length).toBeLessThan(5)
    expect(slices[0][0]).toBe(0)
    expect(slices.at(-1)![1]).toBe(10050)
  })

  it('cuts a wide gap just below its top, so what comes before it shares a slice', () => {
    const content = [{ top: 0, bottom: 300 }, { top: 400, bottom: 600 }, { top: 9000, bottom: 9100 }]
    const slices = sliceBounds(0, 9100, 1000, content)!
    expect(slices[0]).toEqual([0, 650])
  })

  it('gives up past twenty slices, and never loops where the height does not register', () => {
    expect(sliceBounds(0, 5000, 100, [{ top: 0, bottom: 5000 }])).toBeNull()
    const huge = sliceBounds(0, 1e20, 1000, [{ top: 0, bottom: 1e20 }])
    expect(huge === null || huge.length <= 20).toBe(true)
    expect(sliceBounds(1e20, 2e20, 10, [])).toEqual(expect.any(Array))
  })

  it('keeps one slice for a height that is not a positive number', () => {
    for (const h of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(sliceBounds(0, 100, h, spans)).toEqual([[0, 100]])
  })
})

describe('the slices of one drawing', () => {
  it('print at one scale, and leave label text alone', () => {
    const graph: ModelGraph = {
      boundaries: [
        { id: 'root', name: 'Default', positionX: null, positionY: null, width: null, height: null, parentBoundaryId: null },
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `t${i}`, name: `Tier ${i + 1}`, positionX: 0, positionY: i * 700, width: 480, height: 400 + i * 40, parentBoundaryId: 'root',
        })),
      ],
      components: [{ id: 'n0', name: 'rk-dg-1-arrow <marker-id>', type: 'process', positionX: 100, positionY: 100, boundaryId: 't0' }],
      flows: [],
    }
    const figure = renderModelDiagram(graph)!.figure
    const widths = [...figure.matchAll(/<svg[^>]* width="([\d.]+)"/g)].map((m) => m[1])
    expect(widths.length).toBeGreaterThan(1)
    expect(new Set(widths).size).toBe(1)
    expect(figure).toContain('rk-dg-1-arrow &lt;marker-id&gt;</text>')
  })
})
