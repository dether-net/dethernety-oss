<script setup lang="ts">
  import { computed, ref, shallowRef, watch, nextTick, onUnmounted } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { useFlowStore } from '@/stores/flowStore'
  import { useRouter } from 'vue-router'
  import { Class, Control, Exposure, Model } from '@dethernety/dt-core'
  import { getPageDisplayName, flattenProperties, unflattenProperties } from '@/utils/dataFlowUtils'
  import type { UISchemaElement } from '@jsonforms/core'
  import SettingsGeneralTab from '@/components/DataFlow/SettingsTabs/SettingsGeneralTab.vue'
  // import SettingsAttributesTab from '@/components/DataFlow/SettingsTabs/SettingsAttributesTab.vue'
  import SettingsDataTab from '@/components/DataFlow/SettingsTabs/SettingsDataTab.vue'
  import SettingsControlsTab from '@/components/DataFlow/SettingsTabs/SettingsControlsTab.vue'
  import SettingsExposuresTab from '@/components/DataFlow/SettingsTabs/SettingsExposuresTab.vue'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'
  import { useIssueStore } from '@/stores/issueStore'

  // Interfaces
  interface FormData {
    name: string;
    class: string;
    model: string;
    modelName: string;
    description: string;
    category: string;
  }

  interface SnackBar {
    show: boolean;
    message: string;
    color: string;
  }

  // Component initialization
  const flowStore = useFlowStore()
  const selectedItem = computed(() => flowStore.selectedItem)
  const issueStore = useIssueStore()
  const router = useRouter()
  const issueClass = ref<Class | null>(null)
  const showIssueDialog = ref(false)

  const form = ref<HTMLFormElement | null>(null)
  const valid = ref(false)

  // Data
  const itemClass = ref<Class | null>(null)
  const representedModel = ref<Model | null>(null)
  const tab = ref<'general' | 'attributes' | 'data' | 'controls' | 'exposures'>('general')
  const controls = ref<Control[]>([])
  const exposures = ref<Exposure[]>([])

  // Attributes data management
  const attributesData = ref<object>({})
  const attributesSchema = shallowRef<object | null>(null)
  const attributesUiSchema = shallowRef<UISchemaElement | null>(null)
  const attributesLoading = ref(false)
  const attributesTemplateWarning = ref(false)

  // Dialogs
  const showNodeDeleteDialog = ref(false)
  const showEdgeDeleteDialog = ref(false)
  const showAttributesDialog = ref(false)
  const attributesDialogUseExpansionPanels = ref(true)

  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })

  // Form data
  const formData = ref<FormData>({ name: '', class: '', model: '', modelName: '', description: '', category: '' })

  const isFromClass = ref(true)
  const emit = defineEmits(['openModel', 'update:open-settings', 'delete:node', 'delete:edge', 'redirect:issue'])

  // Type guards
  const isNode = (item: Node | Edge | null): item is Node => {
    return item !== null && typeof item === 'object' && 'type' in item && 'position' in item
  }

  const isEdge = (item: Node | Edge | null): item is Edge => {
    return item !== null && typeof item === 'object' && 'source' in item && 'target' in item
  }

  const loadExposures = async () => {
    if (selectedItem.value) {
      exposures.value = await flowStore.getExposures({ elementId: selectedItem.value.id })
    }
  }

  const initializeAttributes = async () => {
    // Set loading state to prevent rendering issues
    attributesLoading.value = true
    attributesSchema.value = null
    attributesUiSchema.value = null
    attributesData.value = {}
    attributesTemplateWarning.value = false

    // Add defensive check - wait a tick to ensure props are stable
    await nextTick()

    if (!selectedItem.value?.id || !itemClass.value) {
      attributesLoading.value = false
      return
    }

    try {
      // Set up schema and uischema from itemClass template
      if (
        itemClass.value?.template &&
        typeof itemClass.value.template.schema === 'object' &&
        typeof itemClass.value.template.uischema === 'object'
      ) {
        attributesSchema.value = itemClass.value.template.schema
        attributesUiSchema.value = itemClass.value.template.uischema as UISchemaElement
      } else {
        console.warn('Invalid or missing schema/uischema in the class')
        attributesTemplateWarning.value = true
        attributesLoading.value = false
        return
      }

      // Fetch attributes from class relationship
      const rawProperties = await flowStore.getAttributesFromClassRelationship({
        componentId: selectedItem.value.id,
        classId: itemClass.value.id,
      })

      attributesData.value = unflattenProperties(rawProperties)
    } catch (e) {
      console.error('Failed to fetch attributes data', e)
      attributesTemplateWarning.value = true
    } finally {
      attributesLoading.value = false
    }
  }

  const saveAttributes = async (data: object) => {
    if (!selectedItem.value?.id || !itemClass.value || attributesLoading.value) return

    try {
      const flatAttributes = flattenProperties(data)

      await flowStore.setInstantiationAttributes({
        componentId: selectedItem.value.id,
        classId: itemClass.value.id,
        attributes: flatAttributes,
      })
      
      // Update local data
      attributesData.value = data
      
      // Reload exposures as they might have changed
      await loadExposures()
      
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

  const updateForm = async () => {
    formData.value = { name: '', class: '', model: '', modelName: '', description: '', category: '' }

    if (!selectedItem.value) return

    try {
      let fetchedClass = null
      let fetchedRepresentedModel = null

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Complex type inference issue
      if (isNode(selectedItem.value)) {
        if (selectedItem.value.type === 'BOUNDARY') {
          // Boundary node
          fetchedClass = await flowStore.getBoundaryClass({ boundaryId: selectedItem.value.id })
          fetchedRepresentedModel = await flowStore.getBoundaryRepresentedModel({ boundaryId: selectedItem.value.id })
        } else {
          // Component node
          fetchedClass = await flowStore.getComponentClass({ componentId: selectedItem.value.id })
          fetchedRepresentedModel = await flowStore.getComponentRepresentedModel({ componentId: selectedItem.value.id })
        }
      } else if (isEdge(selectedItem.value)) {
        // Data flow edge
        fetchedClass = await flowStore.getDataFlowClass({ dataFlowId: selectedItem.value.id })
      } else {
        console.warn('Invalid item type')
        return
      }
      itemClass.value = fetchedClass || null
      representedModel.value = fetchedRepresentedModel || null

      if (itemClass.value) {
        isFromClass.value = true
      } else if (isEdge(selectedItem.value)) {
        isFromClass.value = true
      } else if (representedModel.value) {
        isFromClass.value = false
      }

      formData.value.class = itemClass.value?.name || ''
      formData.value.model = representedModel.value?.id || ''
      formData.value.modelName = representedModel.value?.name || ''
      formData.value.category = itemClass.value?.category || ''
      loadExposures()
      // Initialize attributes after loading the class
      initializeAttributes()
    } catch (e) {
      console.warn('Failed to fetch item data or class', e)
    }

    if (isNode(selectedItem.value)) {
      formData.value.name = selectedItem.value.data.label || ''
      formData.value.description = selectedItem.value.data.description || ''
    } else if (isEdge(selectedItem.value)) {
      formData.value.name = typeof selectedItem.value.label === 'string' ? selectedItem.value.label : ''
      formData.value.description = selectedItem.value.data?.description || ''
    }

    // Initialize controls for the selected item
    initializeControls()
  }

  const updateSelectedDataItemIds = (value: string[]) => {
    console.log('updateSelectedDataItemIds', value)
    if (selectedItem.value?.data) {
      selectedItem.value.data.dataItems = value
      onSubmit()
    }
  }

  const initializeControls = () => {
    try {
      if (selectedItem.value?.data?.controls && Array.isArray(selectedItem.value.data.controls)) {
        controls.value = flowStore.controls.filter(control =>
          selectedItem.value!.data.controls.includes(control.id)
        )
      } else {
        controls.value = []
      }
    } catch (error) {
      console.warn('Error initializing controls:', error)
      controls.value = []
    }
  }

  const updateSelectedControlIds = (value: string[]) => {
    try {
      if (selectedItem.value?.data) {
        selectedItem.value.data.controls = value
        onSubmit()
      }
    } catch (error) {
      console.warn('Error updating selected control IDs:', error)
    }
  }

  const updateSelectedControls = (value: Control[]) => {
    try {
      const newControls = value.filter(control => !controls.value.some(c => c.id === control.id))
      controls.value.push(...newControls)
      const newSelectedControlIds = controls.value.map(control => control.id)
      if (selectedItem.value?.data) {
        selectedItem.value.data.controls = newSelectedControlIds
        onSubmit()
      }
    } catch (error) {
      console.warn('Error updating selected controls:', error)
    }
  }

  const deleteNode = () => {
    if (selectedItem.value && selectedItem.value !== flowStore.defaultBoundary) {
      if (isNode(selectedItem.value)) {
        showNodeDeleteDialog.value = true
      } else if (isEdge(selectedItem.value)) {
        showEdgeDeleteDialog.value = true
      }
    }
  }

  const saveItem = async () => {
    if (!selectedItem.value) return
    let res = false

    if (isNode(selectedItem.value)) {
      res = await flowStore.updateNode({
        nodeId: selectedItem.value.id,
        updates: {
          data: {
            label: formData.value.name,
            description: formData.value.description,
          },
        },
      })
    } else if (isEdge(selectedItem.value)) {
      res = await flowStore.updateDataFlow({
        edgeId: selectedItem.value.id,
        updates: {
          label: formData.value.name,
          data: {
            description: formData.value.description,
          },
        },
      })
    }

    if (res) {
      snackBar.value = { show: true, message: 'Item updated successfully', color: 'success' }
    } else {
      snackBar.value = { show: true, message: 'Failed to update item', color: 'error' }
    }
    updateForm()
  }

  // Event handlers
  const onSubmit = async () => {
    if (!form.value) return
    const { valid: isValid } = await form.value.validate()

    if (isValid) {
      await saveItem()
    }
  }

  const onClassOrModelChangeConfirmed = async (confirmed: boolean) => {
    if (!confirmed) {
      updateForm()
      return
    }

    let res = false

    if (formData.value.class &&
      selectedItem.value &&
      isFromClass.value &&
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Complex type inference issue
      (isNode(selectedItem.value) || isEdge(selectedItem.value))
    ) {
      // Class change
      if (isNode(selectedItem.value)) {
        res = await flowStore.updateNodeClass({
          nodeId: selectedItem.value.id,
          classId: formData.value.class,
        })
      } else if (isEdge(selectedItem.value)) {
        res = await flowStore.updateDataFlowClass({
          dataFlowId: selectedItem.value.id,
          classId: formData.value.class,
        })
      }
      if (res) {
        snackBar.value = { show: true, message: 'Class updated successfully', color: 'success' }
      } else {
        snackBar.value = { show: true, message: 'Failed to update class', color: 'error' }
      }
      updateForm()
    } else if (
      formData.value.model &&
      selectedItem.value &&
      isNode(selectedItem.value)
    ) {
      // Model change
      if (isNode(selectedItem.value)) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - Complex type inference issue
        res = await flowStore.updateRepresentedModel({
          nodeId: selectedItem.value.id,
          modelId: formData.value.model,
        })
      }
      if (res) {
        snackBar.value = { show: true, message: 'Represented Model updated successfully', color: 'success' }
      } else {
        snackBar.value = { show: true, message: 'Failed to update represented model', color: 'error' }
      }
      updateForm()
    } else {
      console.warn('Invalid class or model')
    }
  }

  const onNodeDelete = () => {
    if (!selectedItem.value) return
    emit('delete:node')
  }

  const onEdgeDelete = () => {
    if (!selectedItem.value) return
    emit('delete:edge')
  }

  const onOpenModel = (modelId: string) => {
    emit('openModel', modelId)
  }

  const onAddIssue = (cls: Class) => {
    console.log('onAddIssue', cls)
    issueClass.value = cls
    showIssueDialog.value = true
  }

  const onCopyToIssue = () => {
    // Get current route information dynamically
    const currentRoute = router.currentRoute.value
    const returnTo = {
      name: getPageDisplayName(currentRoute.path),
      path: currentRoute.path,
      query: { ...currentRoute.query },
    }

    issueStore.setIssueDataClipboard(
      {
        name: formData.value.name,
        description: formData.value.description,
        elementIds: [selectedItem.value?.id || '', representedModel.value?.id || '', flowStore.selectedItem?.id || '', flowStore.modelId || ''],
        returnTo,
      }
    )
    emit('redirect:issue')
  }

  const onIssueDialogClosed = () => {
    showIssueDialog.value = false
    issueClass.value = null
  }

  const onIssueAdded = () => {
    showIssueDialog.value = false
    issueClass.value = null
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

  watch(selectedItem, async (newValue, oldValue) => {
    if (newValue !== oldValue) {
      updateForm()
    }
  })
  
  watch(() => itemClass.value?.id, (newValue, oldValue) => {
    if (newValue !== oldValue && newValue) {
      debouncedInitializeAttributes()
    }
  })

  // Watch for AttributesDialog opening to initialize attributes
  watch(() => showAttributesDialog.value, (newValue) => {
    if (newValue && selectedItem.value && itemClass.value) {
      debouncedInitializeAttributes()
    }
  })
  
  watch(() => flowStore.dataItems, async (newValue, oldValue) => {
    if (newValue !== oldValue) {
      updateForm()
    }
  })
  watch(() => flowStore.modules, async (newValue, oldValue) => {
    if (newValue !== oldValue) {
      updateForm()
    }
  })
  
  // Cleanup timer on unmount
  onUnmounted(() => {
    if (attributesInitTimer) {
      clearTimeout(attributesInitTimer)
    }
  })
  
  updateForm()
</script>

<template>
  <!-- eslint-disable vue/no-lone-template -->
  <!-- eslint-disable vue/attribute-hyphenation -->
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <v-card
    flat
    @keydown.esc="emit('update:open-settings', false)"
  >
    <v-form ref="form" v-model="valid" @submit.prevent="onSubmit">
      <v-row no-gutters>
        <!-- Vertical Tabs -->
        <v-col cols="2">
          <v-tabs v-model="tab" background-color="primary" direction="vertical">
            <v-tab prepend-icon="mdi-cog-outline" text="General" value="general" />
            <v-tab prepend-icon="mdi-tune-vertical" text="Attributes" value="attributes" />
            <v-tab prepend-icon="mdi-database-outline" text="Data" value="data" />
            <v-tab prepend-icon="mdi-shield-sword-outline" text="Controls" value="controls" />
            <v-tab prepend-icon="mdi-bug-outline" text="Exposures" value="exposures" />
          </v-tabs>
        </v-col>

        <!-- Tabs Content -->
        <v-col cols="9">
          <v-tabs-window v-model="tab" class="settings-window elevation-8 mb-4">
            <v-tabs-window-item value="general">
              <SettingsGeneralTab
                :formData="formData"
                :isFromClass="isFromClass"
                :itemClass="itemClass"
                :representedModel="representedModel"
                @classOrModelChangeConfirmed="onClassOrModelChangeConfirmed"
                @openModel="onOpenModel"
                @saveItem="onSubmit"
                @update:formData="formData = $event"
                @update:isFromClass="isFromClass = $event"
                @updateForm="updateForm"
              />
            </v-tabs-window-item>

            <v-tabs-window-item value="attributes">
              <v-sheet class="flex-grow-1 pa-4 attributes-form">
                <AttributesForm
                  :item-class="itemClass"
                  :item-id="selectedItem?.id ?? null"
                  :attributes-data="attributesData"
                  :schema="attributesSchema"
                  :uischema="attributesUiSchema"
                  :is-loading="attributesLoading"
                  :template-warning="attributesTemplateWarning"
                  :use-expansion-panels="attributesDialogUseExpansionPanels"
                  @attributes:changed="onAttributesChanged"
                  @form:updated="() => {}"
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

            <v-tabs-window-item value="data">
              <SettingsDataTab
                :selectedDataItemIds="selectedItem?.data?.dataItems || []"
                :selectedItem="selectedItem"
                @update:selectedDataItemIds="updateSelectedDataItemIds"
                @redirect:issue="emit('redirect:issue')"
              />
            </v-tabs-window-item>

            <v-tabs-window-item value="controls">
              <SettingsControlsTab
                :controls="controls"
                :selectedControlIds="selectedItem?.data?.controls || []"
                :selectedItem="selectedItem"
                @update:addControls="updateSelectedControls"
                @update:selectedControlIds="updateSelectedControlIds"
              />
            </v-tabs-window-item>

            <v-tabs-window-item value="exposures">
              <SettingsExposuresTab
                :exposures="exposures"
                :selectedItem="selectedItem"
                @redirect:issue="emit('redirect:issue')"
                @updateForm="updateForm"
              />
            </v-tabs-window-item>
          </v-tabs-window>

        </v-col>
        <v-col class="d-flex flex-column justify-start mt-2" cols="1" no-gutters>
          <v-btn
            class="mx-8 ma-3"
            color="secondary"
            icon="mdi-content-save-outline"
            size="x-large"
            type="submit"
            variant="outlined"
          />
          <v-btn
            class="mx-8 ma-3"
            :color="flowStore.selectedItem === flowStore.defaultBoundary ? 'grey' : 'error'"
            icon="mdi-trash-can-outline"
            :readonly="flowStore.selectedItem === flowStore.defaultBoundary"
            size="x-large"
            variant="outlined"
            @click="deleteNode"
          />
          <v-speed-dial
            id="add-issue"
            key="add-issue"
            location="bottom end"
            transition="scroll-y-reverse-transition"
          >
            <template #activator="{ props: activatorProps }">
              <v-fab
                v-bind="activatorProps"
                class="mx-8 ma-3"
                color="quaternary"
                elevation="12"
                icon="mdi-alert-plus-outline"
                size="x-large"
                variant="outlined"
              />
            </template>
            <v-sheet
              key="add-to-issue-sheet"
              class="d-flex flex-column align-center justify-center pa-2 elevation-12"
              color="foreground"
            >
              <v-btn
                key="add-to-issue"
                class="issue-class-btn w-100"
                color="secondary"
                elevation="12"
                size="large"
                variant="plain"
                @click="onCopyToIssue"
              >
                <span class="text-color">
                  Add to Issue
                </span>
              </v-btn>
              <v-divider class="my-3" />
              <v-btn
                v-for="cls in issueStore.issueClasses"
                :key="cls.id"
                class="issue-class-btn mb-1 w-100"
                color="secondary"
                elevation="12"
                size="large"
                variant="plain"
                @click="onAddIssue(cls)"
              >
                <span class="text-color">
                  {{ cls.name }}
                </span>
              </v-btn>
            </v-sheet>
          </v-speed-dial>
        </v-col>
      </v-row>
    </v-form>
  </v-card>

  <ConfirmDeleteDialog
    v-if="showEdgeDeleteDialog"
    :message="`Are you sure you want to delete this Edge: ${selectedItem?.label ?? ''}?`"
    :show="showEdgeDeleteDialog"
    @delete:canceled="showEdgeDeleteDialog = false"
    @delete:confirmed="onEdgeDelete"
  />
  <ConfirmDeleteDialog
    v-if="showNodeDeleteDialog"
    :message="`Are you sure you want to delete this Node: ${selectedItem?.type ?? ''}?`"
    :show="showNodeDeleteDialog"
    @delete:canceled="showNodeDeleteDialog = false"
    @delete:confirmed="onNodeDelete"
  />
  <IssueDialog
    v-if="showIssueDialog"
    :element-ids="[selectedItem?.id || '', representedModel?.id || '', flowStore.selectedItem?.id || '', flowStore.modelId || '']"
    :issue-class="issueClass || undefined"
    :show="showIssueDialog"
    @cancel:issue="onIssueDialogClosed"
    @issue:added="onIssueAdded"
  />
  <AttributesDialog
    v-if="showAttributesDialog"
    :show="showAttributesDialog"
    :item-class="itemClass"
    :item-id="selectedItem?.id ?? null"
    :item-name="selectedItem?.data?.label ?? null"
    :attributes-data="attributesData"
    :attributes-schema="attributesSchema"
    :attributes-ui-schema="attributesUiSchema"
    :attributes-loading="attributesLoading"
    :attributes-template-warning="attributesTemplateWarning"
    @update:exposures="loadExposures"
    @close="showAttributesDialog = false"
    @redirect:issue="emit('redirect:issue')"
    @attributes:changed="onAttributesChanged"
  />
  <v-snackbar
    v-model="snackBar.show"
    :color="snackBar.color"
    timeout="5000"
    top
  >
    {{ snackBar.message }}
  </v-snackbar>
</template>

<style>
@import '@jsonforms/vue-vuetify/lib/jsonforms-vue-vuetify.css';
</style>

<style scoped>
  .controls-table {
    max-height: 300px;
    overflow-y: auto;
  }

  .settings-window {
    height: 300px;
    overflow-y: hidden;
  }

  .attributes-form {
    height: 290px !important;
    overflow-y: auto;
  }

  .attributes-form :deep(.json-forms) {
    max-height: 250px !important;
    overflow-y: auto;
  }

  .attributes-form :deep(.v-col) {
    max-height: 240px !important;
    overflow-y: auto;
  } 

  .attributes-form :deep(.v-container) {
    max-height: 250px !important;
    overflow-y: hidden;
  }

</style>
