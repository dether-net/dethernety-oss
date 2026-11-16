/**
 * get_class_guide: the authored configuration guide of a class, for the attributes asked about.
 *
 * Each of the four class types carries a `guide`, which the platform resolves from the owning module's guide file.
 * It arrives as authored JSON: a list of entries keyed by `option_name`, which is the attribute key the knowledge
 * graph's rules read. Only the entries for the requested keys are returned, and only the fields listed in
 * `GuideEntry`: `security_impact` is never copied, so it cannot leave the tool.
 *
 * A guide that is missing, malformed or has nothing for the keys returns `{entries: []}`: no guidance is a normal
 * answer. A failed platform read is a tool failure.
 */
import { gql } from '@apollo/client'
import type { ApolloClient } from '@apollo/client'
import type { DocumentNode } from 'graphql'
import { z } from 'zod'
import { ClientDependentTool, type ToolContext, type ToolResult } from './base-tool.js'
import { PLATFORM_ID } from './input-rules.js'
import { redactSecrets } from '../auth/redact.js'
import { graphQLErrorCode, LOGIN_SENTENCE } from '../triage/kg.js'

export const ELEMENT_KINDS = ['component', 'securityBoundary', 'dataFlow', 'dataItem'] as const
type ElementKind = (typeof ELEMENT_KINDS)[number]

const GUIDE_COMPONENT = gql`
  query ComponentClassGuide($id: ID!) {
    componentClasses(where: { id: { eq: $id } }) {
      guide
    }
  }
`

const GUIDE_SECURITY_BOUNDARY = gql`
  query SecurityBoundaryClassGuide($id: ID!) {
    securityBoundaryClasses(where: { id: { eq: $id } }) {
      guide
    }
  }
`

const GUIDE_DATA_FLOW = gql`
  query DataFlowClassGuide($id: ID!) {
    dataFlowClasses(where: { id: { eq: $id } }) {
      guide
    }
  }
`

const GUIDE_DATA_CLASS = gql`
  query DataClassGuide($id: ID!) {
    dataClasses(where: { id: { eq: $id } }) {
      guide
    }
  }
`

/** The guide document and the root field of its answer, by element kind. */
export const GUIDE_QUERY_BY_KIND: Record<ElementKind, { query: DocumentNode; field: string }> = {
  component: { query: GUIDE_COMPONENT, field: 'componentClasses' },
  securityBoundary: { query: GUIDE_SECURITY_BOUNDARY, field: 'securityBoundaryClasses' },
  dataFlow: { query: GUIDE_DATA_FLOW, field: 'dataFlowClasses' },
  dataItem: { query: GUIDE_DATA_CLASS, field: 'dataClasses' },
}

/** One step of how to find an attribute's value, as authored. */
export interface GuideStep {
  type: string
  instruction: string
  command?: string
  expectedOutput?: string
  source?: string
}

/** One attribute's guidance. It has no field for the authored security impact, by design. */
export interface GuideEntry {
  optionName: string
  howToObtain: GuideStep[]
  optionDescription?: string
  typicalValues?: unknown
  valueType?: string
}

export interface GetClassGuideOutput {
  entries: GuideEntry[]
}

/** One authored step, or null when it has no non-empty instruction. A step without a type is `manual`. */
function parseStep(raw: unknown): GuideStep | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.instruction !== 'string' || o.instruction.length === 0) return null
  const step: GuideStep = { type: typeof o.type === 'string' ? o.type : 'manual', instruction: o.instruction }
  if (typeof o.command === 'string') step.command = o.command
  if (typeof o.expectedOutput === 'string') step.expectedOutput = o.expectedOutput
  else if (typeof o.expected_output === 'string') step.expectedOutput = o.expected_output
  if (typeof o.source === 'string') step.source = o.source
  return step
}

/**
 * The entries of a guide (a JSON string or an already parsed array) for the given attribute keys. An entry with no
 * usable step is no guidance and is left out. Never throws.
 */
export function filterGuideEntries(rawGuide: unknown, attributeKeys: readonly string[]): GuideEntry[] {
  let parsed: unknown = rawGuide
  if (typeof rawGuide === 'string') {
    try {
      parsed = JSON.parse(rawGuide)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const wanted = new Set(attributeKeys)
  const entries: GuideEntry[] = []
  for (const raw of parsed) {
    if (raw == null || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const optionName = o.option_name
    if (typeof optionName !== 'string' || !wanted.has(optionName)) continue
    const steps = Array.isArray(o.how_to_obtain) ? o.how_to_obtain.map(parseStep).filter((s): s is GuideStep => s !== null) : []
    if (steps.length === 0) continue
    const entry: GuideEntry = { optionName, howToObtain: steps }
    if (typeof o.option_description === 'string') entry.optionDescription = o.option_description
    if (o.typical_values !== undefined) entry.typicalValues = o.typical_values
    if (typeof o.value_type === 'string') entry.valueType = o.value_type
    entries.push(entry)
  }
  return entries
}

/** A guide read that failed, with its reason as one sentence. */
export class GuideReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuideReadError'
  }
}

/** The class's guide entries for the attribute keys, read from the platform as this tool reads them. */
export async function readClassGuide(client: ApolloClient, classId: string, kind: ElementKind, attributeKeys: readonly string[]): Promise<GuideEntry[]> {
  const { query, field } = GUIDE_QUERY_BY_KIND[kind]
  let rawGuide: unknown
  try {
    const result = (await client.query({ query, variables: { id: classId } })) as { data?: Record<string, Array<{ guide: unknown }> | null | undefined> }
    rawGuide = result.data?.[field]?.[0]?.guide
  } catch (error) {
    throw new GuideReadError(describeGuideFailure(error))
  }
  return filterGuideEntries(rawGuide, attributeKeys)
}

/** A failed guide read as one sentence, with every session secret redacted. */
function describeGuideFailure(error: unknown): string {
  const code = graphQLErrorCode(error)
  if (code === 'UNAUTHENTICATED') return LOGIN_SENTENCE
  const message = error instanceof Error ? error.message : String(error)
  return redactSecrets(code ? `the class guide read failed: ${message} (${code})` : `the class guide read failed: ${message}`)
}

const InputSchema = z.object({
  class_id: PLATFORM_ID.describe("The element's class id"),
  element_kind: z.enum(ELEMENT_KINDS).describe('The kind of element the class is for, which selects the class type that carries the guide'),
  attribute_keys: z.array(z.string().max(200)).min(1).max(100).describe('The attribute keys to return guidance for'),
}).strict()
type Input = z.infer<typeof InputSchema>

export class GetClassGuideTool extends ClientDependentTool<Input, GetClassGuideOutput> {
  readonly name = 'get_class_guide'
  readonly description =
    "Read-only: a class's authored configuration guidance for the given attribute keys. Returns {entries: [{optionName, " +
    'howToObtain, optionDescription?, typicalValues?, valueType?}]}, each howToObtain step with its type and instruction ' +
    'and, where authored, a command, expected output and source. The authored security impact is never returned. A ' +
    'missing or malformed guide, or keys with no guidance, return {entries: []}.'
  readonly inputSchema = InputSchema

  async execute(input: Input, context: ToolContext): Promise<ToolResult<GetClassGuideOutput>> {
    try {
      return { success: true, data: { entries: await readClassGuide(context.apolloClient!, input.class_id, input.element_kind, input.attribute_keys) } }
    } catch (error) {
      if (error instanceof GuideReadError) return { success: false, error: error.message }
      throw error
    }
  }
}

export const getClassGuideTool = new GetClassGuideTool()
