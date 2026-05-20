import { ref, readonly, watchEffect, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import type { MitreKind } from '@dethernety/dt-core'

/**
 * MITRE picker's "Recently used in this model" affordance.
 *
 * Verbatim structural mirror of `useRecentClasses` — same auth-scoped
 * localStorage key shape, same MAX_RECENT=8, same MRU prepend-dedup-slice,
 * same defer-until-modelId-defined guard.
 *
 * Storage key: `recentTechniques:${userId}:${modelId}:${kind}`
 *
 * Auth-scoping is a hardening property of the established `useRecentClasses`
 * shape this mirrors, not optional.
 */
export interface TechniqueRecord {
  mitreId: string
  name: string
  tactic?: string | null
  kind: MitreKind
}

const MAX_RECENT = 8

const storageKey = (userId: string, modelId: string, kind: MitreKind): string =>
  `recentTechniques:${userId}:${modelId}:${kind}`

const readStorage = (key: string): TechniqueRecord[] => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function useRecentTechniques(
  modelId: MaybeRefOrGetter<string | undefined>,
  kind: MaybeRefOrGetter<MitreKind>,
): { recent: Readonly<Ref<TechniqueRecord[]>>; push: (record: TechniqueRecord) => void; clear: () => void } {
  const authStore = useAuthStore()
  const recent = ref<TechniqueRecord[]>([])

  const currentKey = (): string | null => {
    const m = toValue(modelId)
    const k = toValue(kind)
    if (!m || !k) return null
    const userId = authStore.user?.id ?? 'anonymous'
    return storageKey(userId, m, k)
  }

  watchEffect(() => {
    const key = currentKey()
    recent.value = key ? readStorage(key) : []
  })

  function push(record: TechniqueRecord): void {
    const key = currentKey()
    if (!key) return
    const next = [record, ...recent.value.filter(r => r.mitreId !== record.mitreId)].slice(0, MAX_RECENT)
    recent.value = next
    localStorage.setItem(key, JSON.stringify(next))
  }

  function clear(): void {
    const key = currentKey()
    if (!key) return
    recent.value = []
    localStorage.removeItem(key)
  }

  return { recent: readonly(recent) as Readonly<Ref<TechniqueRecord[]>>, push, clear }
}
