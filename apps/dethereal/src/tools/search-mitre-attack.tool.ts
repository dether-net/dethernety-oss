/**
 * Search MITRE ATT&CK Tool
 *
 * Search and browse MITRE ATT&CK techniques from the platform's graph database.
 * All technique references are verified against the platform — no hallucinated IDs.
 *
 * `lookup` resolves one exact ATT&CK id (`T…`) or ATLAS id (`AML.T…`) to its platform node, with the internal
 * node id, the parent technique and the tactics. `match` runs the platform's matching cascade (exact id, id prefix,
 * name, description, vector similarity) and returns candidates by MITRE id only: lookup is the id authority.
 */

import { z } from 'zod'
import { gql } from '@apollo/client'
import { DtMitreAttack } from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import { coded } from './input-rules.js'

const MAX_SEARCH_RESULTS = 20

/** The longest match query the platform takes. */
export const MATCH_QUERY_MAX = 500
export const TOP_N_DEFAULT = 5
export const TOP_N_MIN = 1
export const TOP_N_MAX = 20

/** An ATT&CK technique by its exact id, with its internal node id, parent and tactics. */
export const LOOKUP_TECHNIQUE = gql`
  query LookupTechnique($attackId: String!) {
    mitreAttackTechniques(where: { attack_id: { eq: $attackId } }) {
      id
      attack_id
      name
      description
      attack_decreased
      attack_subtechnique
      attack_version
      ref_url
      parentTechnique {
        id
        attack_id
        name
      }
      tactics {
        name
      }
    }
  }
`

/** An ATLAS technique by its exact id. ATLAS techniques carry no version of their own. */
export const LOOKUP_ATLAS_TECHNIQUE = gql`
  query LookupAtlasTechnique($atlasId: String!) {
    mitreAtlasTechniques(where: { atlas_id: { eq: $atlasId } }) {
      id
      atlas_id
      name
      description
      atlas_deprecated
      atlas_subtechnique
      ref_url
      parentTechnique {
        id
        atlas_id
        name
      }
      tactics {
        name
      }
    }
  }
`

/** The platform's matching cascade. A candidate carries its MITRE id only, never an internal node id. */
export const MATCH_MITRE_TECHNIQUES = gql`
  query MatchMitreTechniques($input: MatchMitreTechniquesInput!) {
    matchMitreTechniques(input: $input) {
      matches {
        query
        candidates {
          mitreId
          name
          description
          tactic
          kind
          matchType
          similarityScore
        }
      }
      unmatched
      vectorAvailable
      vectorDisabledReason
    }
  }
`

export interface TechniqueRecord {
  /** The internal platform node id. */
  id: string
  framework: 'attack' | 'atlas'
  /** The technique's MITRE id: an ATT&CK id (`T1078.001`) or an ATLAS id (`AML.T0051`). */
  attackId: string
  name: string
  description: string | null
  /** ATLAS only, advisory: the platform keeps the flag but does not enforce it. ATT&CK techniques carry none. */
  deprecated: boolean | null
  /** ATT&CK only: MITRE marks the technique as used less. It is still a valid technique. */
  decreasedUsage: boolean | null
  subtechnique: boolean | null
  /** ATT&CK only. */
  version: string | null
  refUrl: string | null
  parentTechnique: { id: string; attackId: string; name: string } | null
  tacticNames: string[]
}

export type MatchType = 'EXACT_ID' | 'PREFIX_ID' | 'NAME_MATCH' | 'DESCRIPTION_MATCH' | 'VECTOR_SIMILARITY'

export interface MatchCandidate {
  mitreId: string
  name: string
  description: string | null
  tactic: string | null
  kind: string | null
  matchType: MatchType
  similarityScore: number | null
}

export interface MatchResult {
  query: string
  candidates: MatchCandidate[]
  unmatched: string[]
  vectorAvailable: boolean
  vectorDisabledReason: string | null
}

interface RawTechnique {
  id: string
  attack_id: string | null
  name: string
  description: string | null
  attack_decreased: boolean | null
  attack_subtechnique: boolean | null
  attack_version: string | null
  ref_url: string | null
  parentTechnique?: Array<{ id: string; attack_id: string | null; name: string }> | null
  tactics?: Array<{ name: string }> | null
}

