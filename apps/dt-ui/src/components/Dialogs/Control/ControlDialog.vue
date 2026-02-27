<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useControlsStore } from '@/stores/controlsStore'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { useFolderStore } from '@/stores/folderStore'
  import { Analysis, Class, Control, Countermeasure } from '@dethernety/dt-core'
  import { unflattenProperties } from '@/utils/dataFlowUtils'
  import type { UISchemaElement } from '@jsonforms/core'

  interface Props {
    show: boolean
    id: string
    showFileActions: boolean
  }

  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  const props = defineProps<Props>()
  const showControlDialog = ref(props.show)
  const id = ref(props.id)
  const folderStore = useFolderStore()

  watch(
    () => props.show,
    newVal => {
      showControlDialog.value = newVal
    }
  )
  const emits = defineEmits(['control:deleted', 'control:moved', 'control:closed', 'control:saved'])

  const controlsStore = useControlsStore()
  const analysisStore = useAnalysisStore()
  const showClassControlDialog = ref(false)
  const selectedClassId = ref('')
  const currentItemClass = ref<Class | null>(null)
  const newName = ref('')
  const newDescription = ref('')
  const control = ref<Control | null>(null)
  const controlId = ref(props.id)
  const controlsToDelete = ref('')
  const showDeleteControlsDialog = ref(false)
  const showCountermeasureDialog = ref(false)
  const showAnalysisDeleteDialog = ref(false)
  const showDeleteCountermeasureDialog = ref(false)
  const countermeasureAction = ref<'create' | 'update'>('create')
  const countermeasureId = ref<string | null>(null)
  const showDefendTechniqueDialog = ref(false)
  const d3fendId = ref('')

  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  const tab = ref('general')
  const showMitigationDialog = ref(false)
  const mitigationId = ref('')

  const showAnalysisFlowDialog = ref(false)
  const analysisIdToShow = ref('')
  const analysis = ref<Analysis | null>(null)
  const fetchTimer = ref(null)
  const analysisStatus = ref<string | undefined>(undefined)

  const showFolderSelectDialog = ref(false)
  const showConfirmClassCreationDialog = ref(false)

  const availableClasses = ref<Class[]>([])

  const attributesData = ref({})
  const attributesSchema = ref<object | null>(null)
  const attributesUiSchema = ref<UISchemaElement | null>(null)
  const attributesLoading = ref(false)
  const attributesTemplateWarning = ref(false)

  // Data table headers
  const headers = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: 'Module', key: 'module.name' },
    { title: '', key: 'actions' },
  ]
  const itemsPerPage = [
    { value: 5, title: '5' },
    { value: 10, title: '10' },
    { value: 25, title: '25' },
    { value: 50, title: '50' },
    { value: -1, title: '$vuetify.dataFooter.itemsPerPageAll' },
  ]

  const countermeasuresHeaders = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: 'Type', key: 'type' },
    { title: 'Mitigations & Techniques', key: 'mitigations' },
    { title: '', key: 'actions' },
  ]

  // Initialize selected class IDs
  const selectedClassIds = ref<string[]>([])
  watch(() => control.value, () => {
    selectedClassIds.value = control.value?.controlClasses?.map(cls => cls.id) || []
  })

  const availableModules = computed(() => controlsStore.modules)
  const selectedModules = ref<String[]>([])

  // Search term
  const search = ref('')
  const onlySelected = ref(false)

  const filteredControlClasses = computed(() => {
    const searchTerm = search.value.toLowerCase()
    return availableClasses.value.filter(cls => {
      const nameMatches = cls.name?.toLowerCase().includes(searchTerm)
      const descriptionMatches = cls.description?.toLowerCase().includes(searchTerm)
      const onlySelectedIdsMatch = onlySelected.value ? selectedClassIds.value.includes(cls.id) : true
      const moduleIdsMatch = selectedModules.value?.length === 0 ||
        (cls.module?.id && selectedModules.value.includes(cls.module.id))
      return onlySelectedIdsMatch && moduleIdsMatch && (nameMatches || descriptionMatches)
    })
  })

  const countermeasures = ref<Countermeasure[]>([])
  const fetchCountermeasures = () => {
    controlsStore.getCountermeasuresFromControl({ controlId: controlId.value }).then(cm => {
      if (cm) {
        countermeasures.value = cm
      }
    })
  }

  watch(() => controlId.value, () => {
    fetchCountermeasures()
  })

  watch(showCountermeasureDialog, () => {
    if (!showCountermeasureDialog.value) {
      // Add a slight delay to ensure backend data is updated
      setTimeout(fetchCountermeasures, 500)
    }
  })

  const getAnalysis = async () => {
    analysis.value = null
    analysisStatus.value = undefined
    if (!controlId.value) return
    const a = await analysisStore.getOrCreateAnalysis({ elementId: controlId.value, classType: 'control_class_graph', analysisName: 'Control Class Creation' })
    if (a) {
      analysis.value = a
      analysisStatus.value = a.status?.status
    }
  }

  const updateAnalysis = () => {
    if (!controlId.value || !analysis.value?.id) return
    if (fetchTimer.value) {
      clearInterval(fetchTimer.value)
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
          controlsStore.fetchControls({ folderId: folderStore.selectedFolder?.id || 'all' })
          resetModule()
          getControl()
        }

        // Update the status
        analysisStatus.value = currentStatus
      }
    }, 5000) as unknown as null
  }

  const getControl = async () => {
    controlsStore.getControl({ controlId: props.id }).then(controlData => {
      control.value = controlData
      newName.value = control.value?.name || ''
      newDescription.value = control.value?.description || ''
      selectedClassIds.value = control.value?.controlClasses?.map(cls => cls.id) || []
      onlySelected.value = (control.value?.controlClasses?.length ?? 0) > 0
    })
  }

  onMounted(() => {
    controlsStore.fetchMitreAttackMitigations()
    controlsStore.fetchMitreDefendTactics()
    controlsStore.fetchClasses({
      moduleWhere: {},
      classWhere: {},
    }).then(classes => {
      availableClasses.value = classes.map((cls: { controlClasses: any; }) => cls.controlClasses).flat()
    })
    controlsStore.fetchModules()
    if (controlId.value) {
      getAnalysis().then(() => {
        // Initialize the analysis status and start monitoring
        if (analysis.value) {
          analysisStatus.value = analysis.value.status?.status
        }
        // Start the timer after initial fetch
        updateAnalysis()
      })
    }
    getControl()
  })

  onUnmounted(() => {
    if (fetchTimer.value) {
      clearInterval(fetchTimer.value)
    }
  })

  const resetModule = async () => {
    const module = await controlsStore.getModuleByName({ moduleName: 'dethernety' })

    if (module) {
      controlsStore.resetModule({ moduleId: module.id })
    }
  }

  const onCountermeasureUpdated = () => {
    fetchCountermeasures()
    snackBar.value = { show: true, message: 'Countermeasure updated', color: 'success' }
    countermeasureId.value = null
    showCountermeasureDialog.value = false
  }

  const onCountermeasureCreated = () => {
    fetchCountermeasures()
    snackBar.value = { show: true, message: 'Countermeasure created', color: 'success' }
    countermeasureId.value = null
    showCountermeasureDialog.value = false
  }

  const onCountermeasureFailed = () => {
    snackBar.value = { show: true, message: 'Failed to create countermeasure', color: 'error' }
    countermeasureId.value = null
    showCountermeasureDialog.value = false
  }

  const onCountermeasureDelete = () => {
    controlsStore.deleteCountermeasure({ countermeasureId: countermeasureId.value || '' })
      .then(ret => {
        if (ret) {
          fetchCountermeasures()
          snackBar.value = { show: true, message: 'Countermeasure deleted', color: 'success' }
        }
      })
      .catch(() => {
        snackBar.value = { show: true, message: 'Failed to delete countermeasure', color: 'error' }
      })
      .finally(() => {
        showDeleteCountermeasureDialog.value = false
        countermeasureId.value = null
      })
  }

  const showMitigation = (attackId: string) => {
    mitigationId.value = attackId
    showMitigationDialog.value = true
  }

  const showDefendTechnique = (d3fId: string) => {
    d3fendId.value = d3fId
    showDefendTechniqueDialog.value = true
  }

  const showDeleteCountermeasure = (id: string) => {
    countermeasureId.value = id
    showDeleteCountermeasureDialog.value = true
  }

  const showClassControl = async (classId: string) => {
    try {
      selectedClassId.value = classId
      currentItemClass.value = await controlsStore.getClass({ classId })
      if (currentItemClass.value) {
        if (
          currentItemClass.value.template &&
          typeof currentItemClass.value.template.schema === 'object' &&
          typeof currentItemClass.value.template.uischema === 'object'
        ) {
          attributesSchema.value = currentItemClass.value.template.schema
          attributesUiSchema.value = currentItemClass.value.template.uischema as UISchemaElement
          controlsStore.getAttributesFromClassRelationship({
            classId: classId,
            componentId: controlId.value,
          }).then(attributes => {
            if (attributes) {
              attributesData.value = unflattenProperties(attributes)
              attributesLoading.value = false
            }
          })
        }
      }
    } catch (error) {
      console.error('Error loading class control:', error)
    } finally {
      // Always show the dialog, even if there was an error loading the class
      showClassControlDialog.value = true
    }
  }

  const onAttributesChanged = (data: object) => {
    controlsStore.setInstantiationAttributes({
      classId: selectedClassId.value,
      componentId: controlId.value,
      attributes: data,
    }).then(ret => {
      if (ret) {
        attributesData.value = data
        snackBar.value = { show: true, message: 'Attributes added', color: 'success' }
        setTimeout(fetchCountermeasures, 500)
      } else {
        snackBar.value = { show: true, message: 'Failed to add attributes', color: 'error' }
      }
    }).catch(() => {
      snackBar.value = { show: true, message: 'Failed to add attributes', color: 'error' }
    })
    // showClassControlDialog.value = false
  }

  const showDelete = (id: string) => {
    controlsToDelete.value = id
    showDeleteControlsDialog.value = true
  }

  const showCountermeasure = (id: string | null) => {
    countermeasureAction.value = id ? 'update' : 'create'
    showCountermeasureDialog.value = true
    countermeasureId.value = id
  }

  const onControlDelete = () => {
    controlsStore.deleteControl({ controlId: controlId.value }).then(ret => {
      if (ret) {
        emits('control:deleted', true)
      } else {
        emits('control:deleted', false)
      }
    })
    showDeleteControlsDialog.value = false
  }

  // const onClassControlDialogCancel = () => {
  //   showClassControlDialog.value = false
  // }

  // const onClassControlDialogSubmit = (attributes: any) => {
  //   controlsStore.setInstantiationAttributes({
  //     classId: selectedClassId.value,
  //     componentId: controlId.value,
  //     attributes,
  //   }).then(ret => {
  //     if (ret) {
  //       snackBar.value = { show: true, message: 'Attributes added', color: 'success' }
  //       setTimeout(fetchCountermeasures, 500)
  //     } else {
  //       snackBar.value = { show: true, message: 'Failed to add attributes', color: 'error' }
  //     }
  //   }).catch(() => {
  //     snackBar.value = { show: true, message: 'Failed to add attributes', color: 'error' }
  //   })
  //   showClassControlDialog.value = false
  // }

  const onSubmit = () => {
    controlsStore.updateControl({
      controlId: control.value?.id || '',
      name: newName.value,
      description: newDescription.value,
      controlClasses: selectedClassIds.value,
      folderId: control.value?.folder?.id || undefined,
    }).then(ret => {
      if (ret) {
        // snackBar.value = { show: true, message: 'Control updated', color: 'success' }
        emits('control:saved', true)
        setTimeout(fetchCountermeasures, 500)
      } else {
        // snackBar.value = { show: true, message: 'Failed to update control', color: 'error' }
        emits('control:saved', false)
      }
    }).catch(() => {
      // snackBar.value = { show: true, message: 'Failed to update control', color: 'error' }
      emits('control:saved', false)
    })
  }

  const runAnalysis = async () => {
    if (!analysis.value?.id) return

    // Set status to busy immediately when starting analysis
    analysisStatus.value = 'busy'

    analysisStore.runAnalysis({ analysisId: analysis.value.id }).then((sessionId: string | null) => {
      if (!sessionId) return
      showAnalysisFlowDialog.value = true
      // Start monitoring the analysis status
      updateAnalysis()
    })
  }

  const openAnalysisFlow = async () => {
    if (!analysis.value?.id) return
    analysisIdToShow.value = analysis.value.id
    showAnalysisFlowDialog.value = true
  }

  const closeAnalysisFlow = () => {
    showAnalysisFlowDialog.value = false
    analysisIdToShow.value = ''
  }

  const moveToFolder = (folderId: string) => {
    controlsStore.updateControl({
      controlId: controlId.value,
      name: newName.value,
      description: newDescription.value,
      controlClasses: selectedClassIds.value,
      folderId,
    }).then(ret => {
      if (ret) {
        snackBar.value = { show: true, message: 'Control moved to folder', color: 'success' }
        emits('control:moved', folderId)
      } else {
        snackBar.value = { show: true, message: 'Failed to move control to folder', color: 'error' }
      }
      showFolderSelectDialog.value = false
    })
  }

  const deleteAnalysis = async () => {
    if (analysis.value?.id) {
      await analysisStore.deleteAnalysis({ analysisId: analysis.value.id })
    }
    showAnalysisDeleteDialog.value = false
  }

  fetchCountermeasures()

