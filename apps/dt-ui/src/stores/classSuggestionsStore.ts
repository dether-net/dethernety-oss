import { ref, readonly } from 'vue'
import { defineStore } from 'pinia'
import { DtClass, CancelledError } from '@dethernety/dt-core'
import apolloClient from '@/plugins/apolloClient'

type MatchClassesInput = Parameters<DtClass['matchClasses']>[0]
type MatchClassesResult = Awaited<ReturnType<DtClass['matchClasses']>>
export type ClassCandidate = MatchClassesResult['matches'][number]['candidates'][number]

type ListClassesInput = Parameters<DtClass['listClasses']>[0]
export type ListClassesResult = Awaited<ReturnType<DtClass['listClasses']>>

const keyOf = (classLabel: string, componentType?: string): string =>
  `${classLabel}:${componentType ?? '_'}`

const handleApiError = (err: Error, operation: string): string => {
  console.error(`Error in ${operation}:`, err)
  if (err.message.includes('401')) return 'Please log in again'
  if (err.message.includes('403')) return 'Access denied'
  if (err.message.includes('404')) return 'Not found'
  if (err.message.includes('network')) return 'Connection failed'
  return `Failed to ${operation}. Please try again.`
}

export const useClassSuggestionsStore = defineStore('classSuggestions', () => {
  const dtClass = new DtClass(apolloClient)

  const matchResults = ref<Map<string, ClassCandidate[]>>(new Map())
  const listResults = ref<Map<string, ListClassesResult>>(new Map())
  const isLoading = ref<Record<string, boolean>>({})
  const vectorAvailable = ref<boolean | null>(null)
  // Per-op error slots. A single shared slot was poisonable across ops —
  // a background listClasses failure would surface in the inline picker
  // (which only consumes matchClasses results). Consumers read the slot
  // matching the op they drive.
  const matchError = ref<string>('')
  const listError = ref<string>('')

  async function matchClasses(input: MatchClassesInput): Promise<void> {
    const stateKey = keyOf(input.classLabel, input.componentType)
    const loadingKey = `match:${stateKey}`
    isLoading.value[loadingKey] = true
    matchError.value = ''
    try {
      const result = await dtClass.matchClasses(input)
      matchResults.value.set(stateKey, result.matches[0]?.candidates ?? [])
      vectorAvailable.value = result.vectorAvailable
    } catch (err) {
      if (err instanceof CancelledError) return
      matchError.value = handleApiError(err as Error, 'match classes')
    } finally {
      isLoading.value[loadingKey] = false
    }
  }

  async function listClasses(input: ListClassesInput): Promise<void> {
    const stateKey = keyOf(input.classLabel, input.componentType)
    const loadingKey = `list:${stateKey}`
    isLoading.value[loadingKey] = true
    listError.value = ''
    try {
      const result = await dtClass.listClasses(input)
      listResults.value.set(stateKey, result)
    } catch (err) {
      if (err instanceof CancelledError) return
      listError.value = handleApiError(err as Error, 'list classes')
    } finally {
      isLoading.value[loadingKey] = false
    }
  }

  return {
    matchResults: readonly(matchResults),
    listResults: readonly(listResults),
    isLoading: readonly(isLoading),
    vectorAvailable: readonly(vectorAvailable),
    matchError: readonly(matchError),
    listError: readonly(listError),
    matchClasses,
    listClasses,
  }
})
