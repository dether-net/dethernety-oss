<script setup lang="ts">
  import { computed, nextTick, ref, watch } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { nodeTypes } from '@/utils/dataFlowUtils'
  import { searchCanvas, type CanvasSearchResult } from '@/utils/flowSearch'

  // The canvas search: type a name, the canvas lights what matches (DataFlow.vue, through `matches`), and picking a
  // result hands it to the editor (`pick`), which selects and frames it. Esc or the close icon closes it and leaves the
  // selection as it was.
  //
  // A text field with a list of its own, not v-autocomplete: the autocomplete owns its search text as part of picking a
  // value (it clears it on blur and sets it to the picked title), while here the query must outlive the field's focus,
  // so that the matches stay lit while the canvas is panned or a match is clicked. Leaving the field hides the list
  // only; clicking back into it shows the list again. The list follows the combobox pattern: the input owns the
  // keyboard and points at the active option through aria-activedescendant.

  const props = defineProps<{
    modelValue: boolean
    nodes: Node[]
    edges: Edge[]
    rootLabel: string
  }>()

  const emit = defineEmits<{
    'update:modelValue': [open: boolean]
    /** Every match while the search is open with a query; null otherwise, so the canvas goes back to the selection. */
    'matches': [matches: CanvasSearchResult[] | null]
    'pick': [result: CanvasSearchResult]
  }>()

  /** The list shows the best matches; the canvas lights all of them. */
  const LIST_LIMIT = 50
  const LIST_ID = 'dt-canvas-search-results'
  const optionId = (index: number) => `${LIST_ID}-${index}`

  const ICONS: Record<string, string> = {
    PROCESS: 'mdi-circle-outline',
    STORE: 'mdi-database-outline',
    EXTERNAL_ENTITY: 'mdi-square-outline',
    BOUNDARY: 'mdi-select',
    FLOW: 'mdi-arrow-right',
  }
  const iconOf = (type: string) => ICONS[type] ?? 'mdi-shape-outline'
  const labelOf = (type: string) => (type === 'FLOW' ? 'Data Flow' : nodeTypes[type]?.displayName ?? type)

  const query = ref('')
  const active = ref(0)
  const focused = ref(false)
  const field = ref<{ focus: () => void } | null>(null)

  const hasQuery = computed(() => query.value.trim() !== '')
  const matches = computed(() => searchCanvas(query.value, props.nodes, props.edges, props.rootLabel))
  const listed = computed(() => matches.value.slice(0, LIST_LIMIT))
  const showList = computed(() => focused.value && hasQuery.value)
  const canvasMatches = computed(() => (props.modelValue && hasQuery.value ? matches.value : null))

  watch(canvasMatches, found => emit('matches', found), { immediate: true })
  // However the search opens or closes (Esc, a pick, the editor switching models), it starts again empty.
  watch(() => props.modelValue, () => { query.value = '' })
  watch(query, () => { active.value = 0 })
  // The canvas can change under a kept query (a match deleted or renamed): the active result stays one that is listed.
  watch(listed, list => { if (active.value >= list.length) active.value = 0 })
  watch(active, index => {
    nextTick(() => document.getElementById(optionId(index))?.scrollIntoView?.({ block: 'nearest' }))
  })

  /** Puts the cursor in the field: on opening, and when the search is asked for while it is already open. */
  const focus = () => { nextTick(() => field.value?.focus()) }
  defineExpose({ focus })

  const close = () => emit('update:modelValue', false)

  const pick = (result: CanvasSearchResult | undefined) => {
    if (!result) return
    emit('pick', result)
    close()
  }

  const onKeydown = (e: KeyboardEvent) => {
    // Keys that confirm, move through or cancel an input method's composition belong to it (Safari reports them as 229).
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      // Goes no further: the settings window also listens for Esc on the window, to discard a new element.
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    // The list's keys work only while the list shows, so they do nothing from the close icon or a hidden list.
    if (!showList.value) return
    const count = listed.value.length
    if (e.key === 'ArrowDown' && count) {
      e.preventDefault()
      active.value = (active.value + 1) % count
    } else if (e.key === 'ArrowUp' && count) {
      e.preventDefault()
      active.value = (active.value - 1 + count) % count
    } else if (e.key === 'Enter' && count) {
      e.preventDefault()
      pick(listed.value[active.value])
    }
  }
</script>

<template>
  <div v-if="props.modelValue" class="canvas-search" @keydown="onKeydown">
    <v-text-field
      ref="field"
      v-model="query"
      :aria-activedescendant="showList && listed.length ? optionId(active) : undefined"
      aria-autocomplete="list"
      :aria-controls="LIST_ID"
      :aria-expanded="showList"
      aria-label="Search the canvas"
      autocomplete="off"
      bg-color="surface"
      density="compact"
      hide-details
      placeholder="Search components, boundaries and data flows"
      prepend-inner-icon="mdi-magnify"
      role="combobox"
      variant="solo"
      @update:focused="focused = $event"
    >
      <template #append-inner>
        <v-icon
          aria-label="Close the search"
          class="canvas-search-close"
          icon="mdi-close"
          role="button"
          size="small"
          @click.stop="close"
          @keydown.enter.prevent.stop="close"
          @keydown.space.prevent.stop="close"
        />
      </template>
    </v-text-field>

    <v-sheet v-if="showList" class="canvas-search-results mt-1" elevation="6" rounded>
      <v-list v-if="listed.length" :id="LIST_ID" density="compact" role="listbox">
        <!-- mousedown.prevent keeps the focus in the field, so the list is still there when the click lands. -->
        <v-list-item
          v-for="(result, index) in listed"
          :id="optionId(index)"
          :key="result.id"
          :active="index === active"
          :aria-selected="index === active"
          class="canvas-search-option"
          role="option"
          :subtitle="result.context"
          :title="result.name"
          @click="pick(result)"
          @mousedown.prevent
          @mouseenter="active = index"
        >
          <template #prepend>
            <v-icon :icon="iconOf(result.type)" size="small" />
          </template>
          <template #append>
            <span class="text-caption text-medium-emphasis ml-3">{{ labelOf(result.type) }}</span>
          </template>
        </v-list-item>
      </v-list>
      <div v-else class="canvas-search-empty pa-3 text-body-2 text-medium-emphasis">No matches</div>
    </v-sheet>
  </div>
</template>

<style scoped>
/* Level with the top of the canvas rail (DataFlowBackground.vue, `.canvas-rail`: top 120px, left 80px, z-index 1000),
   just right of it and above it. */
.canvas-search {
  position: fixed;
  top: 120px;
  left: 140px;
  z-index: 1001;
  width: 420px;
}

.canvas-search-results {
  max-height: 360px;
  overflow-y: auto;
}
</style>
