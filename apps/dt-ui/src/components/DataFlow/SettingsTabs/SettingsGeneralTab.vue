<script setup lang="ts">
  import { computed, nextTick, onMounted, ref, watch } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { useFlowStore } from '@/stores/flowStore'
  import { Class, Model } from '@dethernety/dt-core'

  import ClassPicker from '@/components/DataFlow/ClassPicker/ClassPicker.vue'
  import ModelPreview from '@/components/DataFlow/ClassPicker/ModelPreview.vue'
  import ConfirmClassOrModelChangeDialog from '@/components/Dialogs/DataFlow/ConfirmClassOrModelChangeDialog.vue'
  import ContentSelectDialog from '@/components/Dialogs/Browser/ContentSelectDialog.vue'

  // Interfaces
  interface FormData {
    name: string;
    class: string;
    model: string;
    modelName: string;
    description: string;
    category: string;
  }

  // Props
  interface Props {
    formData: FormData;
    isFromClass: boolean;
    crownJewel: boolean;
    itemClass: Class | null;
    representedModel: Model | null;
    hasDirtyEdits?: boolean;
  }

  // Stores
  const flowStore = useFlowStore()

  const props = defineProps<Props>()

  // Emits
  const emit = defineEmits<{
    'update:formData': [value: FormData];
    'update:isFromClass': [value: boolean];
    'update:crownJewel': [value: boolean];
    'openModel': [modelId: string];
    'class-change-commit': [];
    'class-change-discard': [];
    'class-change-cancel': [];
    'saveItem': [];
  }>()

  // Dialog states
  const showClassOrModelChangeDialog = ref(false)
  const showContentSelectDialog = ref(false)
  const contentSelectType = ref<'model' | 'control'>('model')

  const nameRules = [
    (v: string) => !!v || 'Name is required',
    (v: string) => v.length <= 100 || 'Name must be less than 100 characters',
    (v: string) => v.length >= 3 || 'Name must be at least 3 characters',
  ]

  const descriptionRules = [
    (v: string) => v.length <= 1000 || 'Description must be less than 1000 characters',
  ]

  // Computed
  const selectedItem = ref<Node | Edge | null>(null)
  const displayType = ref('')

  const updateDisplayType = () => {
    selectedItem.value = flowStore.selectedItem
    const item = selectedItem.value
    if (item && typeof item === 'object' && 'type' in item && 'position' in item) {
      displayType.value = item.type === 'BOUNDARY' ? 'Boundary' : 'Component'
    } else {
      displayType.value = 'Data Flow'
    }
  }

  // Type guards
  const isNode = (item: Node | Edge | null): item is Node => {
    return item !== null && typeof item === 'object' && 'type' in item && 'position' in item
  }

  const classLabel = computed<'COMPONENT' | 'DATA_FLOW' | 'SECURITY_BOUNDARY'>(() => {
    const item = selectedItem.value
    if (item && isNode(item)) {
      // @ts-ignore TS2589 — IDE-only false positive on vue-flow Node<T,U>
      // narrowing depth; vue-tsc in the build sees the type fine.
      return item.type === 'BOUNDARY' ? 'SECURITY_BOUNDARY' : 'COMPONENT'
    }
    return 'DATA_FLOW'
  })

  const componentType = computed<'PROCESS' | 'STORE' | 'EXTERNAL_ENTITY' | null>(() => {
    const item = selectedItem.value
    if (item && isNode(item) && classLabel.value === 'COMPONENT'
        && (item.type === 'PROCESS' || item.type === 'STORE' || item.type === 'EXTERNAL_ENTITY')) {
      return item.type
    }
    return null
  })

  // Watchers
  watch(() => flowStore.selectedItem, () => {
    updateDisplayType()
  })

  onMounted(() => {
    updateDisplayType()
  })

  const updateFormData = (field: keyof FormData, value: any) => {
    emit('update:formData', { ...props.formData, [field]: value })
  }

  const updateIsFromClass = (value: boolean) => {
    emit('update:isFromClass', value)
  }

  const updateCrownJewel = (value: boolean) => {
    emit('update:crownJewel', value)
  }

  // Staged class-commit pattern. We hold the pending classId until the confirm
  // dialog resolves; only then do we mutate formData.class. This avoids the old
  // v-autocomplete behaviour of writing the new class up-front and leaving
  // formData dirty on cancel.
  const pendingClassId = ref<string | null>(null)
  // Remember last picked class so toggling isFromClass off-then-on restores it.
  const lastPickedClass = ref<string>(props.formData.class || '')

  const onPickerCommitRequest = ({ classId }: { classId: string }) => {
    pendingClassId.value = classId
    if (props.itemClass || props.representedModel) {
      showClassOrModelChangeDialog.value = true
    } else {
      applyPendingClass()
      emit('class-change-commit')
    }
  }

  const applyPendingClass = () => {
    if (pendingClassId.value !== null) {
      updateFormData('class', pendingClassId.value)
      lastPickedClass.value = pendingClassId.value
      pendingClassId.value = null
      // The parent's class-change-commit / class-change-discard handler owns
      // the resulting save via its own `if (isDirty) await onSubmit()` branch.
      // Clearing the queue here prevents the pickerActive watcher from firing
      // a second, redundant saveItem when the dialog closes.
      blurredFields.value.clear()
    }
  }

  const onClassChangeCommit = () => {
    showClassOrModelChangeDialog.value = false
    applyPendingClass()
    emit('class-change-commit')
  }

  const onClassChangeDiscard = () => {
    showClassOrModelChangeDialog.value = false
    applyPendingClass()
    emit('class-change-discard')
  }

  const onClassChangeCancel = () => {
    showClassOrModelChangeDialog.value = false
    pendingClassId.value = null
    emit('class-change-cancel')
  }

  watch(() => props.isFromClass, (now, was) => {
    if (was && !now) {
      lastPickedClass.value = props.formData.class || lastPickedClass.value
    } else if (!was && now && lastPickedClass.value && !props.formData.class) {
      updateFormData('class', lastPickedClass.value)
    }
  })

  // Keep lastPickedClass current with the active element — without this, switching
  // to a different node (which swaps formData) would leave a stale id behind that
  // the isFromClass-off-then-on flow would then incorrectly restore.
  watch(() => props.formData.class, newClass => {
    if (props.isFromClass && newClass) {
      lastPickedClass.value = newClass
    }
  })

  // Reset lastPickedClass when the selected element changes (a different node was clicked).
  watch(() => flowStore.selectedItem, (next, prev) => {
    if (next !== prev) {
      lastPickedClass.value = props.isFromClass ? (props.formData.class || '') : ''
    }
  })

  // Save-on-blur suppression. While the picker has focus or the sheet
  // is open, we hold back saves and coalesce them into a single fire when
  // focus returns to the form.
  const pickerFocused = ref(false)
  const sheetOpen = ref(false)
  const blurredFields = ref<Set<'name' | 'description'>>(new Set())

  // Treat the confirm dialog as part of the picker session — a dialog open
  // means a commit is being decided; saves must not race that decision.
  const pickerActive = computed(() =>
    pickerFocused.value || sheetOpen.value || showClassOrModelChangeDialog.value,
  )

  watch(pickerActive, active => {
    if (!active && blurredFields.value.size > 0) {
      blurredFields.value.clear()
      emit('saveItem')
    }
  })

  const findModel = () => {
    showContentSelectDialog.value = true
    contentSelectType.value = 'model'
  }

  const openModel = () => {
    emit('openModel', props.formData.model)
  }

  const onSelectContent = async (selectedModels: Model[]) => {
    if (selectedModels && selectedModels.length > 0) {
      updateFormData('model', selectedModels[0].id)
      await nextTick()
      updateFormData('modelName', selectedModels[0].name || '')
      showClassOrModelChangeDialog.value = true
    }
  }

  const saveItem = (field?: 'name' | 'description') => {
    if (!selectedItem.value) return
    if (pickerActive.value) {
      if (field) blurredFields.value.add(field)
      return
    }
    emit('saveItem')
  }

