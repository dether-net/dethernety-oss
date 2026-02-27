<script setup lang="ts">
  import { useFlowStore } from '@/stores/flowStore'
  import { useIssueStore } from '@/stores/issueStore'
  import { onMounted, onUnmounted, ref, shallowRef, watch, nextTick } from 'vue'
  import type { UISchemaElement } from '@jsonforms/core'
  import { flattenProperties, unflattenProperties } from '@/utils/dataFlowUtils'
  import { Analysis, Exposure } from '@dethernety/dt-core'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import AttributesForm from '@/components/DataFlow/AttributesForm.vue'
  import AttributesDialog from '@/components/DataFlow/AttributesDialog.vue'
  import IssueDialog from '@/components/Dialogs/Issues/IssueDialog.vue'
  import { useRouter } from 'vue-router'
  import { Class } from '@dethernety/dt-core'
  import { getPageDisplayName } from '@/utils/dataFlowUtils'

  interface Props {
    show: boolean
    class: string
    action: string
    id: string | null
  }

  interface SnackBar {
    show: boolean;
    message: string;
    color: string;
  }

  const flowStore = useFlowStore()
  const analysisStore = useAnalysisStore()
  const issueStore = useIssueStore()

  const name = ref('')
  const description = ref('')
  const dataClass = ref<string | null>(null)
  const availableClasses = ref<{ id: string; name: string }[]>([])

  // Attributes data management (centralized like SettingsWindow)
  const attributesData = ref<object>({})
  const attributesSchema = shallowRef<object | null>(null)
  const attributesUiSchema = shallowRef<UISchemaElement | null>(null)
  const attributesLoading = ref(false)
  const attributesTemplateWarning = ref(false)

  const tab = ref('general')
  const emit = defineEmits(['update:show', 'data-added', 'cancel-data', 'redirect:issue'])

  const props = defineProps<Props>()
  const showDialog = ref(props.show)
  const analysis = ref<Analysis | null>(null)
  const showAnalysisFlowDialog = ref(false)
  const dataId = ref(props.id)
  const action = ref(props.action)
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  const fetchTimer = ref(null)
  const analysisStatus = ref<string | undefined>(undefined)
  const exposures = ref<Exposure[]>([])
  const exposureDialogAction = ref<'create' | 'edit'>('create')
  const showExposureDialog = ref(false)
  const attackTechniqueId = ref('')
  const showAttackTechniqueDialog = ref(false)
  const exposureToDelete = ref('')
  const showExposureDeleteDialog = ref(false)
  const exposureToEdit = ref('')
  const showConfirmClassCreationDialog = ref(false)
  const showAnalysisDeleteDialog = ref(false)
  const attributesDialogUseExpansionPanels = ref(true)
  const showAttributesDialog = ref(false)
  const showIssueDialog = ref(false)
  const issueClass = ref<Class | null>(null)
  const issueExposureId = ref('')
  const issueName = ref('')
  const issueDescription = ref('')

  const router = useRouter()


  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )

  watch(dataClass, newVal => {
    if (newVal) {
      flowStore.getDataClass({
        dataClassId: newVal,
      }).then(cls => {
        if (cls) {
          attributesSchema.value = cls.template?.schema ?? null
          attributesUiSchema.value = cls.template?.uischema as UISchemaElement ?? null
          // Initialize attributes when class changes
          if (dataId.value) {
            debouncedInitializeAttributes()
          }
        }
      })
    }
  })

  // Attributes management functions (similar to SettingsWindow)
  const initializeAttributes = async () => {
    // Set loading state to prevent rendering issues
    attributesLoading.value = true
    attributesSchema.value = null
    attributesUiSchema.value = null
    attributesData.value = {}
    attributesTemplateWarning.value = false

    // Add defensive check - wait a tick to ensure data is stable
    await nextTick()

    if (!dataId.value || !dataClass.value) {
      attributesLoading.value = false
      return
    }

    try {
      // Get the class to set up schema and uischema
      const cls = await flowStore.getDataClass({ dataClassId: dataClass.value })
      if (cls?.template && 
          typeof cls.template.schema === 'object' && 
          typeof cls.template.uischema === 'object') {
        attributesSchema.value = cls.template.schema
        attributesUiSchema.value = cls.template.uischema as UISchemaElement
      } else {
        console.warn('Invalid or missing schema/uischema in the data class')
        attributesTemplateWarning.value = true
        attributesLoading.value = false
        return
      }

      // Fetch attributes from class relationship
      const rawProperties = await flowStore.getAttributesFromClassRelationship({
        componentId: dataId.value,
        classId: dataClass.value,
      })

      attributesData.value = unflattenProperties(rawProperties)
    } catch (e) {
      console.error('DataDialog: Failed to fetch attributes data', e)
      attributesTemplateWarning.value = true
    } finally {
      attributesLoading.value = false
    }
  }

  const saveAttributes = async (data: object) => {
    if (!dataId.value || !dataClass.value || attributesLoading.value) return

    try {
      const flatAttributes = flattenProperties(data)

      await flowStore.setInstantiationAttributes({
        componentId: dataId.value,
        classId: dataClass.value,
        attributes: flatAttributes,
      })
      
      // Update local data
      attributesData.value = data
      flowStore.getExposures({ elementId: dataId.value }).then(exp => {
        exposures.value = exp
      })
      
      // Show success message
      snackBar.value = { show: true, message: 'Attributes saved successfully', color: 'success' }
    } catch (e) {
      console.error('Failed to save attributes', e)
      snackBar.value = { show: true, message: 'Failed to save attributes', color: 'error' }
    }
  }

  const onAttributesChanged = async (data: object) => {
    await saveAttributes(data)
  }

  // Debounced attributes initialization
  let attributesInitTimer: ReturnType<typeof setTimeout> | null = null

  const debouncedInitializeAttributes = () => {
    if (attributesInitTimer) {
      clearTimeout(attributesInitTimer)
    }
    attributesInitTimer = setTimeout(async () => {
      await initializeAttributes()
    }, 100)
  }

  // Reactive reference to store the full class object
  const currentItemClass = ref<any>(null)

  // Watch for changes in dataClass and fetch the full class object
  watch(dataClass, async (newDataClass) => {
    if (!newDataClass) {
      currentItemClass.value = null
      return
    }
    
    try {
      const fullClass = await flowStore.getDataClass({ dataClassId: newDataClass })
      currentItemClass.value = fullClass
    } catch (error) {
      console.error('DataDialog: Failed to fetch class object', error)
      currentItemClass.value = null
    }
  }, { immediate: true })

  onMounted(async () => {
    await getCurrentDataItem()
  })

  const resetModule = async () => {
    const module = await flowStore.getModuleByName({ moduleName: 'dethernety' })

    if (module) {
      flowStore.resetModule({ moduleId: module.id })
    }
  }

  const getAnalysis = async () => {
    analysis.value = null
    analysisStatus.value = undefined
    if (!dataId.value) return
    const a = await analysisStore.getOrCreateAnalysis({ elementId: dataId.value, classType: 'component_class_graph', analysisName: 'Data Item Creation' })
    if (a) {
      analysis.value = a
      analysisStatus.value = a.status?.status
    }
  }

  const updateAnalysis = () => {
    if (!dataId.value || !analysis.value?.id) return
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
          if (flowStore.modelId) {
            flowStore.fetchData({ model: flowStore.modelId }).then(async () => {
              await getCurrentDataItem()
              resetModule()
            })
          }
        }

        // Update the status
        analysisStatus.value = currentStatus
      } else {
        // If analysis not found, try to get it again
        getAnalysis()
      }
    }, 5000) as unknown as null
  }

  const getCurrentDataItem = async () => {
    const modules = flowStore.modules
    availableClasses.value = modules
      .flatMap((module: any) =>
        module.dataClasses.map((cls: any) => ({
          id: cls.id,
          name: cls.name,
        }))
      ).sort((a: { name: string; }, b: { name: any; }) => a.name.localeCompare(b.name))
    if (action.value === 'edit' && dataId.value) {
      const currentDataItem = flowStore.getDataItem({ dataItemId: dataId.value })
      if (currentDataItem) {
        try {
          name.value = currentDataItem.name
          description.value = currentDataItem.description
          dataClass.value = currentDataItem.dataClass?.id ?? null
          // Initialize attributes using our centralized function
          if (dataClass.value) {
            debouncedInitializeAttributes()
          }
        } catch (error) {
          console.error('Failed to get attributes from class relationship', error)
        }
        getAnalysis().then(() => {
          // Initialize the analysis status and start monitoring
          if (analysis.value) {
            analysisStatus.value = analysis.value.status?.status
          }
          // Start the timer after initial fetch
          updateAnalysis()
        })
        if (dataId.value) {
          flowStore.getExposures({ elementId: dataId.value }).then(exp => {
            exposures.value = exp
          })
        }
      }
    }
  }

  const itemsPerPage = [
    { value: 5, title: '5' },
    { value: 10, title: '10' },
    { value: 25, title: '25' },
    { value: 50, title: '50' },
    { value: -1, title: '$vuetify.dataFooter.itemsPerPageAll' },
  ]

  const exposureTableHeaders = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: 'Exploited By', key: 'exploitedBy' },
    { title: '', key: 'actions' },
  ]

  const openAttackTechniqueDialog = (techniqueId: string) => {
    attackTechniqueId.value = techniqueId
    showAttackTechniqueDialog.value = true
  }

  const deleteExposure = (exposureId: string) => {
    exposureToDelete.value = exposureId
    showExposureDeleteDialog.value = true
  }

  const editExposure = (exposureId: string) => {
    exposureToEdit.value = exposureId
    exposureDialogAction.value = 'edit'
    showExposureDialog.value = true
  }

  const onExposureDelete = () => {
    if (exposureToDelete.value) {
      flowStore.deleteExposure({ exposureId: exposureToDelete.value })
        .then(deleted => {
          if (deleted) {
            showExposureDeleteDialog.value = false
            exposureToDelete.value = ''
            getCurrentDataItem()
            snackBar.value = { show: true, message: 'Exposure deleted successfully', color: 'success' }
          } else {
            snackBar.value = { show: true, message: 'Failed to delete exposure', color: 'error' }
          }
        })
        .catch(error => {
          console.error('Failed to delete exposure', error)
          snackBar.value = { show: true, message: 'Failed to delete exposure', color: 'error' }
        })
    }
  }

  const onSubmit = async () => {
    if (!name.value || flowStore.selectedItem === null) {
      return
    }
    
    if (action.value === 'edit' && dataId.value) {
      // Update existing DataItem (without attributes)
      try {
        const success = await flowStore.updateDataItem({
          dataItemId: dataId.value,
          name: name.value,
          description: description.value,
          classId: dataClass.value,
          // Remove attributes from here - they're handled separately
        })
        
        if (success) {
          // Save attributes separately
          if (dataClass.value && Object.keys(attributesData.value).length > 0) {
            await saveAttributes(attributesData.value)
          }
          
          snackBar.value = { show: true, message: 'Data entity updated successfully', color: 'success' }
          // For edit operations, still emit data-added to notify parent of changes
          // eslint-disable-next-line vue/custom-event-name-casing
          emit('data-added')
        } else {
          snackBar.value = { show: true, message: 'Failed to update data entity', color: 'error' }
        }
      } catch (error) {
        console.error('Failed to update data entity', error)
        snackBar.value = { show: true, message: 'Failed to update data entity', color: 'error' }
      }
    } else if (action.value === 'create') {
      // Create new DataItem first (without attributes)
      try {
        const newDataItem = await flowStore.createDataItem({
          name: name.value,
          description: description.value,
          classId: dataClass.value || null,
          elementId: flowStore.selectedItem.id,
          // Remove attributes from here - they're handled separately
        })
        
        if (!newDataItem) {
          snackBar.value = { show: true, message: 'Failed to create data entity', color: 'error' }
          return
        }
        
        // Update local state to switch to edit mode
        dataId.value = newDataItem.id
        action.value = 'edit'
        
        // Update the dataClass if it was set from the created item
        if (newDataItem.dataClass?.id && !dataClass.value) {
          dataClass.value = newDataItem.dataClass.id
        }
        
        // Save attributes separately if we have them
        if (dataClass.value && Object.keys(attributesData.value).length > 0) {
          try {
            await saveAttributes(attributesData.value)
            snackBar.value = { show: true, message: 'Data entity created successfully - now in edit mode', color: 'success' }
          } catch (attributesError) {
            console.error('Failed to save attributes after creation', attributesError)
            snackBar.value = { show: true, message: 'Data entity created, but failed to save attributes - now in edit mode', color: 'warning' }
          }
        } else {
          snackBar.value = { show: true, message: 'Data entity created successfully - now in edit mode', color: 'success' }
        }
        
        // Refresh the data to ensure we have the latest information
        await getCurrentDataItem()
        
        // Don't emit 'data-added' for create action to keep dialog open
        // The parent will be notified when the dialog is finally closed or when editing is done
      } catch (error) {
        console.error('Failed to create data entity', error)
        snackBar.value = { show: true, message: 'Failed to create data entity', color: 'error' }
      }
    }
  }

  const onCancel = () => {
    // If we switched to edit mode (meaning we created something), notify parent on close
    if (action.value === 'edit' && dataId.value) {
      // eslint-disable-next-line vue/custom-event-name-casing
      emit('data-added')
    } else {
      // eslint-disable-next-line vue/custom-event-name-casing
      emit('cancel-data')
    }
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

  onUnmounted(() => {
    if (fetchTimer.value) {
      clearInterval(fetchTimer.value)
    }
    if (attributesInitTimer) {
      clearTimeout(attributesInitTimer)
    }
  })

  const openAnalysisFlow = async (id: string | undefined) => {
    if (!id) return
    showAnalysisFlowDialog.value = true
  }

  const closeAnalysisFlow = () => {
    showAnalysisFlowDialog.value = false
    // Keep the timer running to monitor analysis completion
  }

  const deleteAnalysis = async () => {
    if (analysis.value?.id) {
      await analysisStore.deleteAnalysis({ analysisId: analysis.value.id })
    }
    showAnalysisDeleteDialog.value = false
  }

  const onAddIssue = (data: {issueClass: Class, id: string, name: string, description: string}) => {
    issueClass.value = data.issueClass
    issueExposureId.value = data.id
    issueName.value = data.name + ' Issue on ' + (name.value as string)
    issueDescription.value =  data.description
    showIssueDialog.value = true
  }

  const onCopyToIssue = (data: {id: string, name: string, description: string}) => {
    // Get current route information dynamically
    const currentRoute = router.currentRoute.value
    const returnTo = {
      name: getPageDisplayName(currentRoute.path),
      path: currentRoute.path,
      query: { ...currentRoute.query },
    }

    issueStore.setIssueDataClipboard({
      name: data.name,
      description: data.name + ' Issue on ' + (name.value as string) + data.description,
      elementIds: [data.id, dataId.value || '', flowStore.selectedItem?.id || '', flowStore.modelId || ''],
      returnTo,
    })
    emit('redirect:issue')
  }

  const onIssueAdded = () => {
    showIssueDialog.value = false
    issueClass.value = null
    issueExposureId.value = ''
  }


</script>

<template>
  <!-- eslint-disable vue/no-lone-template -->
  <v-dialog
    v-model="showDialog"
    max-width="1300px"
    @click:outside="onCancel"
    @keydown.esc="onCancel"
  >
    <v-form @submit.prevent="onSubmit">
      <v-card class="overflow-hidden pa-0 ma-0 rounded-lg">
        <v-card-title class="pa-0">
          <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
            <div>
              <v-icon color="tertiary" size="small">mdi-vector-polyline</v-icon>
              <span class="ml-2 text-body-1">{{ action === 'create' ? 'Create New Data Entity' : 'Edit Data Entity' }}</span>
            </div>
            <v-btn
              color="foreground"
              icon="mdi-close"
              size="medium"
              variant="text"
              @click="onCancel"
            />
          </v-sheet>
        </v-card-title>
        <v-card-text>
          <v-container class="pa-0" fluid>
            <v-row class="ma-2" no-gutters>
              <v-col cols="2">
                <v-tabs
                  v-model="tab"
                  background-color="transparent"
                  color="primary"
                  direction="vertical"
                >
                  <v-tab prepend-icon="mdi-cog-outline" text="General" value="general" />
                  <v-tab prepend-icon="mdi-tune-vertical" text="Attributes" value="attributes" />
                  <v-tab prepend-icon="mdi-bug-outline" text="Exposures" value="exposures" />
                </v-tabs>
              </v-col>
              <v-col cols="10">
                <v-tabs-window v-model="tab" class="data-window elevation-8">

                  <v-tabs-window-item value="general">
                    <v-container>
                      <v-row>
                        <v-col cols="4">
                          <v-text-field
                            v-model="name"
                            label="Name"
                            required
                          />
                          <v-autocomplete
                            v-model="dataClass"
                            item-title="name"
                            item-value="id"
                            :items="availableClasses"
                            label="Class"
                            required
                          />
                          <div class="mx-3 mt-1">
                            <v-btn
                              v-if="dataId && (analysis === null || ['idle'].includes(analysis.status?.status ?? ''))"
                              color="amber"
                              icon="mdi-creation-outline"
                              variant="plain"
                              @click="showConfirmClassCreationDialog = true"
                              @contextmenu.prevent="showAnalysisDeleteDialog = true"
                            />
                            <v-progress-circular
                              v-if="dataId && analysis && ['busy', 'running'].includes(analysis.status?.status ?? '')"
                              class="ma-1 run-analysis-button-progress"
                              color="amber"
                              indeterminate
                              :size="20"
                              @click="openAnalysisFlow(dataId)"
                              @contextmenu.prevent="showAnalysisDeleteDialog = true"
                            />
                            <v-btn
                              v-if="dataId && analysis && ['interrupted'].includes(analysis.status?.status ?? '')"
                              color="warning"
                              icon="mdi-forum-outline"
                              variant="plain"
                              @click="openAnalysisFlow(dataId)"
                              @contextmenu.prevent="showAnalysisDeleteDialog = true"
                            />
                            <v-btn
                              v-if="dataId && analysis && ['error'].includes(analysis.status?.status ?? '')"
                              color="error"
                              icon="mdi-alert-circle-outline"
                              variant="plain"
                              @click="openAnalysisFlow(dataId)"
                              @contextmenu.prevent="showAnalysisDeleteDialog = true"
                            />
                          </div>
                        </v-col>
                        <v-col cols="7">
                          <v-textarea
                            v-model="description"
                            label="Description"
                          />
                        </v-col>
                      </v-row>
                    </v-container>
                  </v-tabs-window-item>

                  <v-tabs-window-item value="attributes">
                    <v-sheet class="flex-grow-1 pa-4 attributes-form">
                      <AttributesForm
                        :item-id="dataId"
                        :item-class="currentItemClass"
                        :attributes-data="attributesData"
                        :schema="attributesSchema"
                        :uischema="attributesUiSchema"
                        :is-loading="attributesLoading"
                        :template-warning="attributesTemplateWarning"
                        :use-expansion-panels="attributesDialogUseExpansionPanels"
                        @attributes:changed="onAttributesChanged"
                      />
                    </v-sheet>
                    <v-hover>
                      <template #default="{ isHovering, props }">
                        <v-sheet
                          class="position-absolute top-0 right-0 ma-0 mt-0 mr-1 pa-0 d-flex flex-row align-center justify-center border-thin border-tertiary border-opacity-50 rounded-lg opacity-80"
                          @hover="console.log('hover')"
                        >
                          <v-fab
                            v-bind="props"
                            class="ma-1"
                            color="tertiary"
                            :icon="attributesDialogUseExpansionPanels ? 'mdi-tab' : 'mdi-table-column'"
                            :size="isHovering ? 'large' : 'small'"
                            variant="plain"
                            @click="attributesDialogUseExpansionPanels = !attributesDialogUseExpansionPanels"
                          />
                          <v-fab
                            v-bind="props"
                            class="ma-1"
                            color="tertiary"
                            icon="mdi-window-maximize"
                            :size="isHovering ? 'large' : 'small'"
                            variant="plain"
                            @click="showAttributesDialog = true"
                          />
                        </v-sheet>
                      </template>
                    </v-hover>
                  </v-tabs-window-item>

                  <v-tabs-window-item value="exposures">
                    <div>
                      <v-data-table
                        v-if="dataId"
                        class="exposures-table"
                        :headers="exposureTableHeaders"
                        :items="exposures"
                        items-per-page="5"
                        :items-per-page-options="itemsPerPage"
                      >
                        <template #top>
                          <div class="d-flex justify-end mt-1 mr-5">
                            <v-btn
                              class="mx-2 my-0"
                              color="secondary"
                              icon="mdi-plus"
                              variant="outlined"
                              @click="exposureDialogAction = 'create'; showExposureDialog = true"
                            />
                          </div>
                        </template>

                        <template #item.exploitedBy="{ item }">
                          <div>
                            <v-chip
                              v-for="templ in item.exploitedBy || []"
                              :key="templ.id"
                              class="ma-1"
                              small
                              @click="openAttackTechniqueDialog(templ.attack_id)"
                            >
                              {{ templ.name + ' (' + templ.attack_id + ')' }}
                            </v-chip>
                          </div>
                        </template>
                        <template #item.actions="{ item }">
                          <div class="d-flex flex-column justify-end">
                            <IssueSelector
                              :id="item.id || ''"
                              :name="item.name || ''"
                              :description="'Exposure: ' + (item.description || '')"
                              @add:issue="onAddIssue"
                              @copy:issue="onCopyToIssue"
                            />
                            <v-btn
                              class="ma-1"
                              color="primary"
                              icon="mdi-pencil"
                              variant="plain"
                              @click="editExposure(item.id)"
                            />
                            <v-btn
                              color="error"
                              icon="mdi-trash-can"
                              variant="plain"
                              @click="deleteExposure(item.id)"
                            />
                          </div>
                        </template>
                      </v-data-table>
                    </div>
                  </v-tabs-window-item>
                </v-tabs-window>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions class="pb-5 mx-6 d-flex justify-end">
          <v-spacer />
          <div>
            <IssueSelector
              :id="dataId ?? ''"
              name="New Data Entity"
              description="New Data Entity"
              size="x-large"
              variant="outlined"
              @add:issue="onAddIssue"
              @copy:issue="onCopyToIssue"
            />
            <v-btn
              class="ml-3"
              color="secondary"
              icon="mdi-content-save"
              size="x-large"
              type="submit"
              variant="outlined"
            />
          </div>
        </v-card-actions>
      </v-card>
    </v-form>
  </v-dialog>

  <AnalysisFlowDialog
    v-if="analysis && showAnalysisFlowDialog"
    :analysis-id="analysis?.id ?? undefined"
    :show="showAnalysisFlowDialog"
    @close="closeAnalysisFlow"
  />

  <AttackTechniqueDialog
    v-if="showAttackTechniqueDialog"
    :attack-id="attackTechniqueId"
    :show="showAttackTechniqueDialog"
    @close="showAttackTechniqueDialog = false; attackTechniqueId = ''"
  />
  <ExposureDialog
    v-if="showExposureDialog"
    :action="exposureDialogAction"
    :element-id="dataId || undefined"
    :exposure-id="exposureToEdit || undefined"
    :show-dialog="showExposureDialog"
    @update:element-id="dataId = $event"
    @update:exposure-created="getCurrentDataItem"
    @update:exposure-updated="getCurrentDataItem"
    @update:show-dialog="showExposureDialog = $event"
  />
  <ConfirmDeleteDialog
    v-if="showExposureDeleteDialog"
    :message="`Are you sure you want to delete this Exposure: ${exposures.find(exposure => exposure.id === exposureToDelete)?.name ?? ''}?`"
    :show="showExposureDeleteDialog"
    @delete:canceled="showExposureDeleteDialog = false"
    @delete:confirmed="onExposureDelete"
  />
  <ConfirmClassCreationDialog
    v-if="showConfirmClassCreationDialog"
    :show="showConfirmClassCreationDialog"
    @create:confirmed="showConfirmClassCreationDialog = false; runAnalysis()"
    @dialog:closed="showConfirmClassCreationDialog = false"
  />

  <template>
    <v-snackbar
      v-model="snackBar.show"
      :color="snackBar.color"
      timeout="5000"
      top
    >
      {{ snackBar.message }}
    </v-snackbar>
  </template>
  <ConfirmDeleteDialog
    v-if="showAnalysisDeleteDialog"
    message="Are you sure you want to delete the analysis?"
    :show="showAnalysisDeleteDialog"
    @delete:canceled="showAnalysisDeleteDialog = false"
    @delete:confirmed="deleteAnalysis"
  />
  <AttributesDialog
    v-if="showAttributesDialog"
    :show="showAttributesDialog"
    :item-class="currentItemClass"
    :item-id="dataId ?? null"
    :item-name="name ?? null"
    :attributes-data="attributesData"
    :attributes-schema="attributesSchema"
    :attributes-ui-schema="attributesUiSchema"
    :attributes-loading="attributesLoading"
    :attributes-template-warning="attributesTemplateWarning"
    @attributes:changed="onAttributesChanged"
    @close="showAttributesDialog = false"
    @redirect:issue="emit('redirect:issue')"
  />
  <IssueDialog
    v-if="showIssueDialog"
    :element-ids="[dataId || '', flowStore.selectedItem?.id || '', flowStore.modelId || '', issueExposureId || '']"
    :issue-class="issueClass || undefined"
    :issue-description="issueDescription"
    :issue-name="issueName"
    :show="showIssueDialog"
    @cancel:issue="showIssueDialog = false"
    @issue:added="onIssueAdded"
  />
</template>

<style scoped>
  .data-window {
    height: 230pt;
    overflow-y: auto;
  }

  .controls-table {
    max-height: 300px;
    overflow-y: auto;
  }

  .attributes-form {
    height: 310px !important;
    overflow-y: auto;
  }

  .attributes-form :deep(.json-forms) {
    max-height: 270px !important;
    overflow-y: auto;
  }

  .attributes-form :deep(.v-col) {
    max-height: 260px !important;
    overflow-y: auto;
  } 

  .attributes-form :deep(.v-container) {
    max-height: 270px !important;
    overflow-y: hidden;
  }
</style>
