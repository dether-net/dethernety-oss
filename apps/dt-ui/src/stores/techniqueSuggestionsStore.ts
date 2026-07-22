/**
 * MITRE picker store.
 *
 * Mirrors `classSuggestionsStore` structurally. Differences:
 *   - keyed by `MitreKind` (no `componentType` dimension)
 *   - tracks `vectorDisabledReason` alongside `vectorAvailable` (picker caption needs the specific reason)
 *   - catalog hydration delegates to existing DtMitreAttack / DtMitreDefend
 *     surfaces (the local-tier match path); the new DtMitre is only for the
 *     vector-tier (server-side semantic match)
 *
 * Cancellation is implicit via `DtMitre.matchTechniques` → `dtUtils.withCancellableLatest`.
 * Store catches `CancelledError` and exits silently — same shape as classSuggestionsStore.
 */

import { ref, readonly } from 'vue'
import { defineStore } from 'pinia'
import {
  DtMitre,
  DtMitreAttack,
  DtMitreDefend,
  CancelledError,
  type MitreKind,
  type MitreCandidate,
  type VectorDisabledReason,
} from '@dethernety/dt-core'
import apolloClient from '@/plugins/apolloClient'

// Catalog entry — the shape returned by DtMitreAttack/DtMitreDefend's existing
// retrieval methods. Kept intentionally lean: id, name, optional description +
// tactic. The picker's local-tier matching never needs more.
//
// `internalId` is the graph node UUID. The picker's v-model uses `mitreId`
// (attack_id / d3fendId — what the user sees) but the backend's connect
// mutations require the internal id. ExposureDialog / CounterMeasureDialog
// convert on save by looking up internalId here.
export interface CatalogEntry {
  mitreId: string
  internalId: string
  name: string
  description?: string | null
  tactic?: string | null
  kind: MitreKind
}

// Per-(kind, query) match results live here. Empty string query is used by the
// picker for "no input — show recents" mode (results map miss intentional).
const keyOf = (kind: MitreKind, query: string): string => `${kind}:${query}`

const handleApiError = (err: Error, operation: string): string => {
  console.error(`Error in ${operation}:`, err)
  if (err.message.includes('401')) return 'Please log in again'
  if (err.message.includes('403')) return 'Access denied'
  if (err.message.includes('404')) return 'Not found'
  if (err.message.includes('network')) return 'Connection failed'
  return `Failed to ${operation}. Please try again.`
}

