<script setup lang="ts">
  import { ref, computed, toRef, watch } from 'vue'
  import { useClassSuggestionsStore, type ClassCandidate } from '@/stores/classSuggestionsStore'
  import { useRecentClasses } from '@/composables/useRecentClasses'
  import ClassPickerInline from './ClassPickerInline.vue'
  import ClassPickerSheet from './ClassPickerSheet.vue'
  import ClassPreview from './ClassPreview.vue'

  interface Props {
    modelValue: string | null
    classLabel: 'COMPONENT' | 'DATA_FLOW' | 'DATA' | 'SECURITY_BOUNDARY' | 'CONTROL'
    componentType?: 'PROCESS' | 'STORE' | 'EXTERNAL_ENTITY' | null
    elementName: string
    elementDescription: string
    modelId: string | undefined
    disabled?: boolean
    label?: string
    currentClassName?: string | null
    currentClassCategory?: string | null
    currentClassDescription?: string | null
    currentClassModuleName?: string | null
  }
  const props = withDefaults(defineProps<Props>(), {
    componentType: null,
    disabled: false,
    label: 'Class',
    currentClassName: null,
    currentClassCategory: null,
    currentClassDescription: null,
    currentClassModuleName: null,
  })

  // Assembled ClassPreviewable for the inline ClassPreview card — null when
  // there's no current class (or the class is an unresolved orphan; orphans
  // surface via the dedicated current-class-row above instead).
  const currentClassPreview = computed(() =>
    props.modelValue && props.currentClassName
      ? {
          classId: props.modelValue,
          className: props.currentClassName,
          classCategory: props.currentClassCategory,
          classDescription: props.currentClassDescription,
          moduleName: props.currentClassModuleName ?? '',
        }
      : null,
  )

  const emit = defineEmits<{
    'commit-request': [{ classId: string }]
    'picker:focus': []
    'picker:blur': []
    'picker:sheet-open': [{ search: string }]
    'picker:sheet-close': []
  }>()

  const store = useClassSuggestionsStore()
  const { push } = useRecentClasses(
    toRef(props, 'modelId'),
    toRef(props, 'classLabel'),
    toRef(props, 'componentType'),
  )

  const sheetOpen = ref(false)
  const inlineSearchAtOpen = ref('')

  const stateKey = computed(() => `${props.classLabel}:${props.componentType ?? '_'}`)
  const isOrphan = computed(() => props.modelValue !== null && !props.currentClassName)

  function lookupCandidate(classId: string): ClassCandidate | undefined {
    const matched = store.matchResults.get(stateKey.value)?.find(c => c.classId === classId)
    if (matched) return matched
    return store.listResults.get(stateKey.value)?.items.find(c => c.classId === classId) as
      | ClassCandidate
      | undefined
  }

  function onInlineSheetOpen(payload: { search: string }): void {
    const search = payload?.search ?? ''
    inlineSearchAtOpen.value = search
    sheetOpen.value = true
    emit('picker:sheet-open', { search })
  }

  function onSheetUpdate(open: boolean): void {
    if (sheetOpen.value && !open) {
      sheetOpen.value = false
      emit('picker:sheet-close')
    } else {
      sheetOpen.value = open
    }
  }

  function onCommitRequest(payload: { classId: string }): void {
    emit('commit-request', payload)
    // Single-bind close-on-commit: the picker wrapper hosts single-class
    // consumers (Settings, DataDialog) where one pick = one decision. Close
    // the sheet so the user isn't left with a stranded drawer to dismiss.
    // Multi-bind consumers (ControlDialog) use ClassPickerSheet directly and
    // own their own open/close lifecycle for chained picks — they don't go
    // through this wrapper, so they're unaffected.
    if (sheetOpen.value) {
      sheetOpen.value = false
      emit('picker:sheet-close')
    }
  }

  function onInlineFocus(): void {
    emit('picker:focus')
  }
  function onInlineBlur(): void {
    emit('picker:blur')
  }

  // Recents push on accepted commit — watches parent-driven modelValue changes.
  watch(
    () => props.modelValue,
    (next, prev) => {
      if (next === prev) return
      if (next === null) return
      const candidate = lookupCandidate(next)
      if (candidate) {
        push({
          classId: candidate.classId,
          className: candidate.className,
          classCategory: candidate.classCategory ?? null,
          moduleName: candidate.moduleName,
        })
      } else if (props.currentClassName) {
        // Parent has a resolved class name (e.g. orphan replaced — currentClassName lags one tick).
        push({ classId: next, className: props.currentClassName })
      }
      // If neither — skip the push. Storing "Unknown class" in recents would
      // pollute the user's history with nothing useful.
    },
  )
