/**
 * The model's local files as the hidden-edge checks read them: the components (their type and name) and the flows
 * (their ends and class). Built from the gates' own read of the directory, so both see the same files.
 */
import { flattenStructure } from '@dethernety/dt-core'
import { loadGateInput, type GateInput } from '../utils/gates.js'

export interface LocalComponent { id: string; name: string; type: string }
export interface LocalFlow { id: string; source: string; target: string; classId: string | null }

export interface LocalModel {
  components: Map<string, LocalComponent>
  flows: Map<string, LocalFlow>
}

export function localModelOf(input: GateInput): LocalModel {
  const m: LocalModel = { components: new Map(), flows: new Map() }
  for (const c of flattenStructure(input.structure).components) m.components.set(c.id, { id: c.id, name: c.name ?? '', type: String(c.type ?? '') })
  for (const f of input.dataFlows) {
    const cls = (f.classData as { id?: unknown } | null | undefined)?.id
    m.flows.set(f.id, { id: f.id, source: f.source?.id ?? '', target: f.target?.id ?? '', classId: typeof cls === 'string' ? cls : null })
  }
  return m
}

export async function readLocalModel(dir: string): Promise<LocalModel> {
  return localModelOf(await loadGateInput(dir))
}
