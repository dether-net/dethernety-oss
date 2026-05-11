import { computed, readonly, ref } from 'vue'
import { defineStore } from 'pinia'
import { DtClassIdentity, ClassIdentityEvent } from '@dethernety/dt-core'
import apolloClient from '@/plugins/apolloClient'

export type EventKindFilter = 'all' | 'rebind' | 'errors' | 'orphan-revive' | 'collision'

export interface EventFilter {
  kind: EventKindFilter
  moduleName?: string
  since?: string
}

const DEFAULT_FILTER: EventFilter = { kind: 'all' }

export const useClassIdentityStore = defineStore('classIdentity', () => {
  const events = ref<ClassIdentityEvent[]>([])
  const filter = ref<EventFilter>({ ...DEFAULT_FILTER })
  const isLoading = ref(false)
  const error = ref('')
  const lastFetch = ref(0)

  const dtClassIdentity = new DtClassIdentity(apolloClient)

  const handleApiError = (err: Error, operation: string): string => {
    console.error(`Error in ${operation}:`, err)
    if (err.message.includes('401')) return 'Please log in again'
    if (err.message.includes('403')) return 'Access denied'
    if (err.message.includes('network')) return 'Connection failed'
    return `Failed to ${operation}. Please try again.`
  }

  // 'errors' (rebind-conflict + collision) is a client-side composite. Server
  // queries one kind per call, so for 'errors' we fetch unfiltered and filter
  // client-side — cheaper than two round-trips and the 1000-event cap keeps
  // payload bounded.
  const filteredEvents = computed<ClassIdentityEvent[]>(() => {
    if (filter.value.kind !== 'errors') return events.value
    return events.value.filter(
      (e) => e.kind === 'rebind-conflict' || e.kind === 'collision'
    )
  })

  const fetchEvents = async (): Promise<ClassIdentityEvent[]> => {
    try {
      isLoading.value = true
      error.value = ''

      // Map the composite filter onto the server filter args.
      const serverKind =
        filter.value.kind === 'all' || filter.value.kind === 'errors'
          ? undefined
          : filter.value.kind === 'orphan-revive'
            ? undefined // composite — fetch all and filter client-side
            : filter.value.kind

      const results = await dtClassIdentity.getClassIdentityEvents({
        kind: serverKind,
        moduleName: filter.value.moduleName,
        since: filter.value.since
      })

      // Apply orphan-revive composite client-side (server lacks 'orphan|revive').
      let final = results
      if (filter.value.kind === 'orphan-revive') {
        final = results.filter((e) => e.kind === 'orphan' || e.kind === 'revive')
      }

      events.value = final
      lastFetch.value = Date.now()
      return final
    } catch (err) {
      error.value = handleApiError(err as Error, 'fetch class-identity events')
      return events.value
    } finally {
      isLoading.value = false
    }
  }

  const setKindFilter = (kind: EventKindFilter): void => {
    filter.value.kind = kind
  }

  const setModuleFilter = (moduleName: string | undefined): void => {
    filter.value.moduleName = moduleName || undefined
  }

  const setSinceFilter = (since: string | undefined): void => {
    filter.value.since = since || undefined
  }

  const clearFilter = (): void => {
    filter.value = { ...DEFAULT_FILTER }
  }

  const resetStore = (): void => {
    events.value = []
    filter.value = { ...DEFAULT_FILTER }
    isLoading.value = false
    error.value = ''
    lastFetch.value = 0
  }

  return {
    // State
    events: readonly(events),
    filteredEvents,
    filter: readonly(filter),
    isLoading: readonly(isLoading),
    error: readonly(error),
    lastFetch: readonly(lastFetch),

    // Actions
    fetchEvents,
    setKindFilter,
    setModuleFilter,
    setSinceFilter,
    clearFilter,
    resetStore,

    // Utils
    clearError: () => (error.value = '')
  }
})
