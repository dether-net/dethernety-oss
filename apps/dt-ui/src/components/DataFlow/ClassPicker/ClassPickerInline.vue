<script setup lang="ts">
  import { ref, computed, toRef, watch, onBeforeUnmount } from 'vue'
  import { useClassSuggestionsStore, type ClassCandidate } from '@/stores/classSuggestionsStore'
  import { useRecentClasses, type ClassRecord } from '@/composables/useRecentClasses'
  import ClassPickerResults from './ClassPickerResults.vue'

  interface Props {
    modelValue: string | null
    classLabel: 'COMPONENT' | 'DATA_FLOW' | 'DATA' | 'SECURITY_BOUNDARY' | 'CONTROL'
    componentType?: 'PROCESS' | 'STORE' | 'EXTERNAL_ENTITY' | null
    elementName: string
    elementDescription: string
    modelId: string | undefined
    disabled?: boolean
    label?: string
  }
  const props = withDefaults(defineProps<Props>(), {
    componentType: null,
    disabled: false,
    label: 'Class',
  })

  const emit = defineEmits<{
    'commit-request': [{ classId: string }]
    'picker:focus': []
    'picker:blur': []
    'picker:sheet-open': [{ search: string }]
  }>()

  const store = useClassSuggestionsStore()
  const { recent } = useRecentClasses(
    toRef(props, 'modelId'),
    toRef(props, 'classLabel'),
    toRef(props, 'componentType'),
  )

  const FOOTER_SENTINEL = Symbol('browse-all-footer')
  type FocusableItem = ClassCandidate | ClassRecord | typeof FOOTER_SENTINEL

  // Ref to the wrapper div — v-menu uses it as the positioning anchor (`target`).
  // We deliberately do NOT use `activator="parent"` here: that wires the parent
  // div's click to a toggle, which fights with our explicit `menuOpen` control
  // in onFocus (single click would briefly open then immediately close the menu).
  const rootEl = ref<HTMLElement | null>(null)
  // `searchQuery` allows null because Vuetify's `clearable` X emits null, not ''.
  const searchQuery = ref<string | null>('')
  const menuOpen = ref(false)
  const currentResults = ref<ClassCandidate[]>([])
  const focusedIndex = ref<number | null>(null)
  const clickInsideMenu = ref(false)
  let hasFocusedOnce = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let blurTimer: ReturnType<typeof setTimeout> | null = null

  const stateKey = computed(() => `${props.classLabel}:${props.componentType ?? '_'}`)
  const loadingKey = computed(() => `match:${stateKey.value}`)
  const isLoading = computed(() => Boolean(store.isLoading[loadingKey.value]))
  const hasError = computed(() => Boolean(store.matchError))

  // When no search query, "Suggested for this element" is only meaningful
  // when the element has enough signal (name >= 3 chars or any description).
  const hasSuggestionSignal = computed(
    () => props.elementName.length >= 3 || props.elementDescription !== '',
  )

  // Pure type_match tier renders under "All classes of this type"
  // (ClassPickerResults' own header). The picker's "Suggested for this element"
  // header would double up — suppress it in that case.
  const isPureTypeMatch = computed(
    () =>
      currentResults.value.length > 0 &&
      currentResults.value.every(c => c.matchType === 'type_match'),
  )

  const flattened = computed<FocusableItem[]>(() => {
    const candidates = searchQuery.value
      ? [...currentResults.value]
      : [...recent.value, ...currentResults.value]
    return [...candidates, FOOTER_SENTINEL]
  })

  const isFooterFocused = computed(() => {
    if (focusedIndex.value === null) return false
    return flattened.value[focusedIndex.value] === FOOTER_SENTINEL
  })

  const showVectorUnavailableCaption = computed(
    () =>
      !isLoading.value &&
      !hasError.value &&
      store.vectorAvailable === false &&
      props.elementDescription !== '',
  )
  const showDescriptionEmptyCaption = computed(
    () =>
      !isLoading.value &&
      !hasError.value &&
      store.vectorAvailable === true &&
      props.elementDescription === '',
  )

  async function fetchForCurrentInput() {
    const name = searchQuery.value || props.elementName
    if (!name) {
      currentResults.value = []
      return
    }
    // Skip suggestion fetch when the element has insufficient signal.
    if (!searchQuery.value && !hasSuggestionSignal.value) {
      currentResults.value = []
      return
    }
    const topN = searchQuery.value ? 8 : 6
    await store.matchClasses({
      elements: [{ name, description: props.elementDescription }],
      classLabel: props.classLabel,
      ...(props.componentType ? { componentType: props.componentType } : {}),
      topN,
      fields: ['description', 'category', 'type'],
    })
    currentResults.value = [...(store.matchResults.get(stateKey.value) ?? [])]
    // Auto-focus only for high-signal name-based tiers.
    // vector_similarity must NOT auto-focus (avoid biasing the user toward
    // low-confidence picks). type_match falls through to null too — the
    // child renders an alphabetical browse list there.
    const shouldAutoFocus =
      currentResults.value.length > 0 &&
      currentResults.value.every(
        c => c.matchType === 'exact_name' || c.matchType === 'fuzzy_name',
      )
    focusedIndex.value = shouldAutoFocus ? 0 : null
  }

  watch(searchQuery, () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      fetchForCurrentInput()
    }, 300)
  })

  watch(
    () => [props.elementName, props.elementDescription],
    () => {
      hasFocusedOnce = false
    },
  )

  function onFocus() {
    emit('picker:focus')
    menuOpen.value = true
    if (!hasFocusedOnce) {
      hasFocusedOnce = true
      fetchForCurrentInput()
    }
  }

  function onBlur() {
    // Reentrancy guard: fast blur→focus→blur (<150ms) would otherwise queue
    // two pending timeouts, both firing 'picker:blur' once the window passes.
    if (blurTimer) clearTimeout(blurTimer)
    blurTimer = setTimeout(() => {
      if (!clickInsideMenu.value) {
        menuOpen.value = false
        emit('picker:blur')
      }
      clickInsideMenu.value = false
    }, 150)
  }

  function onMenuMousedown() {
    clickInsideMenu.value = true
  }

  function onSelectCandidate(candidate: ClassCandidate | ClassRecord) {
    emit('commit-request', { classId: candidate.classId })
    menuOpen.value = false
    searchQuery.value = ''
    currentResults.value = []
    focusedIndex.value = null
    hasFocusedOnce = false
  }

  function onFooterActivate() {
    emit('picker:sheet-open', { search: searchQuery.value ?? '' })
    menuOpen.value = false
  }

  function onKeydown(e: KeyboardEvent) {
    const len = flattened.value.length
    if (!menuOpen.value || len === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusedIndex.value = focusedIndex.value === null ? 0 : (focusedIndex.value + 1) % len
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusedIndex.value = focusedIndex.value === null ? len - 1 : (focusedIndex.value - 1 + len) % len
    } else if (e.key === 'Enter' && focusedIndex.value !== null) {
      e.preventDefault()
      const item = flattened.value[focusedIndex.value]
      if (item === FOOTER_SENTINEL) {
        onFooterActivate()
      } else {
        onSelectCandidate(item as ClassCandidate | ClassRecord)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      menuOpen.value = false
    }
  }

  function retry() {
    fetchForCurrentInput()
  }

  onBeforeUnmount(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (blurTimer) clearTimeout(blurTimer)
  })
