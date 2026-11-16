/**
 * get_kg_chain: read-only evidence from the platform's knowledge graph.
 *
 * `probe` says whether the graph can be used here. Absence is a normal answer with a reason; a probe that fails is a
 * tool failure, because the state is then unknown, which is not the same as absent. `chain` returns one class's
 * rules, the threats they address and those threats' sources. `evaluate` runs one rule's recorded condition groups
 * against an attribute map the caller supplies; the tool reads no attribute values itself.
 *
 * A failed chain or evaluate read is an answer, not a failure: the graph is optional evidence, and a failure to read
 * it must not stop the work that uses it. The first such failure latches this process: every later chain or evaluate
 * answers "unavailable" without asking the platform, until the next probe.
 */
import { z } from 'zod'
import { explainConditionGroups, parseConditionGroups, type ConditionGroupsEvaluation } from '@dethernety/dt-module/condition-groups'
import { ClientDependentTool, type ToolContext, type ToolResult } from './base-tool.js'
import { PLATFORM_ID, need, only } from './input-rules.js'
import {
  EVALUATE_FRAMING,
  KG_CAPABILITY,
  KG_CHAIN,
  buildKgChain,
  describeKgFailure,
  foldCapability,
  graphQLErrorCode,
  isValidationFailure,
  kgAbsent,
  LOGIN_SENTENCE,
  type KgCapability,
  type KgChain,
  type KgProbeResult,
  type RawKgRule,
} from '../triage/kg.js'
import { KG_ABSENT_MARKER, KG_LOSS_NOTICE, kgProbeFailureNotice, oneLine } from '../triage/notices.js'

const RULE_NAME = z.string().max(200)

/**
 * The attribute map. Validated as a record of string keys, but the caller's own object is kept: a record parse drops
 * a `__proto__` key, and here that is an attribute name like any other. Only own enumerable keys are read.
 */
const ATTRIBUTE_RECORD = z.record(z.string(), z.unknown())
const { $schema: _draft, ...ATTRIBUTE_RECORD_JSON } = z.toJSONSchema(ATTRIBUTE_RECORD, { target: 'draft-07' }) as Record<string, unknown>
const ATTRIBUTES = z
  .unknown()
  .refine((v) => ATTRIBUTE_RECORD.safeParse(v).success, { message: 'attributes must be an object of attribute values' })
  .meta(ATTRIBUTE_RECORD_JSON)

const InputSchema = z.object({
  action: z.enum(['probe', 'chain', 'evaluate']).describe(
    "'probe' reports whether the knowledge graph can be used; 'chain' reads a class's rules and the threats they address; " +
      "'evaluate' runs one rule's condition groups against the supplied attributes",
  ),
  class_id: PLATFORM_ID.optional().describe("For 'chain' and 'evaluate': the element's class id"),
  rule_name: RULE_NAME.optional().describe("The rule's name, which is the exposure's name. Narrows 'chain'; required for 'evaluate'"),
  attributes: ATTRIBUTES.optional().describe(
    "For 'evaluate': the attribute values to evaluate against, by attribute name. Leave out an attribute that is not known; never fill a missing one with false or 0",
  ),
}).strict().superRefine((d, ctx) => {
  if (d.action === 'chain' || d.action === 'evaluate') need(ctx, !!d.class_id, 'class_id', d.action)
  if (d.action === 'evaluate') {
    need(ctx, !!d.rule_name, 'rule_name', 'evaluate')
    need(ctx, d.attributes !== undefined, 'attributes', 'evaluate')
  }
  only(ctx, d.action === 'probe' && (d.class_id !== undefined || d.rule_name !== undefined), 'class_id and rule_name', "'chain' and 'evaluate'")
  only(ctx, d.action !== 'evaluate' && d.attributes !== undefined, 'attributes', "'evaluate'")
})
type Input = z.infer<typeof InputSchema>

/** An evaluation of one rule, with the time it was made and the framing it is shown with. */
export interface EvaluateResult extends ConditionGroupsEvaluation {
  covered: true
  classId: string
  ruleId: string
  ruleName: string
  evaluatedAt: string
  framing: string
}

/**
 * A chain or evaluate read that could not be answered. It has no `covered` key on purpose: `false` would say the
 * class has no coverage, `true` would promise rules that are not there. `loss_notice` comes only with the failure
 * that set the latch, so the operator is told once.
 */
export interface KgUnavailableResult {
  unavailable: true
  latched: true
  classId: string
  reason: string
  loss_notice?: string
  /** The proposals table's mark for a row made without the graph */
  marker: string
}

/** What a failed probe carries beside its error: the failure code, the notice the operator is shown, and the mark. */
export interface KgProbeFailure {
  codes: ['kg_probe_failed']
  notice: string
  marker: string
}

/** What a chain or evaluate read that returned no rules list carries beside its error. */
export interface KgChainUnread {
  codes: ['kg_chain_unread']
  marker: string
}

type Output = KgProbeResult | KgProbeFailure | KgChainUnread | KgChain | EvaluateResult | KgUnavailableResult | { covered: boolean; classId: string; rule_found: false }

/** A probe that could not tell: the state is unknown, which is a tool error with the line to show the operator. */
function probeFailure(cause: string): ToolResult<Output> {
  return { success: false, error: cause, data: { codes: ['kg_probe_failed'], notice: kgProbeFailureNotice(cause), marker: KG_ABSENT_MARKER } }
}