</script>

<template>
  <v-card v-if="selectedItem" flat>
    <v-container>
      <v-row>
        <v-col cols="7">
          <v-text-field
            label="Name"
            :model-value="formData.name"
            required
            :rules="nameRules"
            @blur="saveItem('name')"
            @update:model-value="updateFormData('name', $event)"
          />
          <v-textarea
            label="Description"
            :model-value="formData.description"
            :rules="descriptionRules"
            @blur="saveItem('description')"
            @update:model-value="updateFormData('description', $event)"
          />
          <div class="d-flex justify-space-between align-center">
            <div class="d-flex align-center ga-4">
              <v-btn
                v-if="componentType !== null"
                :icon="crownJewel ? 'mdi-crown' : 'mdi-crown-outline'"
                :variant="crownJewel ? 'tonal' : 'outlined'"
                color="crownjewel"
                size="x-large"
                class="rounded-md"
                @click="updateCrownJewel(!crownJewel)"
              />
              <v-switch
                v-if="selectedItem && selectedItem.type && 'position' in selectedItem"
                :hide-details="componentType !== null"
                :label="isFromClass ? 'Inherited from a Class' : 'Represents a Model'"
                :model-value="isFromClass"
                @update:model-value="val => updateIsFromClass(val === true)"
              />
            </div>
            <v-btn
              v-if="!isFromClass && formData.model"
              class="mx-3 my-0"
              color="secondary"
              icon="mdi-arrow-right-bold-outline"
              size="x-large"
              variant="outlined"
              @click="openModel"
            />
          </div>
        </v-col>
        <v-col cols="5">
          <ClassPicker
            v-if="isFromClass"
            :model-value="formData.class || null"
            :class-label="classLabel"
            :component-type="componentType"
            :current-class-name="itemClass?.name ?? null"
            :current-class-category="itemClass?.category ?? null"
            :current-class-description="itemClass?.description ?? null"
            :current-class-module-name="itemClass?.module?.name ?? null"
            :element-description="formData.description"
            :element-name="formData.name"
            :label="`${displayType} Class`"
            :model-id="flowStore.modelId"
            @commit-request="onPickerCommitRequest"
            @picker:blur="pickerFocused = false"
            @picker:focus="pickerFocused = true"
            @picker:sheet-close="sheetOpen = false"
            @picker:sheet-open="sheetOpen = true"
          />
          <div
            v-else
            class="d-flex justify-space-between"
          >
            <v-text-field
              disabled
              label="Represented Model"
              :model-value="formData.modelName"
            />
            <v-btn
              class="mx-3 my-0"
              color="secondary"
              icon="mdi-magnify"
              size="large"
              variant="plain"
              @click="findModel"
            />
          </div>
          <div v-if="!isFromClass && representedModel" class="current-model-preview">
            <div class="current-model-preview__box">
              <ModelPreview :model-item="representedModel" />
            </div>
          </div>
        </v-col>
      </v-row>
    </v-container>
  </v-card>
  <v-alert v-else dismissible type="info">No item selected.</v-alert>

  <!-- Dialogs (moved from parent) -->
  <ConfirmClassOrModelChangeDialog
    v-if="showClassOrModelChangeDialog"
    :has-dirty-edits="props.hasDirtyEdits"
    :show="showClassOrModelChangeDialog"
    @cancel="onClassChangeCancel"
    @commit-and-change="onClassChangeCommit"
    @discard-and-change="onClassChangeDiscard"
  />
  <ContentSelectDialog
    v-if="showContentSelectDialog"
    content-type="Model"
    enable-create
    select-type="single"
    :show="showContentSelectDialog"
    @close="showContentSelectDialog = false"
    @select="onSelectContent"
  />
</template>

<style scoped>
  .current-model-preview {
    /* Outer layer: vertical breathing room. */
    margin-top: 2px;
    margin-bottom: 8px;
  }
  .current-model-preview__box {
    /* Inner layer: bordered region with capped height + internal scroll.
       Budget rationale: the model branch has an extra "Represented Model"
       disabled text-field row above the preview (~76px), so the column
       budget for this card is tighter than the class side. Capped at 100px
       to keep the bottom border + bottom margin visible inside the 300px
       overflow-hidden settings window. */
    max-height: 200px;
    overflow-y: auto;
    border: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 4px;
  }
</style>
