/**
 * Match Classes Tool
 *
 * Matches elements against the class catalog. Per element, the platform runs the
 * exact-name match and, for an element with a description, vector similarity
 * together (exact-name hits first); only when neither finds a class does it fall
 * back to whole-word name containment, then to the classes of the requested
 * componentType. Returns ranked candidates for each element.
 */

import { z } from 'zod'
import { DtClass } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'

const InputSchema = z.object({
  elements: z.array(z.object({
    name: z.string().describe('Element name to match against classes'),
    type: z.string().optional().describe('Element type (e.g. PROCESS, STORE, EXTERNAL_ENTITY): context for vector similarity, embedded with the name and description. It filters nothing; componentType does'),
    description: z.string().optional().describe('Element description. An element without one is not matched by vector similarity'),
  })).min(1).max(100).describe('Elements to classify (max 100 per call)'),
  classLabel: z.enum(['COMPONENT', 'SECURITY_BOUNDARY', 'DATA_FLOW', 'DATA', 'CONTROL'])
    .describe('Class category to match against'),
  componentType: z.enum(['PROCESS', 'STORE', 'EXTERNAL_ENTITY']).optional()
    .describe('Filter ComponentClass by type (only when classLabel is COMPONENT)'),
  moduleIds: z.array(z.string()).optional()
    .describe('Restrict to classes from these modules'),
  topN: z.number().int().min(1).max(10).optional().default(3)
    .describe('Number of top candidates per element (default 3)'),
  fields: z.array(z.enum(['description', 'category', 'type'])).optional()
    .describe('Optional fields to include on candidates'),
})

type MatchClassesInput = z.infer<typeof InputSchema>

interface MatchClassesOutput {
  matches: Array<{
    elementName: string
    candidates: Array<{
      classId: string
      className: string
      classDescription?: string
      classCategory?: string
      classType?: string
      /** On a candidate only when the reply's candidates come from more than one module (else `module` says it once) */
      moduleId?: string
      moduleName?: string
      matchType: string
      confidence: string
      similarityScore?: number
    }>
  }>
  /** The one module every candidate comes from, said once instead of on each candidate */
  module?: { id?: string; name?: string }
  unmatched: string[]
  /**
   * The unmatched elements whose only candidates were type matches (classes of the label or componentType, in no useful
   * order): each with the get_classes class_type to list its candidates with, when it is known. Absent when there are none.
   */
  unmatched_type_only?: Array<{ elementName: string; class_type?: string }>
  /** With unmatched_type_only: how to choose a class for those elements */
  hint?: string
  total_elements: number
  matched_count: number
  unmatched_count: number
  /** Whether semantic (vector) search is available on this deployment. */
  vector_search_available: boolean
  /** Present only when vector_search_available === false; a human-readable hint AI agents can relay. */
  clarification?: string
}

/**
 * The matches as returned: a class's description only the first time the class appears in the reply (later
 * candidates of that class point back to it), and no GraphQL __typename.
 */
export function oncePerClass<M extends { candidates: Array<{ classId: string; classDescription?: string }> }>(matches: M[]): M[] {
  const described = new Set<string>()
  const strip = <T extends object>(o: T): T => { const { __typename: _t, ...rest } = o as T & { __typename?: unknown }; return rest as T }
  return matches.map((m) => strip({
    ...m,
    candidates: m.candidates.map((c) => {
      const out = strip({ ...c })
      if (out.classDescription !== undefined) {
        if (described.has(c.classId)) delete out.classDescription
        else described.add(c.classId)
      }
      return out
    }),
  }))
}

/** A class description's first sentence, at most this long: enough to tell apart the candidates a match ranks. */
export const DESCRIPTION_MAX = 240

/** Words a full stop follows without ending the sentence. */
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'vs', 'etc', 'incl', 'approx', 'cf', 'esp', 'u.s', 'inc', 'ltd', 'co', 'no', 'st', 'dr', 'mr', 'ms'])
/** A sentence shorter than this does not end: it is more likely an abbreviation the list lacks. */
const SENTENCE_MIN = 40

/**
 * The first sentence of a class description, cut at DESCRIPTION_MAX characters (whole code points). A sentence ends at
 * . ! or ? before a capital, unless the word before a full stop is an abbreviation or the sentence would be shorter
 * than SENTENCE_MIN.
 */
export function firstSentence(text: string): string {
  let sentence = text
  for (const end of text.matchAll(/[.!?](?=\s+[A-Z])/g)) {
    const head = text.slice(0, end.index! + 1)
    const word = /([A-Za-z.]+)\.$/.exec(head)?.[1]?.toLowerCase()
    if (head.length < SENTENCE_MIN || (end[0] === '.' && word !== undefined && ABBREVIATIONS.has(word))) continue
    sentence = head
    break
  }
  const chars = Array.from(sentence)
  return chars.length > DESCRIPTION_MAX ? `${chars.slice(0, DESCRIPTION_MAX - 1).join('').trimEnd()}…` : sentence
}

/**
 * The candidates as sent: each description cut to its first sentence (get_classes has the whole text), no null
 * fields, the similarity score to 2 places, and the module said once at the top when every candidate shares it.
 */