</script>

<template>
  <div class="class-picker">
    <!-- Orphan-only banner: the resolved-class case shows its name in the
         ClassPreview card below, so this row would be redundant there. -->
    <div v-if="isOrphan" class="current-class-row current-class-row--orphan text-caption">
      <span class="text-medium-emphasis mr-1">Current:</span>
      <span class="orphan-name font-italic">Unknown class</span>
      <v-tooltip
        location="top"
        text="This class is no longer provided by any installed module. Pick a replacement to update this element."
      >
        <template #activator="{ props: tProps }">
          <v-chip
            v-bind="tProps"
            aria-label="Class is retired; replacement needed"
            class="ml-2 retired-chip"
            color="warning"
            size="x-small"
            variant="tonal"
          >retired</v-chip>
        </template>
      </v-tooltip>
      <span class="ml-2 text-warning orphan-imperative">Pick a replacement.</span>
    </div>

    <ClassPickerInline
      :model-value="modelValue"
      :class-label="classLabel"
      :component-type="componentType"
      :element-name="elementName"
      :element-description="elementDescription"
      :model-id="modelId"
      :disabled="disabled"
      :label="label"
      @commit-request="onCommitRequest"
      @picker:focus="onInlineFocus"
      @picker:blur="onInlineBlur"
      @picker:sheet-open="onInlineSheetOpen"
    />

    <!-- Two-layer wrap: outer owns vertical spacing, inner owns the border +
         scroll. Keeping margin and overflow on the same element produced a
         layout interaction that clipped the bottom border under the scrollbar. -->
    <div v-if="currentClassPreview" class="current-class-preview">
      <div class="current-class-preview__box">
        <ClassPreview :class-item="currentClassPreview" />
      </div>
    </div>

    <ClassPickerSheet
      :model-value="sheetOpen"
      :class-label="classLabel"
      :component-type="componentType"
      :current-class-id="modelValue"
      :initial-search="inlineSearchAtOpen"
      @update:model-value="onSheetUpdate"
      @commit-request="onCommitRequest"
    />
  </div>
</template>

<style scoped>
  .current-class-row {
    display: flex;
    align-items: center;
    margin-bottom: 4px;
  }
  .current-class-row--orphan .orphan-name {
    color: rgb(var(--v-theme-warning));
  }
  .current-class-preview {
    /* Outer layer: vertical breathing room above and below the card. */
    margin-top: 20px;
    margin-bottom: 8px;
  }
  .current-class-preview__box {
    /* Inner layer: bordered region with capped height + internal scroll.
       Budget rationale: SettingsWindow's .settings-window enforces a fixed
       300px height with overflow-y: hidden. The visible left-column stack
       (container/col padding + Name + picker combobox + margins) consumes
       ~160px, leaving ~140px for the preview. 120px keeps the bottom
       border + bottom margin visible inside the 300px window, with
       headroom for the orphan banner when retired classes are picked.
       The shared ClassPreview uses `flat` (no elevation), so the thin
       border keeps it visually distinct from the panel surface. */
    max-height: 200px;
    overflow-y: auto;
    border: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 4px;
  }
</style>
