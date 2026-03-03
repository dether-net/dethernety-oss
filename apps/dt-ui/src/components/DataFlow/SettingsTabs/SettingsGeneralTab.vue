<script setup lang="ts">
  import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { useFlowStore } from '@/stores/flowStore'
  import { Analysis, Class, Model } from '@dethernety/dt-core'

  import ConfirmClassOrModelChangeDialog from '@/components/Dialogs/DataFlow/ConfirmClassOrModelChangeDialog.vue'
  import AnalysisFlowDialog from '@/components/Dialogs/Analysis/AnalysisFlowDialog.vue'
  import ContentSelectDialog from '@/components/Dialogs/Browser/ContentSelectDialog.vue'
  import ConfirmClassCreationDialog from '@/components/Dialogs/General/ConfirmClassCreationDialog.vue'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'

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
  }

  // Stores
  const analysisStore = useAnalysisStore()
  const flowStore = useFlowStore()

  const props = defineProps<Props>()
  const availableClasses = ref<{ id: string; name: string }[]>([])

  // Emits
  const emit = defineEmits<{
    'update:formData': [value: FormData];
    'update:isFromClass': [value: boolean];
    'openModel': [modelId: string];
    'classOrModelChangeConfirmed': [confirmed: boolean];
    'saveItem': [];
    'updateForm': [];
  }>()

  // Dialog states
  const showClassOrModelChangeDialog = ref(false)
  const showContentSelectDialog = ref(false)
  const showConfirmClassCreationDialog = ref(false)
  const showAnalysisFlowDialog = ref(false)
  const contentSelectType = ref<'model' | 'control'>('model')
  const showAnalysisDeleteDialog = ref(false)

  const fetchTimer = ref<number | null>(null)
  const analysis = ref<Analysis | null>(null)
  const analysisStatus = ref<string | undefined>(undefined)
  const hasAnalysisClasses = ref(false)

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

    // Clear existing timer when selected item changes
    if (fetchTimer.value) {
      clearInterval(fetchTimer.value)
      fetchTimer.value = null
    }

    if (selectedItem.value?.id) {
      getAnalysis().then(() => {
        // Initialize the analysis status and start monitoring
        if (analysis.value) {
          analysisStatus.value = analysis.value.status?.status
        }
        // Start the timer after initial fetch
        updateAnalysis()
      })
    }
  })

  const resetModule = async () => {
    try {
      const module = await flowStore.getModuleByName({ moduleName: 'dethernety' })
      if (module) {
        await flowStore.resetModule({ moduleId: module.id })
      }
    } catch (error) {
      console.error('Failed to reset module:', error)
    }
  }

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

  const checkAnalysisClasses = async (): Promise<boolean> => {
    if (!selectedItem.value) return false
    try {
      const classes = await analysisStore.fetchAnalysisClasses({
        classType: 'component_class_graph',
      })
      return classes.length > 0
    } catch {
      return false
    }
  }

  const getAnalysis = async () => {
    analysis.value = null
    analysisStatus.value = undefined
    hasAnalysisClasses.value = false
    if (!selectedItem.value) return

    const classesExist = await checkAnalysisClasses()
    hasAnalysisClasses.value = classesExist
    if (!classesExist) return

    try {
      const a = await analysisStore.getOrCreateAnalysis({
        elementId: selectedItem.value.id,
        classType: 'component_class_graph',
        analysisName: 'Component Class Creation',
      })
      if (a) {
        analysis.value = a
        analysisStatus.value = a.status?.status
      }
    } catch (error) {
      console.error('Failed to get analysis:', error)
    }
  }

  const updateAnalysis = () => {
    if (!selectedItem.value?.id || !analysis.value?.id) return

    // Clear any existing timer
    if (fetchTimer.value) {
      clearInterval(fetchTimer.value)
      fetchTimer.value = null
    }
    fetchTimer.value = setInterval(async () => {
      // Fetch fresh analysis data to get current status
      const freshAnalysis = await analysisStore.findAnalysis({ analysisId: analysis.value?.id })
      if (freshAnalysis) {
        const currentStatus = freshAnalysis.status?.status
        const previousStatus = analysisStatus.value

        // Update the analysis
        analysis.value = freshAnalysis

        // Check if status changed from non-idle to idle (analysis completed)
        if (previousStatus && previousStatus !== 'idle' && currentStatus === 'idle') {
          resetModule()
          getAvailableClasses()
          emit('updateForm')
        }

        // Update the status
        analysisStatus.value = currentStatus
      } else {
        // If analysis not found, try to get it again
        getAnalysis()
      }
    }, 5000)
  }

  onMounted(() => {
    updateDisplayType()
    getAvailableClasses()

    if (selectedItem.value?.id) {
      getAnalysis().then(() => {
        // Initialize the analysis status and start monitoring
        if (analysis.value) {
          analysisStatus.value = analysis.value.status?.status
        }
        // Start the timer after initial fetch
        updateAnalysis()
      })
    }
  })

  onUnmounted(() => {
    if (fetchTimer.value) {
      clearInterval(fetchTimer.value)
      fetchTimer.value = null
    }
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
      emit('classOrModelChangeConfirmed', true)
    }
  }

  const onClassOrModelChangeConfirmed = (confirmed: boolean) => {
    showClassOrModelChangeDialog.value = false
    emit('classOrModelChangeConfirmed', confirmed)
  }

  const findModel = () => {
    showContentSelectDialog.value = true
    contentSelectType.value = 'model'
  }

  const openModel = () => {
    emit('openModel', props.formData.model)
  }

  const runAnalysis = async () => {
    if (!analysis.value?.id) return

    // Set status to busy immediately when starting analysis
    analysisStatus.value = 'busy'

    analysisStore.runAnalysis({ analysisId: analysis.value.id })
      .then((sessionId: string | null) => {
        if (!sessionId) return
        showAnalysisFlowDialog.value = true
        // Start monitoring the analysis status
        updateAnalysis()
      })
      .catch(error => {
        console.error('Failed to run analysis:', error)
        analysisStatus.value = 'error'
      })
  }

  const openAnalysisFlow = async (id: string | undefined) => {
    if (!id) return
    showAnalysisFlowDialog.value = true
  }

  const closeAnalysisFlow = () => {
    showAnalysisFlowDialog.value = false
  }

  const onSelectContent = async (selectedModels: Model[]) => {
    if (selectedModels && selectedModels.length > 0) {
      updateFormData('model', selectedModels[0].id)
      await nextTick()
      updateFormData('modelName', selectedModels[0].name || '')
      showClassOrModelChangeDialog.value = true
    }
  }

  const onShowConfirmClassCreationDialog = () => {
    showConfirmClassCreationDialog.value = true
  }

  const saveItem = () => {
    if (selectedItem.value) {
      emit('saveItem')
    }
  }

  const deleteAnalysis = async () => {
    if (analysis.value?.id) {
      try {
        await analysisStore.deleteAnalysis({ analysisId: analysis.value.id })
      } catch (error) {
        console.error('Failed to delete analysis:', error)
      }
    }
    showAnalysisDeleteDialog.value = false
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
            <div v-if="isFromClass && hasAnalysisClasses" class="mx-3 mt-1">
              <v-btn
                v-if="selectedItem?.id && (analysis === null || ['idle'].includes(analysis.status?.status || ''))"
                color="amber"
                icon="mdi-creation-outline"
                variant="plain"
                @click="onShowConfirmClassCreationDialog"
                @contextmenu.prevent="showAnalysisDeleteDialog = true"
              />
              <v-progress-circular
                v-if="selectedItem?.id && analysis && ['busy', 'running'].includes(analysis.status?.status || '')"
                class="ma-1 run-analysis-button-progress"
                color="amber"
                indeterminate
                :size="20"
                @click="openAnalysisFlow(selectedItem?.id)"
                @contextmenu.prevent="showAnalysisDeleteDialog = true"
              />
              <v-btn
                v-if="selectedItem?.id && analysis && ['interrupted'].includes(analysis.status?.status || '')"
                color="warning"
                icon="mdi-forum-outline"
                variant="plain"
                @click="openAnalysisFlow(selectedItem?.id)"
                @contextmenu.prevent="showAnalysisDeleteDialog = true"
              />
              <v-btn
                v-if="selectedItem?.id && analysis && ['error'].includes(analysis.status?.status || '')"
                color="error"
                icon="mdi-alert-circle-outline"
                variant="plain"
                @click="openAnalysisFlow(selectedItem?.id)"
                @contextmenu.prevent="showAnalysisDeleteDialog = true"
              />
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
    :show="showClassOrModelChangeDialog"
    @confirm="onClassOrModelChangeConfirmed"
  />
  <AnalysisFlowDialog
    v-if="analysis && showAnalysisFlowDialog"
    :analysis-id="analysis?.id ?? undefined"
    :show="showAnalysisFlowDialog"
    @close="closeAnalysisFlow"
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
  <ConfirmClassCreationDialog
    v-if="showConfirmClassCreationDialog"
    :show="showConfirmClassCreationDialog"
    @create:confirmed="showConfirmClassCreationDialog = false; selectedItem?.id && runAnalysis()"
    @dialog:closed="showConfirmClassCreationDialog = false"
  />
  <ConfirmDeleteDialog
    v-if="showAnalysisDeleteDialog"
    message="Are you sure you want to delete the analysis?"
    :show="showAnalysisDeleteDialog"
    @delete:canceled="showAnalysisDeleteDialog = false"
    @delete:confirmed="deleteAnalysis"
  />
</template>
