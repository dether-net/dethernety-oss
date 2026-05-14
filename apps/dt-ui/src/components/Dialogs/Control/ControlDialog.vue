<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue'
  import { useControlsStore } from '@/stores/controlsStore'
  import { Class, Control, Countermeasure } from '@dethernety/dt-core'
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

  watch(
    () => props.show,
    newVal => {
      showControlDialog.value = newVal
    }
  )
  const emits = defineEmits(['control:deleted', 'control:moved', 'control:closed', 'control:saved'])

  const controlsStore = useControlsStore()
  const showClassControlDialog = ref(false)
  const selectedClassId = ref('')
  const currentItemClass = ref<Class | null>(null)
  const newName = ref('')
  const newDescription = ref('')
  const control = ref<Control | null>(null)
  const controlsToDelete = ref('')
  const form = ref<HTMLFormElement | null>(null)

  const nameRules = [
    (v: string) => !!v || 'Name is required',
    (v: string) => v.length <= 100 || 'Name must be less than 100 characters',
    (v: string) => v.length >= 3 || 'Name must be at least 3 characters',
  ]
  const showDeleteControlsDialog = ref(false)
  const showCountermeasureDialog = ref(false)
  const showDeleteCountermeasureDialog = ref(false)
  const countermeasureAction = ref<'create' | 'update'>('create')
  const countermeasureId = ref<string | null>(null)
  const showDefendTechniqueDialog = ref(false)
  const d3fendId = ref('')

  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  const tab = ref('general')
  const showMitigationDialog = ref(false)
  const mitigationId = ref('')

  const showFolderSelectDialog = ref(false)

  const availableClasses = ref<Class[]>([])

  const lastLoadedAttributes = ref<object>({})
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

  // Class un-assignment confirm: cache populated on getControl by parallel-
  // fetching getAttributesFromClassRelationship for every assigned class.
  // Used by onClassSelectionChange to gate the prompt — only classes that
  // have stored attributes prompt on un-assign (those are the destructive
  // toggles). Maintained in sync by onAttributesSave (B3).
  const classesWithAttributes = ref<Set<string>>(new Set())
  const showClassRemovalConfirmDialog = ref(false)
  const pendingClassSelection = ref<string[]>([])
  const pendingRemovedClassIds = ref<string[]>([])
  // Bumped on cancel-removal so v-data-table fully re-mounts and reads
  // :model-value cleanly from selectedClassIds (which still reflects the
  // un-clicked selection). Vuetify's table doesn't reliably revert its
  // internal selection from a same-content prop reassign — a re-mount
  // is the surest reset.
  const classTableKey = ref(0)

  // Dirty tracking — initialState snapshot captured on getControl resolve and
  // refreshed on every successful save. Attributes deliberately excluded:
  // they're persisted via their own onAttributesChanged flow, so they're
  // "always clean" from the General/Classes buffer's perspective.
  const initialState = ref<{ name: string; description: string; classIds: string[] }>({
    name: '',
    description: '',
    classIds: [],
  })

  const setEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every(x => b.includes(x))

  const isDirty = computed(() =>
    newName.value !== initialState.value.name ||
    newDescription.value !== initialState.value.description ||
    !setEqual(selectedClassIds.value, initialState.value.classIds)
  )

  const showDiscardChangesDialog = ref(false)

  const onAttemptClose = () => {
    if (isDirty.value) {
      showDiscardChangesDialog.value = true
    } else {
      emits('control:closed')
    }
  }

  const onDiscardConfirmed = () => {
    showDiscardChangesDialog.value = false
    emits('control:closed')
  }

  const onDiscardCanceled = () => {
    showDiscardChangesDialog.value = false
  }

  const onClassSelectionChange = (newSelection: string[]) => {
    const oldSelection = selectedClassIds.value
    const removed = oldSelection.filter(id => !newSelection.includes(id))
    const removedWithAttrs = removed.filter(id => classesWithAttributes.value.has(id))

    if (removedWithAttrs.length === 0) {
      selectedClassIds.value = newSelection
      return
    }

    pendingClassSelection.value = newSelection
    pendingRemovedClassIds.value = removedWithAttrs
    showClassRemovalConfirmDialog.value = true
  }

  const onClassRemovalConfirmed = () => {
    const newClassIds = pendingClassSelection.value
    const removedIds = pendingRemovedClassIds.value
    pendingClassSelection.value = []
    pendingRemovedClassIds.value = []
    showClassRemovalConfirmDialog.value = false

    // Commit the un-assignment immediately. Use the persisted name /
    // description from initialState so this commits ONLY the class
    // change — any pending name / description edits stay dirty for the
    // user's main Save click.
    controlsStore.updateControl({
      controlId: control.value?.id || '',
      name: initialState.value.name,
      description: initialState.value.description,
      controlClasses: newClassIds,
      folderId: control.value?.folder?.id || undefined,
    }).then(ret => {
      if (ret) {
        selectedClassIds.value = newClassIds
        removedIds.forEach(id => classesWithAttributes.value.delete(id))
        initialState.value = {
          name: initialState.value.name,
          description: initialState.value.description,
          classIds: [...newClassIds],
        }
        snackBar.value = { show: true, message: 'Class removed', color: 'success' }
        fetchCountermeasures()
      } else {
        snackBar.value = { show: true, message: 'Failed to remove class', color: 'error' }
        // Restore the table's checkbox to match the unchanged
        // selectedClassIds — re-mount via key bump (same reason as
        // onClassRemovalCanceled).
        classTableKey.value++
      }
    }).catch(() => {
      snackBar.value = { show: true, message: 'Failed to remove class', color: 'error' }
      classTableKey.value++
    })
  }

  const onClassRemovalCanceled = () => {
    // ConfirmDeleteDialog double-fires delete:canceled (once from its
    // showDialog watcher, once from cancelDelete itself) — and ALSO
    // fires it as a side effect of confirm (showDialog flips to false
    // before the explicit confirm emit, tripping the watcher). Guard
    // makes this handler idempotent: only the first invocation does
    // work; subsequent firings short-circuit on the already-false flag.
    if (!showClassRemovalConfirmDialog.value) return
    pendingClassSelection.value = []
    pendingRemovedClassIds.value = []
    showClassRemovalConfirmDialog.value = false
    // Force v-data-table to fully re-mount so the checkbox re-syncs to
    // selectedClassIds (which still reflects the un-clicked state).
    // Reassigning the array with the same content was insufficient —
    // Vuetify's selection logic doesn't reliably revert from a prop
    // change when the content compares equal.
    classTableKey.value++
  }

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
    controlsStore.getCountermeasuresFromControl({ controlId: props.id }).then(cm => {
      if (cm) {
        countermeasures.value = cm
      }
    })
  }

  const getControl = async () => {
    controlsStore.getControl({ controlId: props.id }).then(async controlData => {
      control.value = controlData
      newName.value = control.value?.name || ''
      newDescription.value = control.value?.description || ''
      selectedClassIds.value = control.value?.controlClasses?.map(cls => cls.id) || []
      onlySelected.value = (control.value?.controlClasses?.length ?? 0) > 0
      initialState.value = {
        name: newName.value,
        description: newDescription.value,
        classIds: [...selectedClassIds.value],
      }
      const classIds = control.value?.controlClasses?.map(cls => cls.id) || []
      if (classIds.length > 0) {
        const results = await Promise.all(
          classIds.map(classId =>
            controlsStore.getAttributesFromClassRelationship({
              classId,
              componentId: props.id,
            })
              .then(attrs => ({ classId, hasAttrs: Object.keys(attrs ?? {}).length > 0 }))
              .catch(() => ({ classId, hasAttrs: false }))
          )
        )
        classesWithAttributes.value = new Set(
          results.filter(r => r.hasAttrs).map(r => r.classId)
        )
      }
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
    getControl()
  })

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
            componentId: props.id,
          }).then(attributes => {
            if (attributes) {
              lastLoadedAttributes.value = unflattenProperties(attributes)
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

  const saveAttributes = (pending: object): Promise<boolean> => {
    return controlsStore.setInstantiationAttributes({
      classId: selectedClassId.value,
      componentId: props.id,
      attributes: pending,
    }).then(ret => {
      if (ret) {
        lastLoadedAttributes.value = pending
        if (Object.keys(pending).length > 0) {
          classesWithAttributes.value.add(selectedClassId.value)
        } else {
          classesWithAttributes.value.delete(selectedClassId.value)
        }
        snackBar.value = { show: true, message: 'Attributes saved', color: 'success' }
        fetchCountermeasures()
        return true
      }
      snackBar.value = { show: true, message: 'Failed to save attributes', color: 'error' }
      return false
    }).catch(() => {
      snackBar.value = { show: true, message: 'Failed to save attributes', color: 'error' }
      return false
    })
  }

  const onAttributesSave = (pending: object) => {
    saveAttributes(pending)
  }

  const onAttributesSaveAndClose = async (pending: object) => {
    const success = await saveAttributes(pending)
    if (success) showClassControlDialog.value = false
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
    controlsStore.deleteControl({ controlId: props.id }).then(ret => {
      if (ret) {
        emits('control:deleted', true)
      } else {
        emits('control:deleted', false)
      }
    })
    showDeleteControlsDialog.value = false
  }

  const onSubmit = async () => {
    if (!form.value) return
    const { valid } = await form.value.validate()
    if (!valid) return
    controlsStore.updateControl({
      controlId: control.value?.id || '',
      name: newName.value,
      description: newDescription.value,
      controlClasses: selectedClassIds.value,
      folderId: control.value?.folder?.id || undefined,
    }).then(ret => {
      if (ret) {
        initialState.value = {
          name: newName.value,
          description: newDescription.value,
          classIds: [...selectedClassIds.value],
        }
        snackBar.value = { show: true, message: 'Control updated', color: 'success' }
        emits('control:saved', true)
        fetchCountermeasures()
      } else {
        snackBar.value = { show: true, message: 'Failed to update control', color: 'error' }
        emits('control:saved', false)
      }
    }).catch(() => {
      snackBar.value = { show: true, message: 'Failed to update control', color: 'error' }
      emits('control:saved', false)
    })
  }

  const moveToFolder = (folderId: string) => {
    controlsStore.updateControl({
      controlId: props.id,
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
    :persistent="isDirty"
    @click:outside="onAttemptClose"
    @keydown.esc="onAttemptClose"
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
            @click="onAttemptClose"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text>
        <v-form ref="form" @submit.prevent="onSubmit">
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
                        <v-text-field v-model="newName" class="pt-6 px-3" label="Name" required :rules="nameRules" />
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
                      :key="classTableKey"
                      class="control-classes"
                      :headers="headers"
                      item-key="id"
                      :items="filteredControlClasses"
                      items-per-page="5"
                      :items-per-page-options="itemsPerPage"
                      :model-value="selectedClassIds"
                      show-select
                      @update:model-value="onClassSelectionChange"
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
                :disabled="!isDirty"
                icon="mdi-content-save-outline"
                size="x-large"
                type="submit"
                variant="outlined"
              />
              <template v-if="showFileActions">
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
                  @click="showDelete(props.id)"
                />
              </template>
            </v-card-actions>
          </v-card>
        </v-form>

        <!-- Snackbar -->
        <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
          {{ snackBar.message }}
        </v-snackbar>
        <AttributesDialog
          v-if="showClassControlDialog"
          :attributes-data="lastLoadedAttributes"
          :attributes-loading="attributesLoading"
          :attributes-schema="attributesSchema"
          :attributes-template-warning="attributesTemplateWarning"
          :attributes-ui-schema="attributesUiSchema"
          buffered-mode
          :item-class="currentItemClass"
          :item-id="props.id ?? null"
          :item-name="controlsStore.controls.find(control => control.id === id)?.name ?? null"
          :show="showClassControlDialog"
          @attributes:save="onAttributesSave"
          @attributes:save-and-close="onAttributesSaveAndClose"
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
          :controlId="props.id"
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
        <FolderSelectDialog
          v-if="showFolderSelectDialog"
          :show="showFolderSelectDialog"
          @close="showFolderSelectDialog = false"
          @move="moveToFolder"
        />
        <ConfirmDeleteDialog
          v-if="showDiscardChangesDialog"
          confirmColor="warning"
          confirmIcon="mdi-close-circle-outline"
          icon="mdi-pencil-off-outline"
          message="You have unsaved changes. Are you sure you want to discard them?"
          :show="showDiscardChangesDialog"
          title="Discard unsaved changes?"
          @delete:canceled="onDiscardCanceled"
          @delete:confirmed="onDiscardConfirmed"
        />
        <ConfirmDeleteDialog
          v-if="showClassRemovalConfirmDialog"
          confirmColor="warning"
          confirmIcon="mdi-check-circle-outline"
          icon="mdi-shield-off-outline"
          :message="`Removing the following class${pendingRemovedClassIds.length > 1 ? 'es' : ''} will delete their stored attributes when you save: ${pendingRemovedClassIds.map(id => availableClasses.find(c => c.id === id)?.name ?? id).join(', ')}. Continue?`"
          :show="showClassRemovalConfirmDialog"
          title="Remove class with stored attributes?"
          @delete:canceled="onClassRemovalCanceled"
          @delete:confirmed="onClassRemovalConfirmed"
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
