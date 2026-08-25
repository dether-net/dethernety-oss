import { ref, readonly, watchEffect, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useAuthStore } from '@/stores/authStore'

export interface ClassRecord {
  classId: string
  className: string
  classCategory?: string | null
  moduleName?: string
}

const MAX_RECENT = 8

// Bucketed by componentType as well as classLabel: a ComponentClass is bound to
// exactly one type, so PROCESS / STORE / EXTERNAL_ENTITY must not share a recents
// list — otherwise the picker offers, and lets the user assign, a class whose type
// contradicts the element. Bucketing rather than filtering a shared list also
// keeps each type its own MRU slots instead of letting a busy type crowd out the
// others. `_` stands in for the labels that have no component type
// (DATA_FLOW / DATA / SECURITY_BOUNDARY / CONTROL), matching the `stateKey`
// convention the pickers already use.
const storageKey = (
  userId: string,
  modelId: string,
  classLabel: string,
  componentType: string | null,
): string =>
  `recentClasses:${userId}:${modelId}:${classLabel}:${componentType ?? '_'}`

const readStorage = (key: string): ClassRecord[] => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function useRecentClasses(
  modelId: MaybeRefOrGetter<string | undefined>,
  classLabel: MaybeRefOrGetter<string>,
  componentType: MaybeRefOrGetter<string | null | undefined> = null,
): { recent: Readonly<Ref<ClassRecord[]>>; push: (record: ClassRecord) => void; clear: () => void } {
  const authStore = useAuthStore()
  const recent = ref<ClassRecord[]>([])

  const currentKey = (): string | null => {
    const m = toValue(modelId)
    const l = toValue(classLabel)
    if (!m || !l) return null
    const userId = authStore.user?.id ?? 'anonymous'
    return storageKey(userId, m, l, toValue(componentType) ?? null)
  }

  watchEffect(() => {
    const key = currentKey()
    recent.value = key ? readStorage(key) : []
  })

  function push(record: ClassRecord): void {
    const key = currentKey()
    if (!key) return
    const next = [record, ...recent.value.filter(r => r.classId !== record.classId)].slice(0, MAX_RECENT)
    recent.value = next
    localStorage.setItem(key, JSON.stringify(next))
  }

  function clear(): void {
    const key = currentKey()
    if (!key) return
    recent.value = []
    localStorage.removeItem(key)
  }

  return { recent: readonly(recent) as Readonly<Ref<ClassRecord[]>>, push, clear }
}
