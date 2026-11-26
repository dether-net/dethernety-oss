/**
 * The model's local files as the hidden-edge checks read them: the components (their type, name, class and boundary),
 * the boundaries, the flows (their name, ends and class), the data items and the controls' names. Built from the
 * gates' own read of the directory, so both see the same files.
 */
import { flattenStructure } from '@dethernety/dt-core'
import { loadGateInput, type GateInput } from '../utils/gates.js'

export interface LocalComponent {
  id: string
  name: string
  type: string
  /** Its class's name, from the structure or its attribute file; null when it has none */
  className?: string | null
  /** The boundary it sits in */
  parent?: string | null
}
export interface LocalBoundary { id: string; name: string; className?: string | null; parent?: string | null }
export interface LocalFlow { id: string; name?: string; source: string; target: string; classId: string | null }

export interface LocalModel {
  components: Map<string, LocalComponent>
  flows: Map<string, LocalFlow>
  /** The boundaries and data items, by id: what contract 2's explanation may name beside components and flows */
  boundaries: Map<string, LocalBoundary>
  dataItems: Map<string, { id: string; name: string }>
  /** The controls' names, by id, as the elements reference them */
  controls?: Map<string, string>
}

const classNameOf = (...refs: Array<{ name?: unknown } | null | undefined>): string | null => {
  for (const r of refs) if (typeof r?.name === 'string' && r.name) return r.name
  return null
}

export function localModelOf(input: GateInput): LocalModel {
  const m: LocalModel = { components: new Map(), flows: new Map(), boundaries: new Map(), dataItems: new Map(), controls: new Map() }
  const { components, boundaries, parentMap } = flattenStructure(input.structure)
  const attrs = input.attributes
  const control = (list: unknown) => {
    for (const c of Array.isArray(list) ? list : []) if (typeof c?.id === 'string' && typeof c.name === 'string' && c.name && !m.controls!.has(c.id)) m.controls!.set(c.id, c.name)
  }
  for (const c of components) {
    m.components.set(c.id, { id: c.id, name: c.name ?? '', type: String(c.type ?? ''), className: classNameOf(c.classData, attrs?.components?.[c.id]?.classData), parent: parentMap.get(c.id) ?? null })
    control(c.controls)
  }
  for (const b of boundaries) {
    m.boundaries.set(b.id, { id: b.id, name: b.name ?? '', className: classNameOf(b.classData, attrs?.boundaries?.[b.id]?.classData), parent: parentMap.get(b.id) ?? null })
    control(b.controls)
  }
  for (const d of input.dataItems) {
    m.dataItems.set(d.id, { id: d.id, name: d.name ?? '' })
    control(d.controls)
  }
  for (const f of input.dataFlows) {
    const cls = (f.classData as { id?: unknown } | null | undefined)?.id
    m.flows.set(f.id, { id: f.id, name: f.name ?? '', source: f.source?.id ?? '', target: f.target?.id ?? '', classId: typeof cls === 'string' ? cls : null })
    control((f as { controls?: unknown }).controls)
  }
  return m
}

export async function readLocalModel(dir: string): Promise<LocalModel> {
  return localModelOf(await loadGateInput(dir))
}
