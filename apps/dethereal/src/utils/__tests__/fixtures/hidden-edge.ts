/**
 * A hidden edge in a gate-model directory, as `/dethereal:hidden-edges` writes one: a flow of a hidden-edge class
 * with its attribute file, and the accepted decision this machine signed for it. Tests run with a temporary HOME
 * (the suite's setup gives each file one), so the signing key is never the real one.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { candidateId } from '../../../hidden-edges/contract.js'
import { DECISIONS_FILE, isSigner, signDecision, signerFor } from '../../../hidden-edges/records.js'
import type { GateModel } from './gate-model.js'

/** A class of the hidden-edges module (test ids), with its module as a pulled flow carries it. */
export const REMOTE = { id: 'cls-he-remote-service', name: 'Hidden Edge: Remote Service', module: { id: 'mod-hidden-edges', name: 'dethernety-hidden-edges' } }

export interface HiddenEdge {
  id: string
  source: string
  target: string
  /** The attribute values; the module's own by default, path techniques included */
  attributes?: Record<string, unknown>
  description?: string
}

/** The edge's flow and attribute file, added to the model before it is written. */
export function addHiddenEdge(m: GateModel, e: HiddenEdge): void {
  const name = `Remote service: ${e.source} → ${e.target}`
  const classData = { id: REMOTE.id, name: REMOTE.name }
  m.dataFlows.push({
    id: e.id, name, description: e.description ?? 'Inferred remote service edge, reviewed by the operator in Dethereal. Techniques: T1021.',
    source: { id: e.source }, target: { id: e.target }, classData: { ...classData, module: REMOTE.module },
  })
  m.attributes.dataFlows[e.id] = {
    elementId: e.id, elementType: 'dataFlow', elementName: name, classData,
    attributes: e.attributes ?? {
      required_capability: 'opportunistic', required_privilege: 'user', granted_privilege: 'user', hidden_edge_kind: 'remote-service',
      technique_ids: ['T1021'], source_exposure_ids: ['e1'], proposed_by: 'rule', tier: 'medium',
    },
  }
}

/** This machine's signed accept of the edge, added to the model's decisions file. */
export async function acceptHiddenEdge(dir: string, e: Pick<HiddenEdge, 'id' | 'source' | 'target'>): Promise<void> {
  const signer = await signerFor(dir, true)
  if (!isSigner(signer)) throw new Error(`no signing key (${signer.code})`)
  const decision = signDecision(signer, {
    id: candidateId('remote-service', e.source, e.target), kind: 'remote-service', source: e.source, target: e.target, verb: 'accepted',
    flow_id: e.id, technique_ids: ['T1021'], exposure_ids: ['e1'], at: '2026-11-17T00:00:00.000Z',
  })
  const file = path.join(dir, '.dethereal', DECISIONS_FILE)
  const doc = await fs.readFile(file, 'utf8').then((t) => JSON.parse(t) as { decisions: unknown[] }, () => ({ decisions: [] as unknown[] }))
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ version: 1, decisions: [...doc.decisions, decision] }, null, 2))
}
