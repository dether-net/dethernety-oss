<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
  import type { ContentIndex } from '@dethernety/dt-core'
  import { useFolderStore } from '@/stores/folderStore'
  import { pathText, searchContent, type BrowserSearchResult } from '@/utils/browserSearch'

  // The Browser's search: models and controls by name, across every folder, in the Browser's header between the
  // breadcrumbs and the folder buttons. The page opens what is picked (`open`: a model in the editor, a control in its
  // dialog) or goes to its folder (`show`, Alt+Enter or the row's folder icon).
  //
  // The index (id, name and folder of every model and control) is fetched each time the field gains the focus, and the
  // folders with it, so what was created, renamed or moved since, here or elsewhere, is found and placed; the last
  // index stays in use while the next one loads. A text
  // field with a list of its own, as the canvas search has (components/DataFlow/CanvasSearch.vue): the query outlives
  // the field's focus, and the list follows the combobox pattern.
  //
  // `compact` (a narrow window) shows only a magnifier button; it opens the field, which folds back into the button
  // when it loses the focus with nothing typed.

  const props = defineProps<{
    compact?: boolean
  }>()

  const emit = defineEmits<{
    open: [result: BrowserSearchResult]
    show: [result: BrowserSearchResult]
  }>()

  const LIST_LIMIT = 50
  const LIST_ID = 'dt-browser-search-results'
  const optionId = (index: number) => `${LIST_ID}-${index}`

  const ICONS = { model: 'mdi-vector-polyline', control: 'mdi-shield-sword-outline' } as const
  const LABELS = { model: 'Model', control: 'Control' } as const

  const folderStore = useFolderStore()

  const query = ref('')
  // The field's clear button sets its value to null; the search's text is always a string.
  const fieldText = computed({
    get: () => query.value,
    set: (text: string | null) => { query.value = text ?? '' },
  })
  const active = ref(0)
  const focused = ref(false)
  const expanded = ref(false)
  const field = ref<{ focus: () => void } | null>(null)

  const index = ref<ContentIndex | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  let fetchGen = 0

  const refresh = async () => {
    const gen = ++fetchGen
    loading.value = true
    const [result] = await Promise.all([folderStore.fetchContentIndex(), folderStore.fetchFolders({ quiet: true })])
    if (gen !== fetchGen) return
    loading.value = false
    failed.value = result === null
    if (result) index.value = result
  }

  const hasQuery = computed(() => query.value.trim() !== '')
  const results = computed(() => (index.value ? searchContent(query.value, index.value, folderStore.folders) : []))
  const listed = computed(() => results.value.slice(0, LIST_LIMIT))
  const showList = computed(() => focused.value && hasQuery.value)
  const showField = computed(() => !props.compact || expanded.value)

  // The list is drawn in the app's root, under the field (fixed, placed from the field's box), not inside the header:
  // the folders card clips what overflows it and is translucent, and the content below it paints over it. It stays
  // inside the app element for the theme. Where there is no app element (a unit test), it renders in place. It is placed
  // again on resize and on any scroll while it shows, so that it stays under the field.
  const anchor = ref<HTMLElement | null>(null)
  const listStyle = ref<Record<string, string>>({})
  const APP_ROOT = '.v-application'
  const inApp = typeof document !== 'undefined' && document.querySelector(APP_ROOT) !== null
  const place = () => {
    const box = anchor.value?.getBoundingClientRect()
    // A fixed element's `right` counts from the viewport's edge without the scrollbar, as clientWidth does.
    if (box) listStyle.value = { top: `${box.bottom + 4}px`, right: `${document.documentElement.clientWidth - box.right}px` }
  }
  const SCROLL = { capture: true, passive: true } as const
  const stopPlacing = () => {
    window.removeEventListener('resize', place)
    window.removeEventListener('scroll', place, SCROLL)
  }
  watch(showList, shown => {
    if (shown) {
      nextTick(place)
      window.addEventListener('resize', place)
      window.addEventListener('scroll', place, SCROLL)
    } else {
      stopPlacing()
    }
  })
  onBeforeUnmount(stopPlacing)

  watch(query, () => { active.value = 0 })
  watch(listed, list => { if (active.value >= list.length) active.value = 0 })
  watch(active, i => {
    nextTick(() => document.getElementById(optionId(i))?.scrollIntoView?.({ block: 'nearest' }))
  })
  // Back to full width: the field is always there, so nothing stays "expanded". Narrowed while in use: the field stays
  // open, as the magnifier would have opened it; removing a focused field sends no blur, which would leave the list up.
  watch(() => props.compact, compact => {
    if (!compact) expanded.value = false
    else if (focused.value || hasQuery.value) expanded.value = true
  })

  const onFocused = (isFocused: boolean) => {
    focused.value = isFocused
    if (isFocused) refresh()
    else if (props.compact && !hasQuery.value) expanded.value = false
  }

  const expand = () => {
    expanded.value = true
    nextTick(() => field.value?.focus())
  }

  const open = (result: BrowserSearchResult | undefined) => { if (result) emit('open', result) }
  // Leaves the field, so that the list folds away from the tile the page points at; the query stays for the next look.
  const show = (result: BrowserSearchResult | undefined) => {
    if (!result) return
    emit('show', result)
    ;(anchor.value?.querySelector('input') as HTMLInputElement | null)?.blur()
  }

  const onKeydown = (e: KeyboardEvent) => {
    // Keys that confirm, move through or cancel an input method's composition belong to it (Safari reports them as 229).
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      e.preventDefault()
      if (hasQuery.value) query.value = ''
      else (e.target as HTMLElement | null)?.blur?.()
      return
    }
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
      if (e.altKey) show(listed.value[active.value])
      else open(listed.value[active.value])
    }
  }
