<script setup lang="ts">
  import { ref, computed, toRef, watch } from 'vue'
  import type { MitreKind } from '@dethernety/dt-core'
  import { useTechniqueSuggestionsStore } from '@/stores/techniqueSuggestionsStore'
  import { useRecentTechniques } from '@/composables/useRecentTechniques'
  import TechniquePickerChips from './TechniquePickerChips.vue'
  import TechniquePickerInline from './TechniquePickerInline.vue'
  import TechniquePickerSheet from './TechniquePickerSheet.vue'

  /**
   * Wrapper component for the MITRE technique picker family.
   *
   * Multi-bind via `v-model: string[]` (array of mitreIds). The wrapper composes:
   *   1. TechniquePickerChips — selected chips with X-remove + body-click → detail dialog
   *   2. TechniquePickerInline — typeahead input + dropdown
   *   3. TechniquePickerSheet — "Browse all" drawer
   *
   * Recents push happens on each commit (mitreId + name + tactic) via
   * `useRecentTechniques` (model-id + kind scoped).
   */

  interface Props {
    modelValue: string[]
    kind: MitreKind
    modelId: string | undefined
    disabled?: boolean
    label?: string
  }
  const props = withDefaults(defineProps<Props>(), {
    disabled: false,
    label: undefined,
  })

  const emit = defineEmits<{
    'update:modelValue': [ids: string[]]
    'picker:focus': []
    'picker:blur': []
    'picker:sheet-open': [{ search: string }]
    'picker:sheet-close': []
    'commit-request': [{ mitreId: string }]
  }>()

  const store = useTechniqueSuggestionsStore()
  const { push } = useRecentTechniques(toRef(props, 'modelId'), toRef(props, 'kind'))

  // Map from mitreId → name, sourced from the hydrated catalog. Used by the
  // chip row to render full labels (vs ID-only skeletons before hydration).
  const nameById = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    const entries = store.catalog.get(props.kind) ?? []
    for (const e of entries) out[e.mitreId] = e.name
    return out
  })

  // Kind-aware label default.
  const labelText = computed<string>(() => {
    if (props.label) return props.label
    switch (props.kind) {
      case 'ATTACK_TECHNIQUE': return 'ATT&CK Techniques'
      case 'DEFEND_TECHNIQUE': return 'D3FEND Techniques'
      case 'ATTACK_MITIGATION': return 'ATT&CK Mitigations'
      default: return ''
    }
  })

  // Hydrate catalog on mount so chip labels populate even before the user
  // focuses the input. Idempotent — store no-ops if catalog is ready.
  watch(() => props.kind, kind => {
    void store.hydrateCatalog(kind)
  }, { immediate: true })

  const sheetOpen = ref(false)
  const inlineSearchAtOpen = ref('')

  function onCommit(payload: { mitreId: string; name?: string; tactic?: string | null }): void {
    if (props.disabled) return
    if (props.modelValue.includes(payload.mitreId)) return // dedup
    const next = [...props.modelValue, payload.mitreId]
    emit('update:modelValue', next)
    emit('commit-request', { mitreId: payload.mitreId })
    // Record in recents — best-effort (composable defers if modelId undefined).
    push({
      mitreId: payload.mitreId,
      name: payload.name ?? nameById.value[payload.mitreId] ?? payload.mitreId,
      tactic: payload.tactic ?? null,
      kind: props.kind,
    })
  }

  function onRemove(mitreId: string): void {
    if (props.disabled) return
    emit('update:modelValue', props.modelValue.filter(id => id !== mitreId))
  }

  function onInlineSheetOpen(payload: { search: string }): void {
    inlineSearchAtOpen.value = payload?.search ?? ''
    sheetOpen.value = true
    emit('picker:sheet-open', { search: payload.search })
  }

  function onSheetUpdate(open: boolean): void {
    if (sheetOpen.value && !open) {
      sheetOpen.value = false
      emit('picker:sheet-close')
    } else {
      sheetOpen.value = open
    }
  }

  // Imperative seed entry point — forwards to the inline picker so the host
  // dialog's "Suggest matches" link can seed the search box with the
  // exposure / countermeasure name + description and trigger the vector tier.
  const inlineRef = ref<{ seedSearch: (text: string) => Promise<void> } | null>(null)
  async function seedSearch(text: string): Promise<void> {
    await inlineRef.value?.seedSearch(text)
  }

  defineExpose({ seedSearch })
</script>

<template>
  <div class="technique-picker">
    <div class="text-caption text-disabled mb-1">{{ labelText }}</div>

    <TechniquePickerChips
      :mitre-ids="modelValue"
      :kind="kind"
      :name-by-id="nameById"
      :disabled="disabled"
      @remove="onRemove"
    />

    <TechniquePickerInline
      ref="inlineRef"
      :kind="kind"
      :selected-mitre-ids="modelValue"
      :model-id="modelId"
      :disabled="disabled"
      :label="labelText"
      @commit-request="onCommit"
      @picker:focus="emit('picker:focus')"
      @picker:blur="emit('picker:blur')"
      @picker:sheet-open="onInlineSheetOpen"
    />

    <TechniquePickerSheet
      :model-value="sheetOpen"
      :kind="kind"
      :initial-search="inlineSearchAtOpen"
      :selected-mitre-ids="modelValue"
      @update:model-value="onSheetUpdate"
      @commit-request="onCommit"
    />
  </div>
</template>