export function trimMatches<M extends { candidates: Array<Record<string, unknown>> }>(matches: M[]): { matches: M[]; module?: { id?: string; name?: string } } {
  const modules = new Set(matches.flatMap((m) => m.candidates.map((c) => `${String(c.moduleId ?? '')}\u0000${String(c.moduleName ?? '')}`)))
  const one = modules.size === 1 ? matches.flatMap((m) => m.candidates)[0] : undefined
  const trimmed = matches.map((m) => ({
    ...m,
    candidates: m.candidates.map((c) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(c)) {
        if (v === null || v === undefined) continue
        if (one && (k === 'moduleId' || k === 'moduleName')) continue
        out[k] = k === 'classDescription' && typeof v === 'string' ? firstSentence(v)
          : k === 'similarityScore' && typeof v === 'number' ? Math.round(v * 100) / 100
            : v
      }
      return out
    }),
  }))
  const module = one && (one.moduleId != null || one.moduleName != null)
    ? { ...(one.moduleId != null ? { id: String(one.moduleId) } : {}), ...(one.moduleName != null ? { name: String(one.moduleName) } : {}) }
    : undefined
  return { matches: trimmed as M[], ...(module ? { module } : {}) }
}

/** What to do for an element matched by type only. */
export const TYPE_ONLY_HINT =
  'No class matched these elements by name or meaning: list the active modules\' classes with get_classes (module_id or module_name, and class_type when given) and choose there, or leave the element unclassified.'

const COMPONENT_TYPES = new Set(['PROCESS', 'STORE', 'EXTERNAL_ENTITY'])

/**
 * The get_classes class_type to list an element's candidates with: the label's own, the componentType, or the element's
 * own component type. Unknown when elements of that name disagree on it (the reply names elements by name).
 */
function classTypeFor(input: MatchClassesInput, elementName: string): string | undefined {
  if (input.classLabel !== 'COMPONENT') return input.classLabel
  if (input.componentType) return input.componentType
  const types = new Set(input.elements.filter((e) => e.name === elementName).map((e) => e.type?.toUpperCase()))
  const [type] = types
  return types.size === 1 && type && COMPONENT_TYPES.has(type) ? type : undefined
}

export class MatchClassesTool extends ClientDependentTool<MatchClassesInput, MatchClassesOutput> {
  readonly name = 'match_classes'
  readonly description = 'Match elements against the class catalog. Per element, an exact name match and, when the element has a description, vector similarity run together, exact-name hits first; only when neither finds a class, whole-word name containment, then the classes of componentType. Each candidate says which matched it. Returns ranked candidates for each element, each description its first sentence (get_classes has the whole text) and the module once at the top when all candidates share it. An element whose only candidates are classes of its type is listed in unmatched and unmatched_type_only, with a hint. Use this instead of multiple get_classes calls when classifying model elements.'
  readonly inputSchema = InputSchema

  async execute(input: MatchClassesInput, context: ToolContext): Promise<ToolResult<MatchClassesOutput>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtClass = new DtClass(context.apolloClient)

      const result = await dtClass.matchClasses({
        elements: input.elements,
        classLabel: input.classLabel,
        ...(input.componentType ? { componentType: input.componentType } : {}),
        ...(input.moduleIds ? { moduleIds: input.moduleIds } : {}),
        ...(input.topN !== undefined ? { topN: input.topN } : {}),
        ...(input.fields ? { fields: input.fields } : {}),
      })

      // Destructure rather than spread: re-emit `vectorAvailable` under the
      // snake_case `vector_search_available` so the output has one canonical
      // spelling for AI agents to read.
      const { matches: found, unmatched: none, vectorAvailable } = result
      // A type match only says the class is of the element's type: such candidates are no match at all.
      const typeOnly = found.filter((m) => m.candidates.length > 0 && m.candidates.every((c) => c.matchType === 'type_match'))
      // An entry with no candidate at all matched nothing either.
      const empty = found.filter((m) => m.candidates.length === 0)
      const matches = found.filter((m) => !typeOnly.includes(m) && !empty.includes(m))
      const unmatched = [...none, ...empty.map((m) => m.elementName), ...typeOnly.map((m) => m.elementName)]
      const trimmed = trimMatches(oncePerClass(matches) as unknown as Array<{ candidates: Array<Record<string, unknown>> }>)
      return {
        success: true,
        data: {
          matches: trimmed.matches as unknown as MatchClassesOutput['matches'],
          ...(trimmed.module ? { module: trimmed.module } : {}),
          unmatched,
          ...(typeOnly.length
            ? {
                unmatched_type_only: typeOnly.map((m) => {
                  const classType = classTypeFor(input, m.elementName)
                  return { elementName: m.elementName, ...(classType ? { class_type: classType } : {}) }
                }),
                hint: TYPE_ONLY_HINT,
              }
            : {}),
          total_elements: input.elements.length,
          matched_count: matches.length,
          unmatched_count: unmatched.length,
          vector_search_available: vectorAvailable,
          ...(vectorAvailable
            ? {}
            : {
                clarification:
                  'Semantic (vector) search is not available on this deployment; results are name- and type-based only.',
              }),
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to match classes',
      }
    }
  }
}

export const matchClassesTool = new MatchClassesTool()