</script>

<template>
  <div ref="anchor" class="browser-search" @keydown="onKeydown">
    <v-btn
      v-if="!showField"
      v-tooltip:bottom="'Search models and controls'"
      aria-label="Search models and controls"
      class="mx-1"
      color="secondary"
      elevation="12"
      icon="mdi-magnify"
      size="x-large"
      variant="outlined"
      @click="expand"
    />
    <v-text-field
      v-else
      ref="field"
      v-model="fieldText"
      :aria-activedescendant="showList && listed.length ? optionId(active) : undefined"
      aria-autocomplete="list"
      :aria-controls="LIST_ID"
      :aria-expanded="showList"
      aria-label="Search models and controls"
      autocomplete="off"
      class="browser-search-field"
      clearable
      density="compact"
      persistent-clear
      hide-details
      placeholder="Search models and controls"
      prepend-inner-icon="mdi-magnify"
      role="combobox"
      variant="outlined"
      @update:focused="onFocused"
    />

    <Teleport :disabled="!inApp" :to="APP_ROOT">
    <v-sheet v-if="showList" class="browser-search-results" elevation="8" rounded :style="listStyle">
      <template v-if="listed.length">
        <v-list :id="LIST_ID" density="compact" role="listbox">
          <!-- mousedown.prevent keeps the focus in the field, so the list is still there when the click lands. -->
          <v-list-item
            v-for="(result, i) in listed"
            :id="optionId(i)"
            :key="`${result.kind}-${result.id}`"
            :active="i === active"
            :aria-selected="i === active"
            class="browser-search-option"
            role="option"
            :title="result.name"
            @click="open(result)"
            @mousedown.prevent
            @mouseenter="active = i"
          >
            <template #prepend>
              <v-icon :icon="ICONS[result.kind]" size="small" />
            </template>
            <!-- A deep path shows as Home / … / the last two, as the header's trail does; the whole path on hover. -->
            <template #subtitle>
              <span :title="pathText(result.path, true)">{{ pathText(result.path) }}</span>
            </template>
            <template #append>
              <span class="text-caption text-medium-emphasis mx-3">{{ LABELS[result.kind] }}</span>
              <!-- Alt+Enter does the same from the keyboard (the hint below the list says so). -->
              <v-icon
                aria-hidden="true"
                class="browser-search-show"
                icon="mdi-folder-search-outline"
                size="small"
                title="Show in folder"
                @click.stop="show(result)"
              />
            </template>
          </v-list-item>
        </v-list>
        <div class="browser-search-hint px-4 py-1 text-caption text-medium-emphasis">
          Enter opens · Alt+Enter shows it in its folder
        </div>
      </template>
      <div v-else-if="!index && loading" class="browser-search-empty pa-3 text-body-2 text-medium-emphasis">Searching…</div>
      <div v-else-if="!index && failed" class="browser-search-empty pa-3 text-body-2 text-medium-emphasis">
        The search is unavailable right now. Click into the field to try again.
      </div>
      <div v-else class="browser-search-empty pa-3 text-body-2 text-medium-emphasis">No matches</div>
    </v-sheet>
    </Teleport>
  </div>
</template>

<style scoped>
.browser-search {
  position: relative;
  flex: 0 0 auto;
}

.browser-search-field {
  width: 320px;
}

/* Under the field and right-aligned with it (top and right come from the field's box), over the page; below
   Vuetify's overlays (dialogs, menus: z-index 2000 and up), above the app's navigation drawer. */
.browser-search-results {
  position: fixed;
  z-index: 1500;
  width: 440px;
  max-height: 420px;
  overflow-y: auto;
}

.browser-search-show {
  cursor: pointer;
  opacity: 0.75;
}

.browser-search-show:hover {
  opacity: 1;
}
</style>