interface RawAtlasTechnique {
  id: string
  atlas_id: string | null
  name: string
  description: string | null
  atlas_deprecated: boolean | null
  atlas_subtechnique: boolean | null
  ref_url: string | null
  parentTechnique?: Array<{ id: string; atlas_id: string | null; name: string }> | null
  tactics?: Array<{ name: string }> | null
}

interface RawMatchResult {
  matches: Array<{ query: string; candidates: MatchCandidate[] }>
  unmatched: string[]
  vectorAvailable: boolean
  vectorDisabledReason: string | null
}

const KIND = { attack: 'ATTACK_TECHNIQUE', atlas: 'ATLAS_TECHNIQUE' } as const

/** The cascade's deterministic tiers rank above any similarity; within a tier, the higher similarity first. */
const TIER_ORDER: Record<MatchType, number> = {
  EXACT_ID: 0,
  PREFIX_ID: 1,
  NAME_MATCH: 2,
  DESCRIPTION_MATCH: 3,
  VECTOR_SIMILARITY: 4
}

const tierOf = (t: string) => TIER_ORDER[t as MatchType] ?? Object.keys(TIER_ORDER).length

/** Two frameworks' candidates in one list: by tier, then by similarity. */
export function mergeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  return [...candidates].sort((a, b) => tierOf(a.matchType) - tierOf(b.matchType) || (b.similarityScore ?? 0) - (a.similarityScore ?? 0))
}

/** The top_n a match asks for: default 5, clamped to 1–20. */
export function clampTopN(topN: number | undefined): number {
  return Math.min(TOP_N_MAX, Math.max(TOP_N_MIN, topN ?? TOP_N_DEFAULT))
}

const candidateOf = (c: MatchCandidate): MatchCandidate => ({
  mitreId: c.mitreId,
  name: c.name,
  description: c.description ?? null,
  tactic: c.tactic ?? null,
  kind: c.kind ?? null,
  matchType: c.matchType,
  similarityScore: c.similarityScore ?? null
})

/** The fields each action takes besides `action`. */
const ACTION_FIELDS: Record<string, ReadonlyArray<'query' | 'tactic_id' | 'attack_id' | 'framework' | 'top_n'>> = {
  search: ['query', 'tactic_id', 'attack_id'],
  tactics: ['query', 'tactic_id', 'attack_id'],
  techniques_by_tactic: ['query', 'tactic_id', 'attack_id'],
  technique: ['query', 'tactic_id', 'attack_id'],
  mitigations: ['query', 'tactic_id', 'attack_id'],
  mitigation: ['query', 'tactic_id', 'attack_id'],
  lookup: ['attack_id'],
  match: ['query', 'framework', 'top_n']
}

const InputSchema = z.object({
  action: z.enum([
    'search',
    'tactics',
    'techniques_by_tactic',
    'technique',
    'mitigations',
    'mitigation',
    'lookup',
    'match'
  ]).describe('Action to perform'),
  query: z.string().optional().describe(`Search query for technique name (required for "search"), or match text (required for "match", at most ${MATCH_QUERY_MAX} characters)`),
  tactic_id: z.string().optional().describe('The ATT&CK tactic id (TA0008) whose techniques to list (required for "techniques_by_tactic")'),
  attack_id: z.string().optional().describe('ATT&CK technique or mitigation ID (required for "technique" and "mitigation"); for "lookup", an exact ATT&CK id (T1078.001) or ATLAS id (AML.T0051)'),
  framework: z.enum(['attack', 'atlas', 'both']).optional().describe('For "match": ATT&CK (default), ATLAS, or both merged (deterministic tiers first, then by similarity)'),
  top_n: z.number().int().optional().describe(`For "match": candidates per query, default ${TOP_N_DEFAULT}, clamped to ${TOP_N_MIN}–${TOP_N_MAX}`)
}).superRefine((data, ctx) => {
  if (data.action === 'search' && !data.query) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"query" is required for "search" action', path: ['query'] })
  }
  if (data.action === 'techniques_by_tactic' && !data.tactic_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"tactic_id" is required for "techniques_by_tactic" action', path: ['tactic_id'] })
  }
  if ((data.action === 'technique' || data.action === 'mitigation' || data.action === 'lookup') && !data.attack_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"attack_id" is required for this action', path: ['attack_id'] })
  }
  if (data.action === 'match') {
    if (!data.query) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"query" is required for "match" action', path: ['query'] })
    } else if (data.query.length > MATCH_QUERY_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"query" exceeds the platform's ${MATCH_QUERY_MAX}-character limit for "match"`, path: ['query'] })
    }
  }
  const allowed = ACTION_FIELDS[data.action] ?? []
  for (const field of ['query', 'tactic_id', 'attack_id', 'framework', 'top_n'] as const) {
    if (data[field] !== undefined && !allowed.includes(field)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${field}" does not apply to "${data.action}" action`, path: [field] })
    }
  }
})

