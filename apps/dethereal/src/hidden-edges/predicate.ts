/**
 * Which flows count as hidden edges on this machine: a flow of one of the hidden-edges module's classes, with a
 * verified accepted decision of this machine for that flow and its ends. Any other flow, a hidden-edge class set by
 * hand or an entry from another machine included, is an ordinary flow, so it is never left out of a check.
 */
import { isHiddenEdgeClass } from './contract.js'
import { isSigner, readDecisions, standing, signerFor, type ReadDecision } from './records.js'

export interface FlowLike {
  id: string
  source?: { id?: string } | null
  target?: { id?: string } | null
  classData?: { id?: unknown; module?: { name?: unknown } | null } | null
}

/** The decision that makes a flow a hidden edge here, or null: the flow is then an ordinary one. */
export function hiddenEdgeDecision(flow: FlowLike, standingDecisions: ReadonlyMap<string, ReadDecision>): ReadDecision | null {
  if (!isHiddenEdgeClass(flow.classData)) return null
  return [...standingDecisions.values()].find((d) => d.verb === 'accepted' && d.verified && d.flow_id === flow.id && d.source === flow.source?.id && d.target === flow.target?.id) ?? null
}

/** Whether a flow is a hidden edge, given the decisions that stand here. */
export const isHiddenEdgeFlow = (flow: FlowLike, standingDecisions: ReadonlyMap<string, ReadDecision>): boolean => hiddenEdgeDecision(flow, standingDecisions) !== null

/** The hidden-edge flows of a model directory, each with the path techniques its decision accepted. */
export async function hiddenEdgeFlows(dir: string, flows: readonly FlowLike[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  if (!flows.some((f) => isHiddenEdgeClass(f.classData))) return out
  const signer = await signerFor(dir, false)
  const read = await readDecisions(dir, isSigner(signer) ? signer : null)
  if (read.status !== 'ok') return out
  const decisions = standing(read.decisions)
  for (const f of flows) {
    const d = hiddenEdgeDecision(f, decisions)
    if (d) out.set(f.id, new Set(d.technique_ids))
  }
  return out
}