</script>

<template>
  <!-- eslint-disable vue/no-lone-template -->
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <!-- eslint-disable vue/attribute-hyphenation -->
  <v-dialog
    v-model="showControlDialog"
    class="pa-0 ma-0"
    max-width="75vw"
    @click:outside="emits('control:closed')"
    @keydown.esc="emits('control:closed')"
  >
    <v-card
      class="pa-0 ma-0 rounded-lg"
    >
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="tertiary" size="small">mdi-shield-sword-outline</v-icon>
            <span class="ml-2 text-body-1">Control: {{ controlsStore.controls.find(control => control.id === id)?.name }}</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="emits('control:closed')"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text>
        <v-form @submit.prevent="onSubmit">
          <v-card class="model-card border-thin elevation-8 mb-4">
            <v-container class="pa-5 px-10" fluid>
              <!-- Tabs -->
              <v-row>
                <v-tabs v-model="tab" color="primary">
                  <v-tab prepend-icon="mdi-cog-outline" value="general">General</v-tab>
                  <v-tab prepend-icon="mdi-shield-sword-outline" value="classes">Control Classes</v-tab>
                  <v-tab prepend-icon="mdi-shield-check-outline" value="countermeasures">Countermeasures</v-tab>
                </v-tabs>
              </v-row>

              <!-- Tab Contents -->
              <v-row>
                <v-tabs-window v-model="tab" class="model-tab w-100">
                  <!-- General Tab -->
                  <v-tabs-window-item value="general">
                    <v-container fluid>
                      <v-row>
                        <v-text-field v-model="newName" class="pt-6 px-3" label="Name" />
                      </v-row>
                      <v-row>
                        <!-- <v-col cols="5">
                          <v-text-field label="Version" />
                          <v-text-field label="Status" />
                        </v-col> -->
                        <v-col cols="12">
                          <v-textarea v-model="newDescription" label="Description" rows="6" />
                        </v-col>
                      </v-row>
                    </v-container>
                  </v-tabs-window-item>

                  <!-- Controls Tab -->
                  <v-tabs-window-item class="pt-1" value="classes">
                    <v-data-table
                      v-model="selectedClassIds"
                      class="control-classes"
                      :headers="headers"
                      item-key="id"
                      :items="filteredControlClasses"
                      items-per-page="5"
                      :items-per-page-options="itemsPerPage"
                      show-select
                    >
                      <!-- Search Bar -->
                      <template #top>
                        <div class="d-flex justify-space-around mb-6">
                          <v-text-field v-model="search" append-icon="mdi-magnify" class="mx-4 my-0" label="Search" />
                          <v-autocomplete
                            v-model="selectedModules"
                            chips
                            class="moduleSelector"
                            item-title="name"
                            item-value="id"
                            :items="availableModules"
                            label="In modules"
                            multiple
                          />
                          <v-btn
                            v-model="onlySelected"
                            class="mx-3 my-0"
                            :color="onlySelected ? 'secondary' : 'grey'"
                            :icon="onlySelected ? 'mdi-filter-check-outline' : 'mdi-filter-outline'"
                            size="x-large"
                            variant="outlined"
                            @click="onlySelected = !onlySelected"
                          />
                          <v-btn
                            v-if="controlId && (analysis === null || ['idle'].includes(analysis.status?.status ?? ''))"
                            color="amber"
                            icon="mdi-creation-outline"
                            size="x-large"
                            variant="plain"
                            @click="showConfirmClassCreationDialog = true"
                            @contextmenu.prevent="showAnalysisDeleteDialog = true"
                          />
                          <v-progress-circular
                            v-if="controlId && analysis && ['busy', 'running'].includes(analysis.status?.status ?? '')"
                            class="ma-1 mt-2 run-analysis-button-progress"
                            color="amber"
                            indeterminate
                            :size="30"
                            @click="openAnalysisFlow()"
                            @contextmenu.prevent="showAnalysisDeleteDialog = true"
                          />
                          <v-btn
                            v-if="controlId && analysis && ['interrupted'].includes(analysis.status?.status ?? '')"
                            color="warning"
                            icon="mdi-forum-outline"
                            size="x-large"
                            variant="plain"
                            @click="openAnalysisFlow()"
                            @contextmenu.prevent="showAnalysisDeleteDialog = true"
                          />
                          <v-btn
                            v-if="controlId && analysis && ['error'].includes(analysis.status?.status ?? '')"
                            color="error"
                            icon="mdi-alert-circle-outline"
                            size="x-large"
                            variant="plain"
                            @click="openAnalysisFlow()"
                            @contextmenu.prevent="showAnalysisDeleteDialog = true"
                          />
                        </div>
                      </template>
                      <template #item.actions="{ item }">
                        <v-btn
                          class="mr-2"
                          color="primary"
                          icon="mdi-tune"
                          variant="plain"
                          @click="showClassControl(item.id)"
                        />
                      </template>
                    </v-data-table>
                  </v-tabs-window-item>

                  <!-- Countermeasures Tab -->
                  <v-tabs-window-item value="countermeasures">
                    <v-data-table :headers="countermeasuresHeaders" :items="countermeasures">
                      <template #top>
                        <v-btn
                          class="ma-3"
                          color="primary"
                          icon="mdi-plus"
                          size="large"
                          variant="outlined"
                          @click="showCountermeasure(null)"
                        />
                      </template>
                      <template #item.mitigations="{ item }">
                        <v-chip
                          v-for="mitigation in item.mitigations"
                          :key="mitigation.id"
                          class="ma-1"
                          color="blue"
                          @click="showMitigation(mitigation.attack_id)"
                        >
                          {{ mitigation.name }} ({{ mitigation.attack_id }})
                        </v-chip>
                        <v-chip
                          v-for="technique in item.defendedTechniques"
                          :key="technique.id"
                          class="ma-1"
                          color="green"
                          @click="showDefendTechnique(technique.d3fendId)"
                        >
                          {{ technique.name }} ({{ technique.d3fendId }})
                        </v-chip>
                      </template>
                      <template #item.actions="{ item }">
                        <v-btn
                          class="mr-2"
                          color="primary"
                          icon="mdi-pencil"
                          variant="plain"
                          @click="showCountermeasure(item.id)"
                        />
                        <v-btn
                          class="mr-2"
                          color="error"
                          icon="mdi-trash-can"
                          variant="plain"
                          @click="showDeleteCountermeasure(item.id)"
                        />
                      </template>
                    </v-data-table>
                  </v-tabs-window-item>
                </v-tabs-window>
              </v-row>
            </v-container>
            <v-card-actions>
              <v-btn
                class="ma-3"
                color="success"
                icon="mdi-content-save-outline"
                size="x-large"
                type="submit"
                variant="outlined"
              />
              <template v-if="showFileActions">
                <v-btn
                  class="ma-3"
                  color="secondary"
                  icon="mdi-download-outline"
                  size="x-large"
                  variant="outlined"
                />
                <v-btn
                  class="ma-3"
                  color="secondary"
                  icon="mdi-content-duplicate"
                  size="x-large"
                  variant="outlined"
                />
                <v-btn
                  class="ma-3"
                  color="secondary"
                  icon="mdi-file-move-outline"
                  size="x-large"
                  variant="outlined"
                  @click="showFolderSelectDialog = true"
                />
                <v-btn
                  class="mr-2"
                  color="error"
                  icon="mdi-trash-can-outline"
                  size="x-large"
                  variant="outlined"
                  @click="showDelete(controlId)"
                />
              </template>
            </v-card-actions>
          </v-card>
        </v-form>

        <!-- Snackbar -->
        <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
          {{ snackBar.message }}
        </v-snackbar>
        <!-- <ClassConfigDialog
          v-if="showClassControlDialog"
          :id="controlId"
          :classid="selectedClassId"
          :show="showClassControlDialog"
          @cancel="onClassControlDialogCancel"
          @submit="onClassControlDialogSubmit"
        /> -->
        <AttributesDialog
          v-if="showClassControlDialog"
          :show="showClassControlDialog"
          :item-class="currentItemClass"
          :item-id="controlId ?? null"
          :item-name="controlsStore.controls.find(control => control.id === id)?.name ?? null"
          :attributes-data="attributesData"
          :attributes-schema="attributesSchema"
          :attributes-ui-schema="attributesUiSchema"
          :attributes-loading="attributesLoading"
          :attributes-template-warning="attributesTemplateWarning"
          @attributes:changed="onAttributesChanged"
          @close="showClassControlDialog = false"
        />
        <ConfirmDeleteDialog
          v-if="showDeleteControlsDialog"
          :message="`Are you sure you want to delete this Control: ${control?.name ?? ''}?`"
          :show="showDeleteControlsDialog"
          @delete:canceled="showDeleteControlsDialog = false"
          @delete:confirmed="onControlDelete"
        />
        <AttackMitigationDialog
          v-if="showMitigationDialog"
          :attackId="mitigationId"
          :show="showMitigationDialog"
          @close="showMitigationDialog = false"
        />
        <DefendTechniqueDialog
          v-if="showDefendTechniqueDialog"
          :d3fendId="d3fendId"
          :show="showDefendTechniqueDialog"
          @close="showDefendTechniqueDialog = false"
        />
        <CounterMeasureDialog
          v-if="showCountermeasureDialog"
          :action="countermeasureAction"
          :controlId="controlId"
          :countermeasureId="countermeasureId"
          :showDialog="showCountermeasureDialog"
          @close="showCountermeasureDialog = false"
          @countermeasure:created="onCountermeasureCreated"
          @countermeasure:failed="onCountermeasureFailed"
          @countermeasure:updated="onCountermeasureUpdated"
        />
        <ConfirmDeleteDialog
          v-if="showDeleteCountermeasureDialog"
          :message="`Are you sure you want to delete this Countermeasure: ${countermeasures.find(cm => cm.id === countermeasureId)?.name ?? ''}?`"
          :show="showDeleteCountermeasureDialog"
          @delete:canceled="showDeleteCountermeasureDialog = false"
          @delete:confirmed="onCountermeasureDelete"
        />
        <AnalysisFlowDialog
          :analysisId="analysis?.id ?? undefined"
          :show="showAnalysisFlowDialog"
          @close="closeAnalysisFlow"
        />
        <FolderSelectDialog
          v-if="showFolderSelectDialog"
          :show="showFolderSelectDialog"
          @close="showFolderSelectDialog = false"
          @move="moveToFolder"
        />
        <ConfirmClassCreationDialog
          v-if="showConfirmClassCreationDialog"
          :show="showConfirmClassCreationDialog"
          @create:confirmed="showConfirmClassCreationDialog = false; runAnalysis()"
          @dialog:closed="showConfirmClassCreationDialog = false"
        />

        <ConfirmDeleteDialog
          v-if="showAnalysisDeleteDialog"
          message="Are you sure you want to delete the analysis?"
          :show="showAnalysisDeleteDialog"
          @delete:canceled="showAnalysisDeleteDialog = false"
          @delete:confirmed="deleteAnalysis"
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
  .moduleSelector {
    max-width: 300px;
  }

  .model-tab {
    height: 380px;
    overflow-y: auto;
  }

  .control-classes {
    height: 370px;
    overflow-y: auto;
  }
</style>
