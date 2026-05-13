<script setup lang="ts">
  import { nextTick, onMounted, ref, watch } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { useFlowStore } from '@/stores/flowStore'
  import { Class, Model } from '@dethernety/dt-core'

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
    itemClass: Class | null;
    representedModel: Model | null;
    hasDirtyEdits?: boolean;
  }

  // Stores
  const flowStore = useFlowStore()

  const props = defineProps<Props>()
  const availableClasses = ref<{ id: string; name: string }[]>([])

  // Emits
  const emit = defineEmits<{
    'update:formData': [value: FormData];
    'update:isFromClass': [value: boolean];
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
    displayType.value = 'Component'
  }

  // Type guards
  const isNode = (item: Node | Edge | null): item is Node => {
    return item !== null && typeof item === 'object' && 'type' in item && 'position' in item
  }

  // Watchers
  watch(() => flowStore.selectedItem, () => {
    updateDisplayType()
    getAvailableClasses()
  })

  const getAvailableClasses = () => {
    const modules = flowStore.modules

    const getClassesForItem = (module: any) => {
      const item = selectedItem.value as any
      if (!isNode(item)) {
        return module.dataFlowClasses || []
      }

      if (item.type === 'BOUNDARY') {
        return module.securityBoundaryClasses || []
      }

      return (module.componentClasses || [])
        .filter((cls: any) => cls.type === item?.type)
    }

    const allClasses: { id: string; name: string }[] = []

    modules.forEach((module: any) => {
      const classes = getClassesForItem(module)
      classes.forEach((cls: any) => {
        if (cls && cls.id && cls.name) {
          allClasses.push({ id: cls.id, name: cls.name })
        }
      })
    })
    availableClasses.value = allClasses.sort((a, b) => a.name.localeCompare(b.name))
  }

  onMounted(() => {
    updateDisplayType()
    getAvailableClasses()
  })

  const updateFormData = (field: keyof FormData, value: any) => {
    emit('update:formData', { ...props.formData, [field]: value })
  }

  const updateIsFromClass = (value: boolean) => {
    emit('update:isFromClass', value)
  }

  const onClassOrModelChange = () => {
    if (props.itemClass || props.representedModel) {
      showClassOrModelChangeDialog.value = true
    } else {
      // No prior class/model — nothing to commit / discard, just proceed.
      emit('class-change-commit')
    }
  }

  const onClassChangeCommit = () => {
    showClassOrModelChangeDialog.value = false
    emit('class-change-commit')
  }

  const onClassChangeDiscard = () => {
    showClassOrModelChangeDialog.value = false
    emit('class-change-discard')
  }

  const onClassChangeCancel = () => {
    showClassOrModelChangeDialog.value = false
    emit('class-change-cancel')
  }

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

  const saveItem = () => {
    if (selectedItem.value) {
      emit('saveItem')
    }
  }

</script>

<template>
  <v-card v-if="selectedItem" flat>
    <v-container>
      <v-row>
        <v-col cols="4">
          <v-text-field
            label="Name"
            :model-value="formData.name"
            required
            :rules="nameRules"
            @blur="saveItem"
            @update:model-value="updateFormData('name', $event)"
          />
          <v-autocomplete
            v-if="isFromClass"
            item-title="name"
            item-value="id"
            :items="availableClasses"
            :label="`${displayType} Class`"
            :model-value="formData.class"
            @update:model-value="updateFormData('class', $event); onClassOrModelChange()"
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
          <v-text-field
            v-if="isFromClass"
            label="Category"
            :model-value="formData.category"
            readonly
          />
          <div v-if="!isFromClass && formData.model" class="d-flex justify-end">
            <v-btn
              class="mx-3 my-0"
              color="secondary"
              icon="mdi-arrow-right-bold-outline"
              size="x-large"
              variant="outlined"
              @click="openModel"
            />
          </div>
        </v-col>
        <v-col cols="7">
          <v-textarea
            label="Description"
            :model-value="formData.description"
            :rules="descriptionRules"
            @blur="saveItem"
            @update:model-value="updateFormData('description', $event)"
          />
          <div class="d-flex justify-space-between">
            <v-switch
              v-if="selectedItem && selectedItem.type && 'position' in selectedItem"
              :label="isFromClass ? 'Inherited from a Class' : 'Represents a Model'"
              :model-value="isFromClass"
              @update:model-value="val => updateIsFromClass(val === true)"
            />
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
