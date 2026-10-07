import type { MitreKind } from '@dethernety/dt-core'

/** D3FEND tactics carry no matrix position; they keep D3FEND's own fixed order. */
const DEFEND_TACTICS_ORDER = ['Model', 'Harden', 'Detect', 'Isolate', 'Deceive', 'Evict', 'Restore']

const KINDS_WITH_TACTICS: ReadonlySet<MitreKind> = new Set(['ATTACK_TECHNIQUE', 'ATLAS_TECHNIQUE', 'DEFEND_TECHNIQUE'])

/**
 * The tactic facets of a set of catalog entries: each tactic present, with its entry count, in
 * matrix order. ATT&CK and ATLAS order by the entry's `tacticOrder` (the matrix position the
 * ingest stamps on every tactic), so a new release (ATT&CK v19 renamed Defense Evasion and added
 * Defense Impairment) reorders the facets without a code change. A tactic without a position goes
 * last, by name. Mitigation kinds have no tactics, hence no facets.
 */
export function tacticFacetsOf(
  entries: ReadonlyArray<{ tactic?: string | null; tacticOrder?: number | null }>,
  kind: MitreKind,
): Array<{ value: string; count: number }> {
  if (!KINDS_WITH_TACTICS.has(kind)) return []
  const facets = new Map<string, { count: number; order: number }>()
  for (const e of entries) {
    if (!e.tactic) continue
    const rank = kind === 'DEFEND_TECHNIQUE' ? DEFEND_TACTICS_ORDER.indexOf(e.tactic) : e.tacticOrder ?? -1
    facets.set(e.tactic, {
      count: (facets.get(e.tactic)?.count ?? 0) + 1,
      order: rank < 0 ? Number.MAX_SAFE_INTEGER : rank,
    })
  }
  return [...facets.entries()]
    .sort(([a, x], [b, y]) => x.order - y.order || a.localeCompare(b))
    .map(([value, { count }]) => ({ value, count }))
}