type SearchMitreAttackInput = z.infer<typeof InputSchema>

export class SearchMitreAttackTool extends ClientDependentTool<SearchMitreAttackInput, unknown> {
  readonly name = 'search_mitre_attack'
  readonly description =
    'Search and browse MITRE ATT&CK techniques, tactics, and mitigations from the platform database. Use this to ' +
    'verify technique IDs before referencing them in a threat model. lookup resolves an exact ATT&CK id (T...) or ' +
    'ATLAS id (AML.T...) to its platform technique: the internal node id, framework, parent technique and tactic ' +
    'names; a miss means the technique does not exist on the platform. match runs the platform\'s matching cascade ' +
    '(exact id, id prefix, name, description, vector similarity) over ATT&CK, ATLAS or both, and returns candidates ' +
    'by MITRE id with their match tier and similarity. Candidates carry no internal id: lookup is the id authority, ' +
    'so look a candidate up before using it. deprecated (ATLAS) is advisory only; decreasedUsage (ATT&CK) means MITRE ' +
    'sees the technique used less, and it is still valid.'
  readonly inputSchema = InputSchema

  async execute(input: SearchMitreAttackInput, context: ToolContext): Promise<ToolResult<unknown>> {
    try {
      if (!context.apolloClient) {
        return { success: false, error: 'Apollo client not available. Please ensure you are authenticated.' }
      }

      const dtMitreAttack = new DtMitreAttack(context.apolloClient)

      switch (input.action) {
        case 'search': {
          const techniques = await dtMitreAttack.findMitreAttackTechniques({
            query: { name: { contains: input.query! } }
          })
          return {
            success: true,
            data: {
              techniques: techniques.slice(0, MAX_SEARCH_RESULTS),
              total: techniques.length,
              truncated: techniques.length > MAX_SEARCH_RESULTS
            }
          }
        }

        case 'tactics': {
          const tactics = await dtMitreAttack.getMitreAttackTactics()
          return { success: true, data: { tactics } }
        }

        case 'techniques_by_tactic': {
          // The platform selects a tactic by its node id: an ATT&CK id (TA0008) is looked up first, so it is never
          // read as a node id that matches nothing.
          const wanted = input.tactic_id!
          const tactics = await dtMitreAttack.getMitreAttackTactics()
          const tactic = tactics.find((t) => t.attack_id?.toUpperCase() === wanted.toUpperCase()) ?? tactics.find((t) => t.id === wanted)
          if (!tactic) return { success: false, error: `Tactic ${wanted} not found: give an ATT&CK tactic id (TA0008), as the tactics action lists them` }
          const techniques = await dtMitreAttack.getMitreAttackTechniquesByTactic({ tacticId: tactic.id })
          return { success: true, data: { techniques, tactic_id: tactic.attack_id ?? wanted } }
        }

        case 'technique': {
          const technique = await dtMitreAttack.getMitreAttackTechnique({
            attackId: input.attack_id!
          })
          if (!technique) {
            return { success: false, error: `Technique ${input.attack_id} not found` }
          }
          return { success: true, data: { technique } }
        }

        case 'lookup':
          return await lookup(context.apolloClient, input.attack_id!)

        case 'match':
          return await match(context.apolloClient, input.query!, input.framework ?? 'attack', clampTopN(input.top_n))

        case 'mitigations': {
          const mitigations = await dtMitreAttack.getMitreAttackMitigations()
          return { success: true, data: { mitigations } }
        }

        case 'mitigation': {
          const mitigation = await dtMitreAttack.getMitreAttackMitigation({
            attackId: input.attack_id!
          })
          if (!mitigation) {
            return { success: false, error: `Mitigation ${input.attack_id} not found` }
          }
          return { success: true, data: { mitigation } }
        }

        default:
          return { success: false, error: `Unknown action: ${input.action}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'MITRE ATT&CK search failed'
      }
    }
  }
}

type Client = NonNullable<ToolContext['apolloClient']>

/** One technique by its exact id: an id starting with `AML.` is ATLAS, anything else ATT&CK. */
async function lookup(client: Client, id: string): Promise<ToolResult<{ technique: TechniqueRecord }>> {
  if (id.startsWith('AML.')) {
    const result = (await client.query({ query: LOOKUP_ATLAS_TECHNIQUE, variables: { atlasId: id } })) as {
      data?: { mitreAtlasTechniques?: RawAtlasTechnique[] }
    }
    const raw = result.data?.mitreAtlasTechniques?.[0]
    if (!raw) return coded('not_found', `No ATLAS technique with atlas_id ${id} exists on the platform.`)
    const parent = raw.parentTechnique?.[0]
    return {
      success: true,
      data: {
        technique: {
          id: raw.id,
          framework: 'atlas',
          attackId: raw.atlas_id ?? id,
          name: raw.name,
          description: raw.description ?? null,
          deprecated: raw.atlas_deprecated ?? null,
          decreasedUsage: null,
          subtechnique: raw.atlas_subtechnique ?? null,
          version: null,
          refUrl: raw.ref_url ?? null,
          parentTechnique: parent ? { id: parent.id, attackId: parent.atlas_id ?? '', name: parent.name } : null,
          tacticNames: (raw.tactics ?? []).map((t) => t.name)
        }
      }
    }
  }
  const result = (await client.query({ query: LOOKUP_TECHNIQUE, variables: { attackId: id } })) as {
    data?: { mitreAttackTechniques?: RawTechnique[] }
  }
  const raw = result.data?.mitreAttackTechniques?.[0]
  if (!raw) return coded('not_found', `No technique with attack_id ${id} exists on the platform.`)
  const parent = raw.parentTechnique?.[0]
  return {
    success: true,
    data: {
      technique: {
        id: raw.id,
        framework: 'attack',
        attackId: raw.attack_id ?? id,
        name: raw.name,
        description: raw.description ?? null,
        deprecated: null,
        decreasedUsage: raw.attack_decreased ?? null,
        subtechnique: raw.attack_subtechnique ?? null,
        version: raw.attack_version ?? null,
        refUrl: raw.ref_url ?? null,
        parentTechnique: parent ? { id: parent.id, attackId: parent.attack_id ?? '', name: parent.name } : null,
        tacticNames: (raw.tactics ?? []).map((t) => t.name)
      }
    }
  }
}

/** Candidates for one query, one platform call per framework; both frameworks merge by tier, then by similarity. */
async function match(client: Client, query: string, framework: 'attack' | 'atlas' | 'both', topN: number): Promise<ToolResult<MatchResult>> {
  const kinds = framework === 'both' ? [KIND.attack, KIND.atlas] : [KIND[framework]]
  const results: RawMatchResult[] = []
  for (const kind of kinds) {
    const result = (await client.query({
      query: MATCH_MITRE_TECHNIQUES,
      variables: { input: { queries: [{ query }], kind, topN } }
    })) as { data?: { matchMitreTechniques?: RawMatchResult } }
    const raw = result.data?.matchMitreTechniques
    if (!raw) return { success: false, error: 'matchMitreTechniques returned no data' }
    results.push(raw)
  }
  const perKind = results.map((raw) => ((raw.matches ?? []).find((m) => m.query === query) ?? raw.matches?.[0])?.candidates ?? [])
  const candidates = (perKind.length === 1 ? perKind[0]! : mergeCandidates(perKind.flat()).slice(0, topN)).map(candidateOf)
  return {
    success: true,
    data: {
      query,
      candidates,
      // A query is unmatched only when no framework matched it.
      unmatched: results.every((raw) => (raw.unmatched ?? []).includes(query)) ? [query] : [],
      vectorAvailable: results.every((raw) => raw.vectorAvailable === true),
      vectorDisabledReason: results.find((raw) => raw.vectorDisabledReason != null)?.vectorDisabledReason ?? null
    }
  }
}

export const searchMitreAttackTool = new SearchMitreAttackTool()