/** The caller's attributes as a fresh map of their own enumerable keys; `__proto__` stays an ordinary key. */
function ownAttributes(value: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value as Record<string, unknown>))
}

export class GetKgChainTool extends ClientDependentTool<Input, Output> {
  readonly name = 'get_kg_chain'
  readonly description =
    'Read-only evidence from the platform\'s knowledge graph. probe reports whether it can be used: {regime: "kg_present"}, ' +
    'or {regime: "kg_absent", reason, notice, marker} with reason module_not_loaded, not_entitled or no_data; absence is a ' +
    'normal answer. A probe that fails is a tool error with code kg_probe_failed: the state is then unknown, not absent, and its data.notice is the line to show the operator. ' +
    'kg_absent, a failed probe, and an unavailable or unread chain carry marker, the mark to copy into the proposals table as given; ' +
    'covered: false and rule_found: false carry none. ' +
    'chain (class_id, optional rule_name) returns the class\'s rules (ruleId, name, kind, conditionGroups, malformed when the ' +
    'stored groups are not an array of arrays, readAttributes), the threats they address, those threats\' sources (corpus) ' +
    'and each rule\'s MITRE references (ruleMitreRefs). evaluate (class_id, rule_name, attributes) runs that rule\'s ' +
    'condition groups against the supplied attribute map, where a missing attribute satisfies only the negated operators, ' +
    'and returns each group\'s verdict, the satisfied groups after removing those another satisfied group implies, the ' +
    'groups that cannot be evaluated, the attribute change that would falsify each satisfied group, and a framing line to ' +
    'show with the result. Group indexes are the same in chain and evaluate. A class with no rules returns covered: false; ' +
    'evaluate of a rule the class does not have returns rule_found: false, with covered saying whether the class has any. ' +
    'When a chain or evaluate read fails (other than a refused session, which is a tool error naming login), the answer is {unavailable: true, latched: true, ' +
    'reason}, the first time with a loss_notice; later chain and evaluate calls answer the same without asking the ' +
    'platform, until the next probe. A read that returns no rules list is a tool error with code kg_chain_unread: the class\'s coverage is then unknown.'
  readonly inputSchema = InputSchema

  /** Why the knowledge graph stopped answering in this process, once it has; cleared by a probe. */
  private latchReason: string | undefined

  async execute(input: Input, context: ToolContext): Promise<ToolResult<Output>> {
    const client = context.apolloClient!

    if (input.action === 'probe') {
      this.latchReason = undefined
      let cap: KgCapability | undefined
      try {
        const result = (await client.query({ query: KG_CAPABILITY })) as { data?: { kgCapability?: KgCapability } }
        cap = result.data?.kgCapability
      } catch (error) {
        // The detection of a missing module: a schema without the field refuses the document at validation.
        if (isValidationFailure(error)) return { success: true, data: kgAbsent('module_not_loaded') }
        return probeFailure(oneLine(describeKgFailure(error, 'probe')))
      }
      const folded = foldCapability(cap)
      return folded ? { success: true, data: folded } : probeFailure('the KG capability probe failed: the platform returned no capability answer')
    }

    const classId = input.class_id!
    if (this.latchReason !== undefined) {
      return { success: true, data: { unavailable: true, latched: true, classId, reason: this.latchReason, marker: KG_ABSENT_MARKER } }
    }

    let rules: RawKgRule[]
    try {
      const result = (await client.query({ query: KG_CHAIN, variables: { classId } })) as { data?: { kgRules?: RawKgRule[] | null } }
      // No list is no answer: never read as a class without rules.
      if (!Array.isArray(result.data?.kgRules)) {
        return { success: false, error: 'the KG chain read returned no rules list: whether the class has rules is unknown; retry', data: { codes: ['kg_chain_unread'], marker: KG_ABSENT_MARKER } }
      }
      rules = result.data.kgRules
    } catch (error) {
      // A refused session is no loss of the graph: the operator signs in, and the next call reads it.
      if (graphQLErrorCode(error) === 'UNAUTHENTICATED') return { success: false, error: LOGIN_SENTENCE }
      // Never fall through with no rules: that would answer `covered: false`, a claim about the class made from a
      // read that did not happen.
      const reason = isValidationFailure(error) ? 'module_not_loaded' : oneLine(describeKgFailure(error, 'chain'))
      this.latchReason = reason
      return { success: true, data: { unavailable: true, latched: true, classId, reason, loss_notice: KG_LOSS_NOTICE, marker: KG_ABSENT_MARKER } }
    }

    if (input.action === 'chain') return { success: true, data: buildKgChain(rules, classId, input.rule_name) }

    const rule = rules.find((r) => r.name === input.rule_name)
    if (!rule) return { success: true, data: { covered: rules.length > 0, classId, rule_found: false } }
    // The chain's parser, so the group indexes here are the chain's.
    const evaluation = explainConditionGroups(parseConditionGroups(rule.conditionGroups), ownAttributes(input.attributes))
    return {
      success: true,
      data: {
        covered: true,
        classId,
        ruleId: rule.ruleId,
        ruleName: rule.name,
        evaluatedAt: new Date().toISOString(),
        framing: EVALUATE_FRAMING,
        ...evaluation,
      },
    }
  }
}

export const getKgChainTool = new GetKgChainTool()