export const useTechniqueSuggestionsStore = defineStore('techniqueSuggestions', () => {
  const dtMitre = new DtMitre(apolloClient)
  const dtMitreAttack = new DtMitreAttack(apolloClient)
  const dtMitreDefend = new DtMitreDefend(apolloClient)

  // Vector-tier match results, keyed by `${kind}:${query}`.
  const matchResults = ref<Map<string, MitreCandidate[]>>(new Map())
  // Local-tier hydrated catalog, keyed by MitreKind.
  const catalog = ref<Map<MitreKind, CatalogEntry[]>>(new Map())
  const isCatalogReady = ref<Record<MitreKind, boolean>>({
    ATTACK_TECHNIQUE: false,
    DEFEND_TECHNIQUE: false,
    ATTACK_MITIGATION: false,
  })

  const isLoading = ref<Record<string, boolean>>({})

  // Tri-state: null = unknown (no match call yet), boolean = response said so.
  const vectorAvailable = ref<boolean | null>(null)
  const vectorDisabledReason = ref<VectorDisabledReason | null>(null)

  // Per-op error slots — match vs catalog hydration. A background catalog
  // failure must NOT poison the inline picker's match-error display.
  const matchError = ref<string>('')
  const catalogError = ref<string>('')

  async function matchTechniques({
    kind, query, topN,
  }: { kind: MitreKind, query: string, topN?: number }): Promise<void> {
    const stateKey = keyOf(kind, query)
    const loadingKey = `match:${stateKey}`
    isLoading.value[loadingKey] = true
    matchError.value = ''
    try {
      const result = await dtMitre.matchTechniques({ queries: [query], kind, topN })
      matchResults.value.set(stateKey, result.matches[0]?.candidates ?? [])
      vectorAvailable.value = result.vectorAvailable
      vectorDisabledReason.value = result.vectorDisabledReason ?? null
    } catch (err) {
      if (err instanceof CancelledError) return
      matchError.value = handleApiError(err as Error, 'match techniques')
    } finally {
      isLoading.value[loadingKey] = false
    }
  }

  /**
   * Lazily populate the local-tier catalog for a given MitreKind. Used by
   * synchronous tier-1 matching (EXACT_ID / PREFIX_ID / NAME / DESCRIPTION)
   * and by the "Browse all" sheet.
   *
   * Implementation notes:
   *   - ATTACK_TECHNIQUE: empty filter on the existing `mitreAttackTechniques`
   *     query — returns all technique nodes in one round trip.
   *   - DEFEND_TECHNIQUE: D3FEND has no "fetch all" surface today, so we walk
   *     defend tactics and aggregate. ~7 tactics, fan-out is bounded. The
   *     promise.all keeps total latency at the slowest single-tactic round
   *     trip rather than serial.
   *   - ATTACK_MITIGATION: existing `getMitreAttackMitigations` returns all
   *     mitigation nodes in one round trip.
   *
   * The `tactic` field on catalog entries is populated from:
   *   - ATTACK_TECHNIQUE: the technique's `tactics[0].name` projection
   *     (a single fetch with `tactics { name }` selected — see dt-mitreattack-gql.ts).
   *   - DEFEND_TECHNIQUE: the tactic name from the per-tactic fan-out iteration
   *     (free — we already walked tactics to fetch the techniques).
   *   - ATTACK_MITIGATION: null (mitigations have no tactic; facets hidden).
   * A technique can belong to multiple tactics; the picker uses the first one,
   * mirroring the deterministic-tactic projection used by the backend.
   */
  async function hydrateCatalog(kind: MitreKind): Promise<void> {
    if (isCatalogReady.value[kind]) return
    const loadingKey = `catalog:${kind}`
    isLoading.value[loadingKey] = true
    catalogError.value = ''
    try {
      let entries: CatalogEntry[] = []
      if (kind === 'ATTACK_TECHNIQUE') {
        // Empty filter object matches all MitreAttackTechnique nodes.
        const techniques = await dtMitreAttack.findMitreAttackTechniques({ query: {} })
        entries = (techniques ?? []).map(t => ({
          mitreId: t.attack_id,
          internalId: t.id,
          name: t.name,
          description: t.description ?? null,
          tactic: t.tactics?.[0]?.name ?? null,
          kind: 'ATTACK_TECHNIQUE' as const,
        }))
      } else if (kind === 'DEFEND_TECHNIQUE') {
        // D3FEND: walk all tactics + aggregate. ~7 tactics, bounded fan-out.
        // Use Promise.allSettled so a single tactic-query failure doesn't
        // poison the entire catalog — partial-hydrate is acceptable and the
        // user can still pick from the techniques that did load.
        const tactics = (await dtMitreDefend.fetchMitreDefendTactics()) ?? []
        const settled = await Promise.allSettled(
          tactics.map(tac =>
            dtMitreDefend.getMitreDefendTechniquesByTactic({ tacticId: tac.id }),
          ),
        )
        const failures = settled.filter(s => s.status === 'rejected').length
        if (tactics.length > 0 && failures === tactics.length) {
          // Total failure: allSettled swallows the rejections, so without this the catalog
          // would be marked permanently ready with zero entries (the isCatalogReady guard
          // then blocks every retry for the session). Throw so the catch below sets
          // catalogError and leaves isCatalogReady false — retryable, like the ATTACK paths.
          throw new Error(
            `Failed to load the D3FEND technique catalog (${failures}/${tactics.length} tactic queries failed).`,
          )
        }
        if (failures > 0) {
          // Partial failure — catalog is still marked ready with the entries that loaded.
          // Operator sees the warning but the picker remains usable.
          console.warn(
            `techniqueSuggestionsStore.hydrateCatalog(DEFEND_TECHNIQUE): ${failures}/${tactics.length} tactic-queries failed; catalog is partial`,
          )
        }
        // Dedup by d3fendId — a defend technique can belong to multiple tactics.
        // First-seen wins for the `tactic` field (matches the deterministic-
        // tactic projection convention).
        //
        // Recurse through subTechniques: D3FEND techniques are hierarchical
        // (e.g. D3-MFA has children like D3-MFA-001) and existing countermeasures
        // can connect a leaf node directly. Without recursion the catalog
        // misses those leaves — names disappear and save fails the
        // mitreIdsToInternalLookup guard.
        const seen = new Set<string>()
        const walk = (
          nodes: ReadonlyArray<{
            id: string
            d3fendId: string
            name: string
            description?: string | null
            subTechniques?: ReadonlyArray<unknown> | null
          }>,
          tacticName: string | null,
        ): void => {
          for (const t of nodes) {
            if (!t.d3fendId || seen.has(t.d3fendId)) continue
            seen.add(t.d3fendId)
            entries.push({
              mitreId: t.d3fendId,
              internalId: t.id,
              name: t.name,
              description: t.description ?? null,
              tactic: tacticName,
              kind: 'DEFEND_TECHNIQUE',
            })
            const subs = t.subTechniques
            if (Array.isArray(subs) && subs.length > 0) {
              walk(subs as Parameters<typeof walk>[0], tacticName)
            }
          }
        }
        for (let i = 0; i < settled.length; i++) {
          const result = settled[i]
          if (result.status !== 'fulfilled' || !result.value) continue
          walk(result.value as Parameters<typeof walk>[0], tactics[i]?.name ?? null)
        }
      } else if (kind === 'ATTACK_MITIGATION') {
        const mitigations = await dtMitreAttack.getMitreAttackMitigations()
        entries = (mitigations ?? []).map(m => ({
          mitreId: m.attack_id,
          internalId: m.id,
          name: m.name,
          description: m.description ?? null,
          tactic: null,
          kind: 'ATTACK_MITIGATION' as const,
        }))
      }
      catalog.value.set(kind, entries)
      isCatalogReady.value[kind] = true
    } catch (err) {
      if (err instanceof CancelledError) return
      catalogError.value = handleApiError(err as Error, 'hydrate technique catalog')
    } finally {
      isLoading.value[loadingKey] = false
    }
  }

  return {
    matchResults: readonly(matchResults),
    catalog: readonly(catalog),
    isCatalogReady: readonly(isCatalogReady),
    isLoading: readonly(isLoading),
    vectorAvailable: readonly(vectorAvailable),
    vectorDisabledReason: readonly(vectorDisabledReason),
    matchError: readonly(matchError),
    catalogError: readonly(catalogError),
    matchTechniques,
    hydrateCatalog,
  }
})