</script>

<template>
  <div ref="rootEl" class="class-picker-inline">
    <v-text-field
      v-model="searchQuery"
      density="compact"
      :disabled="disabled"
      hide-details
      :label="label"
      placeholder="Type to search the catalogue"
      prepend-inner-icon="mdi-magnify"
      @blur="onBlur"
      @focus="onFocus"
      @keydown="onKeydown"
    />
    <v-menu
      v-model="menuOpen"
      :close-on-content-click="false"
      location="bottom start"
      :target="rootEl ?? undefined"
    >
      <v-list class="class-picker-menu" density="compact" @mousedown="onMenuMousedown">
        <template v-if="isLoading">
          <v-skeleton-loader v-for="i in 3" :key="`sk-${i}`" type="list-item" />
        </template>
        <template v-else-if="hasError">
          <v-list-item class="error-row">
            <v-list-item-title class="text-disabled">Couldn't load suggestions.</v-list-item-title>
            <template #append>
              <v-btn class="retry-btn" size="small" variant="text" @click="retry">Retry</v-btn>
            </template>
          </v-list-item>
        </template>
        <template v-else>
          <template v-if="!searchQuery">
            <template v-if="recent.length">
              <div class="text-caption text-disabled px-4 py-2 recent-header">
                Recently used in this model
              </div>
              <v-list-item
                v-for="(rec, idx) in recent"
                :key="rec.classId"
                :class="{ 'v-list-item--active': focusedIndex === idx }"
                @click="onSelectCandidate(rec)"
              >
                <v-list-item-title>{{ rec.className }}</v-list-item-title>
                <v-list-item-subtitle v-if="rec.classCategory || rec.moduleName">
                  {{ [rec.classCategory, rec.moduleName].filter(Boolean).join(' · ') }}
                </v-list-item-subtitle>
              </v-list-item>
            </template>
            <template v-if="currentResults.length">
              <div
                v-if="!isPureTypeMatch"
                class="text-caption text-disabled px-4 py-2 suggested-header"
              >
                Suggested for this element
              </div>
              <ClassPickerResults :candidates="currentResults" @select="onSelectCandidate" />
            </template>
            <div
              v-if="!recent.length && !currentResults.length"
              class="text-caption text-disabled px-4 py-2 empty-prompt"
            >
              Type to search, or browse all classes.
            </div>
          </template>
          <template v-else>
            <ClassPickerResults :candidates="currentResults" @select="onSelectCandidate" />
          </template>
        </template>
        <div
          v-if="showVectorUnavailableCaption"
          class="text-caption text-disabled px-4 py-2 vector-unavailable-caption"
        >
          Semantic search is unavailable on this deployment — showing name-based matches.
        </div>
        <div
          v-if="showDescriptionEmptyCaption"
          class="text-caption text-disabled px-4 py-2 description-empty-caption"
        >
          Add a description above to get semantic suggestions.
        </div>
        <v-divider />
        <v-list-item
          class="browse-all-footer"
          :class="{ 'v-list-item--active': isFooterFocused }"
          @click="onFooterActivate"
        >
          <template #prepend>
            <v-icon icon="mdi-format-list-bulleted" size="small" />
          </template>
          <v-list-item-title>Browse all classes →</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>
