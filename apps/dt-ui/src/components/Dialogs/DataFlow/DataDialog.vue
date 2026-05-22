<script setup lang="ts">
  import { useFlowStore } from '@/stores/flowStore'
  import { useIssueStore } from '@/stores/issueStore'
  import { computed, onMounted, onUnmounted, ref, shallowRef, watch, nextTick } from 'vue'
  import type { UISchemaElement } from '@jsonforms/core'
  import { flattenProperties, unflattenProperties } from '@/utils/dataFlowUtils'
  import { Exposure, RECOMMENDED_REGULATORY_FLAGS } from '@dethernety/dt-core'
  import AttributesForm from '@/components/DataFlow/AttributesForm.vue'
  import AttributesDialog from '@/components/DataFlow/AttributesDialog.vue'
  import ClassPicker from '@/components/DataFlow/ClassPicker/ClassPicker.vue'
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

  const flowStore = useFlowStore()
  const issueStore = useIssueStore()

  const name = ref('')
  const description = ref('')
  const dataClass = ref<string | null>(null)

  // Asset-context. sensitivity holds the platform enum token (PUBLIC/INTERNAL/
  // CONFIDENTIAL/RESTRICTED) or null (unclassified); dt-core's update is case-
  // insensitive on the way down. regulatoryFlags is a free-text tag list. Both
  // are seeded on load and always sent on save — dt-core uses REPLACE semantics,
  // so omitting them would clear the platform fields.
  const sensitivity = ref<string | null>(null)
  const regulatoryFlags = ref<string[]>([])
  const sensitivityOptions = [
    { value: 'PUBLIC', title: 'Public', color: 'success' },
    { value: 'INTERNAL', title: 'Internal', color: 'info' },
    { value: 'CONFIDENTIAL', title: 'Confidential', color: 'warning' },
    { value: 'RESTRICTED', title: 'Restricted', color: 'error' },
  ]
  // Suggested regulatory flags (free-text still allowed). Sourced from dt-core's
  // canonical set so the GUI suggestions stay aligned with the dethereal/AI path.
  const regulatoryFlagItems = RECOMMENDED_REGULATORY_FLAGS.map(f => f.flag)
  const regulatoryFlagFramework: Record<string, string> = Object.fromEntries(
    RECOMMENDED_REGULATORY_FLAGS.map(f => [f.flag, f.framework])
  )

  // Attributes — buffered model matching SettingsWindow's pattern.
  // lastLoadedAttributes is the backend snapshot; pendingAttributes is the UI buffer that
  // AttributesForm / AttributesDialog bind to; commits flow back into lastLoadedAttributes
  // via saveAttributes. attributesDirty signals the Attributes-tab portion of isDirty.
  const lastLoadedAttributes = ref<object>({})
  const pendingAttributes = ref<object>({})
  const attributesDirty = ref(false)
  const attributesSchema = shallowRef<object | null>(null)
  const attributesUiSchema = shallowRef<UISchemaElement | null>(null)
  const attributesLoading = ref(false)
  const attributesTemplateWarning = ref(false)

  const tab = ref('general')
  const emit = defineEmits(['update:show', 'data-added', 'cancel-data', 'redirect:issue', 'update:snackBar'])

  const props = defineProps<Props>()
  const showDialog = ref(props.show)
  const dataId = ref(props.id)
  const action = ref(props.action)
  const exposures = ref<Exposure[]>([])
  const exposureDialogAction = ref<'create' | 'edit'>('create')
  const showExposureDialog = ref(false)
  const attackTechniqueId = ref('')
  const showAttackTechniqueDialog = ref(false)
  const exposureToDelete = ref('')
  const showExposureDeleteDialog = ref(false)
  const exposureToEdit = ref('')
  const attributesDialogUseExpansionPanels = ref(true)
  const showAttributesDialog = ref(false)
  const showIssueDialog = ref(false)
  const issueClass = ref<Class | null>(null)
  const issueExposureId = ref('')
  const issueName = ref('')
  const issueDescription = ref('')

  // Dirty tracking — initialState mirrors the persisted (or default-empty) state of the General-tab
  // fields; attributesDirty (declared above) signals the Attributes-tab portion. isDirty drives
  // the close-guard at v-dialog level so the user can't lose edits via Esc / backdrop / X, and
  // gates the Save button enable + Revert button visibility in the toolbar.
  const initialState = ref<{ name: string; description: string; dataClass: string | null; sensitivity: string | null; regulatoryFlags: string[] }>({
    name: '',
    description: '',
    dataClass: null,
    sensitivity: null,
    regulatoryFlags: [],
  })
  const showDiscardChangesDialog = ref(false)

  // Class-change confirm — pendingClassId holds the picker's new selection while the confirm
  // dialog is open; on commit or discard the new id is applied to dataClass, on cancel the
  // picker re-binds to the unchanged dataClass via :model-value.
  const pendingClassId = ref<string | null>(null)
  const showClassChangeDialog = ref(false)

  // Order-sensitive flag comparison; the combobox preserves insertion order and
  // offers no reordering, so a plain JSON compare is a faithful dirty signal.
  const flagsEqual = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)

  const isDirty = computed(() =>
    name.value !== initialState.value.name ||
    description.value !== initialState.value.description ||
    dataClass.value !== initialState.value.dataClass ||
    sensitivity.value !== initialState.value.sensitivity ||
    !flagsEqual(regulatoryFlags.value, initialState.value.regulatoryFlags) ||
    attributesDirty.value
  )

  const router = useRouter()


  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )

  // Attributes management functions (similar to SettingsWindow's buffered model)
  const initializeAttributes = async () => {
    // Set loading state to prevent rendering issues
    attributesLoading.value = true
    attributesSchema.value = null
    attributesUiSchema.value = null
    lastLoadedAttributes.value = {}
    pendingAttributes.value = {}
    attributesDirty.value = false
    attributesTemplateWarning.value = false

    // Add defensive check - wait a tick to ensure data is stable
    await nextTick()

    if (!dataId.value || !dataClass.value) {
      attributesLoading.value = false
      return
    }

    try {
      // Consume the cached class object — the merged dataClass watcher pre-populates
      // currentItemClass.value synchronously inside its tick, before triggering the
      // 100 ms debounce that invokes this function.
      const cls = currentItemClass.value
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

      const loaded = unflattenProperties(rawProperties)
      lastLoadedAttributes.value = loaded
      pendingAttributes.value = loaded
      attributesDirty.value = false
    } catch (e) {
      console.error('DataDialog: Failed to fetch attributes data', e)
      attributesTemplateWarning.value = true
    } finally {
      attributesLoading.value = false
    }
  }

  const saveAttributes = async () => {
    if (!dataId.value || !dataClass.value || attributesLoading.value) return
    if (!attributesDirty.value) return

    try {
      const flatAttributes = flattenProperties(pendingAttributes.value)

      // setInstantiationAttributesWithStaleCount returns the
      // number of dispositioned exposures whose `dispositionStale` flipped to
      // true inside the same write transaction. Surface the count to the user
      // when non-zero.
      const result = await flowStore.setInstantiationAttributesWithStaleCount({
        componentId: dataId.value,
        classId: dataClass.value,
        attributes: flatAttributes,
      })

      lastLoadedAttributes.value = pendingAttributes.value
      attributesDirty.value = false
      // Refetch exposures so the row-level stale flags propagate to the
      // exposures table. The staleFlippedCount is the *count*, not the *which*
      // — refetch tells SettingsExposuresTab which rows to mark stale.
      flowStore.getExposures({ elementId: dataId.value }).then(exp => {
        exposures.value = exp
      })

      const staleCount = result?.staleFlippedCount ?? 0
      if (staleCount > 0) {
        emit('update:snackBar', {
          show: true,
          message: `Attributes saved. ${staleCount} disposition${staleCount === 1 ? '' : 's'} now need${staleCount === 1 ? 's' : ''} review.`,
          color: 'warning',
        })
      } else {
        emit('update:snackBar', { show: true, message: 'Attributes saved successfully', color: 'success' })
      }
    } catch (e) {
      console.error('Failed to save attributes', e)
      emit('update:snackBar', { show: true, message: 'Failed to save attributes', color: 'error' })
    }
  }

  const onAttributesChanged = (data: object) => {
    pendingAttributes.value = data
    attributesDirty.value = true
  }

  const revertPending = () => {
    name.value = initialState.value.name
    description.value = initialState.value.description
    dataClass.value = initialState.value.dataClass
    sensitivity.value = initialState.value.sensitivity
    regulatoryFlags.value = [...initialState.value.regulatoryFlags]
    // Attributes: authoritative re-fetch via the debounced init. If dataClass changed,
    // the watcher coalesces with this call (single initializeAttributes run after 100 ms).
    debouncedInitializeAttributes()
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

  // Reactive reference to store the full class object — consumed by initializeAttributes
  // (template) and currentItemClass-driven children (AttributesForm, AttributesDialog).
  const currentItemClass = ref<any>(null)

  // Single dataClass watcher — fetches the class object once, sets currentItemClass,
  // schema/uischema, and triggers attributes re-init. Previously two watchers + a third
  // getDataClass call inside initializeAttributes fired per class change; now: one call.
  watch(dataClass, async (newDataClass) => {
    if (!newDataClass) {
      currentItemClass.value = null
      attributesSchema.value = null
      attributesUiSchema.value = null
      return
    }
    try {
      const cls = await flowStore.getDataClass({ dataClassId: newDataClass })
      currentItemClass.value = cls
      if (cls) {
        attributesSchema.value = cls.template?.schema ?? null
        attributesUiSchema.value = cls.template?.uischema as UISchemaElement ?? null
        if (dataId.value) {
          debouncedInitializeAttributes()
        }
      }
    } catch (error) {
      console.error('DataDialog: Failed to fetch class object', error)
      currentItemClass.value = null
      attributesSchema.value = null
      attributesUiSchema.value = null
    }
  }, { immediate: true })

  onMounted(async () => {
    await getCurrentDataItem()
  })

  const getCurrentDataItem = async () => {
    if (action.value === 'edit' && dataId.value) {
      const currentDataItem = flowStore.getDataItem({ dataItemId: dataId.value })
      if (currentDataItem) {
        try {
          name.value = currentDataItem.name
          description.value = currentDataItem.description
          dataClass.value = currentDataItem.dataClass?.id ?? null
          sensitivity.value = currentDataItem.sensitivity ?? null
          regulatoryFlags.value = currentDataItem.regulatoryFlags ? [...currentDataItem.regulatoryFlags] : []
          // Initialize attributes using our centralized function
          if (dataClass.value) {
            debouncedInitializeAttributes()
          }
          // Snapshot the persisted state so the dirty bit reads false until the user edits.
          // Re-runs after the create→edit transition (line ~424 below) keep this in sync.
          initialState.value = {
            name: currentDataItem.name,
            description: currentDataItem.description,
            dataClass: currentDataItem.dataClass?.id ?? null,
            sensitivity: currentDataItem.sensitivity ?? null,
            regulatoryFlags: currentDataItem.regulatoryFlags ? [...currentDataItem.regulatoryFlags] : [],
          }
        } catch (error) {
          console.error('Failed to get attributes from class relationship', error)
        }
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
            emit('update:snackBar', { show: true, message: 'Exposure deleted successfully', color: 'success' })
          } else {
            emit('update:snackBar', { show: true, message: 'Failed to delete exposure', color: 'error' })
          }
        })
        .catch(error => {
          console.error('Failed to delete exposure', error)
          emit('update:snackBar', { show: true, message: 'Failed to delete exposure', color: 'error' })
        })
    }
  }

  const onSubmit = async () => {
    if (!name.value || flowStore.selectedItem === null) {
      return
    }
    
    if (action.value === 'edit' && dataId.value) {
      try {
        const generalDirty =
          name.value !== initialState.value.name ||
          description.value !== initialState.value.description ||
          dataClass.value !== initialState.value.dataClass ||
          sensitivity.value !== initialState.value.sensitivity ||
          !flagsEqual(regulatoryFlags.value, initialState.value.regulatoryFlags)

        if (generalDirty) {
          const success = await flowStore.updateDataItem({
            dataItemId: dataId.value,
            name: name.value,
            description: description.value,
            classId: dataClass.value,
            sensitivity: sensitivity.value,
            regulatoryFlags: regulatoryFlags.value,
          })
          if (!success) {
            emit('update:snackBar', { show: true, message: 'Failed to update data entity', color: 'error' })
            return
          }
          // Refresh the snapshot so the dirty bit reads clean after a successful save.
          initialState.value = {
            name: name.value,
            description: description.value,
            dataClass: dataClass.value,
            sensitivity: sensitivity.value,
            regulatoryFlags: [...regulatoryFlags.value],
          }
          emit('update:snackBar', { show: true, message: 'Data entity updated successfully', color: 'success' })
        }

        if (attributesDirty.value) {
          await saveAttributes()
        }
      } catch (error) {
        console.error('Failed to update data entity', error)
        emit('update:snackBar', { show: true, message: 'Failed to update data entity', color: 'error' })
      }
    } else if (action.value === 'create') {
      // Create new DataItem first (without attributes)
      try {
        const newDataItem = await flowStore.createDataItem({
          name: name.value,
          description: description.value,
          classId: dataClass.value || null,
          elementId: flowStore.selectedItem.id,
          sensitivity: sensitivity.value,
          regulatoryFlags: regulatoryFlags.value,
          // Remove attributes from here - they're handled separately
        })
        
        if (!newDataItem) {
          emit('update:snackBar', { show: true, message: 'Failed to create data entity', color: 'error' })
          return
        }
        
        // Update local state to switch to edit mode
        dataId.value = newDataItem.id
        action.value = 'edit'
        
        // Update the dataClass if it was set from the created item
        if (newDataItem.dataClass?.id && !dataClass.value) {
          dataClass.value = newDataItem.dataClass.id
        }
        
        emit('update:snackBar', { show: true, message: 'Data entity created successfully - now in edit mode', color: 'success' })
        
        // Refresh the data to ensure we have the latest information
        await getCurrentDataItem()
        
        // Don't emit 'data-added' for create action to keep dialog open
        // The parent will be notified when the dialog is finally closed or when editing is done
      } catch (error) {
        console.error('Failed to create data entity', error)
        emit('update:snackBar', { show: true, message: 'Failed to create data entity', color: 'error' })
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

  const onAttemptClose = () => {
    if (isDirty.value) {
      showDiscardChangesDialog.value = true
    } else {
      onCancel()
    }
  }

  const onDiscardConfirmed = () => {
    showDiscardChangesDialog.value = false
    onCancel()
  }

  const onDiscardCanceled = () => {
    showDiscardChangesDialog.value = false
  }

  const onPickerCommitRequest = (payload: { classId: string }) => onClassPickerChange(payload.classId)

  const onClassPickerChange = (newId: string) => {
    if (newId === dataClass.value) return
    // Initial class pick: dataClass was never set, or the entity doesn't exist yet
    // (create mode before save). No existing class to lose, no attribute schema to
    // invalidate — skip the confirm dialog.
    if (!dataClass.value || !dataId.value) {
      dataClass.value = newId
      // Auto-persist when we have an entity to update. In pure create mode (no
      // dataId) the explicit Save creates the entity with the staged class.
      if (dataId.value) onSubmit()
      return
    }
    pendingClassId.value = newId
    showClassChangeDialog.value = true
  }

  const onClassChangeCommit = async () => {
    showClassChangeDialog.value = false
    if (pendingClassId.value) {
      dataClass.value = pendingClassId.value
      pendingClassId.value = null
    }
    // Single save persists the class change plus any pending name/description
    // edits — matches SettingsGeneralTab's behaviour where class picks flow
    // through the same auto-save machinery as every other field.
    if (isDirty.value) await onSubmit()
  }

  const onClassChangeDiscard = async () => {
    showClassChangeDialog.value = false
    if (dataId.value) {
      const currentDataItem = flowStore.getDataItem({ dataItemId: dataId.value })
      if (currentDataItem) {
        name.value = currentDataItem.name
        description.value = currentDataItem.description
      }
    }
    if (pendingClassId.value) {
      dataClass.value = pendingClassId.value
      pendingClassId.value = null
    }
    // After discarding pending edits, only the class is dirty — save it.
    if (isDirty.value) await onSubmit()
  }

  const onClassChangeCancel = () => {
    showClassChangeDialog.value = false
    pendingClassId.value = null
    // Picker is bound via :model-value="dataClass" so it auto-restores on next render.
  }

  onUnmounted(() => {
    if (attributesInitTimer) {
      clearTimeout(attributesInitTimer)
    }
  })

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
    :persistent="isDirty"
    @click:outside="onAttemptClose"
    @keydown.esc="onAttemptClose"
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
              @click="onAttemptClose"
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
                        <v-col cols="7">
                          <v-text-field
                            v-model="name"
                            label="Name"
                            required
                          />
                          <v-textarea
                            v-model="description"
                            label="Description"
                          />
                          <div class="d-flex ga-4 align-start">
                            <v-select
                              v-model="sensitivity"
                              clearable
                              :items="sensitivityOptions"
                              label="Sensitivity"
                              persistent-placeholder
                              placeholder="Unclassified"
                              style="flex: 0 0 38%"
                            >
                              <template #item="{ props: itemProps, item }">
                                <v-list-item v-bind="itemProps">
                                  <template #prepend>
                                    <v-icon :color="item.raw.color" size="x-small">mdi-circle</v-icon>
                                  </template>
                                </v-list-item>
                              </template>
                              <template #selection="{ item }">
                                <v-icon :color="item.raw.color" class="mr-2" size="x-small">mdi-circle</v-icon>
                                {{ item.title }}
                              </template>
                            </v-select>
                            <v-combobox
                              v-model="regulatoryFlags"
                              chips
                              class="flex-grow-1 regulatory-flags"
                              closable-chips
                              hint="Pick a recommended scope or type your own (e.g. PCI cardholder, PHI)"
                              :items="regulatoryFlagItems"
                              label="Regulatory flags"
                              multiple
                              style="min-width: 0"
                            >
                              <template #chip="{ props: chipProps }">
                                <v-chip v-bind="chipProps" size="small" />
                              </template>
                              <template #item="{ props: itemProps, item }">
                                <v-list-item v-bind="itemProps" :subtitle="regulatoryFlagFramework[item.title]" />
                              </template>
                            </v-combobox>
                          </div>
                        </v-col>
                        <v-col cols="5">
                          <ClassPicker
                            class-label="DATA"
                            :current-class-name="currentItemClass?.name ?? null"
                            :current-class-category="currentItemClass?.category ?? null"
                            :current-class-description="currentItemClass?.description ?? null"
                            :current-class-module-name="currentItemClass?.module?.name ?? null"
                            :element-description="description"
                            :element-name="name"
                            label="Class"
                            :model-id="flowStore.modelId"
                            :model-value="dataClass"
                            @commit-request="onPickerCommitRequest"
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
                        :attributes-data="pendingAttributes"
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
              v-if="isDirty"
              class="ml-3"
              color="warning"
              size="x-large"
              variant="text"
              @click="revertPending"
            >
              Revert
            </v-btn>
            <v-btn
              class="ml-3"
              color="secondary"
              :disabled="action === 'edit' && !isDirty"
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
  <ConfirmDeleteDialog
    v-if="showDiscardChangesDialog"
    confirm-color="warning"
    confirm-icon="mdi-close-circle-outline"
    icon="mdi-pencil-off-outline"
    message="Discard unsaved changes?"
    :show="showDiscardChangesDialog"
    title="Discard unsaved changes?"
    @delete:canceled="onDiscardCanceled"
    @delete:confirmed="onDiscardConfirmed"
  />
  <ConfirmClassOrModelChangeDialog
    v-if="showClassChangeDialog"
    :has-dirty-edits="isDirty"
    :show="showClassChangeDialog"
    @cancel="onClassChangeCancel"
    @commit-and-change="onClassChangeCommit"
    @discard-and-change="onClassChangeDiscard"
  />
  <AttributesDialog
    v-if="showAttributesDialog"
    :show="showAttributesDialog"
    :item-class="currentItemClass"
    :item-id="dataId ?? null"
    :item-name="name ?? null"
    :attributes-data="pendingAttributes"
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
    height: 260pt;
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

  /* Regulatory-flags tag input: small chips wrap and grow the field naturally
     (no internal scroll); the taller .data-window absorbs the extra rows. */
  .regulatory-flags :deep(.v-field__input) {
    align-content: flex-start;
    max-height: 73px;
    overflow-y: auto;
  }
</style>
