<script setup lang="ts">
  import { computed, ref, shallowRef, watch, nextTick, onMounted, onUnmounted } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { useFlowStore } from '@/stores/flowStore'
  import { useRouter } from 'vue-router'
  import { Class, Control, Exposure, Model } from '@dethernety/dt-core'
  import type { ChangeElementBindingResult, Zone, Plane, Conduit } from '@dethernety/dt-core'
  import { getPageDisplayName, flattenProperties, unflattenProperties } from '@/utils/dataFlowUtils'
  import { emitBindingChangeFeedback } from '@/utils/bindingChangeFeedback'
  import type { UISchemaElement } from '@jsonforms/core'
  import SettingsGeneralTab from '@/components/DataFlow/SettingsTabs/SettingsGeneralTab.vue'
  import SettingsZoningTab from '@/components/DataFlow/SettingsTabs/SettingsZoningTab.vue'
  // import SettingsAttributesTab from '@/components/DataFlow/SettingsTabs/SettingsAttributesTab.vue'
  import SettingsDataTab from '@/components/DataFlow/SettingsTabs/SettingsDataTab.vue'
  import SettingsControlsTab from '@/components/DataFlow/SettingsTabs/SettingsControlsTab.vue'
  import SettingsExposuresTab from '@/components/DataFlow/SettingsTabs/SettingsExposuresTab.vue'
  import StaleBadge from '@/components/Disposition/StaleBadge.vue'
  import PendingBadge from '@/components/Disposition/PendingBadge.vue'
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
  const tab = ref<'general' | 'zoning' | 'attributes' | 'data' | 'controls' | 'exposures'>('general')
  const controls = ref<Control[]>([])
  const exposures = ref<Exposure[]>([])
  // Stale-disposition count emitted by SettingsExposuresTab; drives the
  // Exposures tab badge (mirrors the Countermeasures sub-table badge).
  const exposureStaleCount = ref(0)
  // Pending (unreviewed) count emitted by SettingsExposuresTab; drives the
  // "awaiting review" badge on the Exposures tab.
  const exposurePendingCount = ref(0)

  // Attributes data management — lastLoadedAttributes is the backend snapshot; pendingAttributes (declared below) is the UI buffer.
  const lastLoadedAttributes = ref<object>({})
  const attributesSchema = shallowRef<object | null>(null)
  const attributesUiSchema = shallowRef<UISchemaElement | null>(null)
  const attributesLoading = ref(false)
  const attributesTemplateWarning = ref(false)

  // Dialogs
  const showNodeDeleteDialog = ref(false)
  const showEdgeDeleteDialog = ref(false)
  const showAttributesDialog = ref(false)
  const attributesDialogUseExpansionPanels = ref(true)

  // Form data — pendingFormData is the UI buffer; commits apply it to the store via saveItem.
  const pendingFormData = ref<FormData>({ name: '', class: '', model: '', modelName: '', description: '', category: '' })

  // Pending attributes buffer — what AttributesForm / AttributesDialog bind to; commits flow back into lastLoadedAttributes via saveAttributes.
  const pendingAttributes = ref<object>({})

  // Dirty tab tracking — the toolbar Save / Revert buttons key off isDirty; tab labels show a marker per tab id.
  type TabId = 'general' | 'zoning' | 'attributes' | 'data' | 'controls' | 'exposures'
  const dirtyTabs = ref<Set<TabId>>(new Set())
  const isDirty = computed(() => dirtyTabs.value.size > 0)
  const markDirty = (id: TabId) => { dirtyTabs.value.add(id); dirtyTabs.value = new Set(dirtyTabs.value) }
  const clearDirty = (id: TabId) => { dirtyTabs.value.delete(id); dirtyTabs.value = new Set(dirtyTabs.value) }
  const clearAllDirty = () => { dirtyTabs.value = new Set() }

  const isFromClass = ref(true)
  // Crown-jewel flag for the selected component (boundaries never set it). Seeded
  // from the node on selection; persisted immediately on toggle via saveItem.
  const crownJewel = ref(false)
  const props = defineProps<{ freshlyCreatedId?: string | null }>()
  const emit = defineEmits(['openModel', 'update:open-settings', 'delete:node', 'delete:edge', 'redirect:issue', 'clear-freshly-created', 'update:snackBar'])

  // Snackbar messages flow up to the canvas-level v-snackbar via update:snackBar — no local snackbar in this component.
  const showSnackbar = (message: string, color: 'success' | 'error' | 'warning' | 'info') => {
    emit('update:snackBar', { show: true, message, color })
  }

  // Class / model changes go through their own confirm dialog (proceedWithClassChange) and
  // shouldn't be treated as buffered General edits. Only name / description changes mark the
  // tab dirty; everything else is a tracking field for the dialog flow.
  const onPendingFormDataUpdate = (v: FormData) => {
    const prev = pendingFormData.value
    pendingFormData.value = v
    if (v.name !== prev.name || v.description !== prev.description) {
      markDirty('general')
    }
  }

  // True while the current selection is the most recently created element and hasn't been saved yet.
  const isFreshlyCreated = computed(() =>
    selectedItem.value?.id != null && selectedItem.value.id === props.freshlyCreatedId,
  )

  // A newly dropped element — or a newly drawn data flow — opens on General.
  //
  // The panel otherwise keeps whatever tab the *previous* selection was resting on, so
  // dropping a component while parked on Exposures or Controls lands the user on a tab
  // that has nothing to show for a brand-new element, with the name and description they
  // came to fill in hidden a click away.
  //
  // Keyed to the freshly-created id rather than folded into updateForm(): both creation
  // paths set that id once their store create resolves, which is not ordered against the
  // selection change, so watching it holds whichever lands first. Firing on the id (not on
  // isFreshlyCreated) also means re-selecting the still-unsaved element later does not yank
  // the tab back to General under the user — and isFreshlyCreated is not usable here anyway,
  // because for a data flow the published id is the client's while the selected edge carries
  // the server's (dt-dataflow.ts reassigns newEdge.id from the mutation result).
  //
  // The !isDirty gate is what keeps this on the element actually on screen. Creating a
  // component selects an optimistic temp node synchronously, which trips the dirty
  // navigation guard: the guard snaps the selection back to the element being edited and
  // raises the discard prompt, and the store's later re-point is skipped because the
  // selection no longer holds the temp id. The create still resolves and still publishes an
  // id, so without this gate the tab would jump to General on the element the user never
  // left — behind the open modal, where the jump isn't even visible. The guard only fires
  // when dirty, so !isDirty means the selection did land on the new element.
  watch(() => props.freshlyCreatedId, id => {
    if (id && !isDirty.value) tab.value = 'general'
  })

  // Type guards
  const isNode = (item: Node | Edge | null): item is Node => {
    return item !== null && typeof item === 'object' && 'type' in item && 'position' in item
  }

  const isEdge = (item: Node | Edge | null): item is Edge => {
    return item !== null && typeof item === 'object' && 'source' in item && 'target' in item
  }

  // ── Zoning tab (boundary-only) ──
  interface ZoningBuffer {
    zone: Zone | null;
    domains: string[];
    planes: Plane[];
    conduits: Conduit[];
  }
  const isBoundary = computed(() => isNode(selectedItem.value) && selectedItem.value.type === 'BOUNDARY')
  // The Zoning tab is gated off the default/root boundary: its zoning isn't in the model-dump read and
  // doesn't re-pin to server truth, so an edit there would silently not persist. The default boundary is
  // the implicit Internal fallback anyway (real boundaries inherit from it), so it has no editable zone.
  const showZoningTab = computed(
    () => isBoundary.value && isNode(selectedItem.value) && selectedItem.value.id !== flowStore.defaultBoundaryId,
  )
  // Pending zoning buffer — the Zoning tab binds to this; saveZoning commits it via the store path.
  const pendingZoning = ref<ZoningBuffer>({ zone: null, domains: [], planes: [], conduits: [] })

  // Re-seed the buffer from the selected boundary's node data (server truth). A light reset — does NOT
  // re-fetch class/attributes (unlike the full updateForm), so it's safe to call after a zoning save.
  const seedZoningFromSelected = () => {
    const d = isNode(selectedItem.value) ? selectedItem.value.data : null
    pendingZoning.value = {
      zone: (d?.zone as Zone | null) ?? null,
      domains: [...(d?.domains ?? [])],
      planes: [...(d?.planes ?? [])],
      conduits: [...(d?.conduits ?? [])],
    }
  }

  const onPendingZoningUpdate = (v: ZoningBuffer) => {
    pendingZoning.value = v
    markDirty('zoning')
  }

  // Save-disable while a boundary save is in flight: dt-core's `update-boundary-<id>` deduplicationKey
  // shares the in-flight promise, so a second overlapping Save would silently drop its edit.
  const isBoundarySaving = computed(() =>
    isBoundary.value &&
    !!selectedItem.value &&
    flowStore.isOperationLoading('updateBoundary-' + selectedItem.value.id),
  )

  const saveZoning = async (): Promise<boolean> => {
    if (!selectedItem.value || !isNode(selectedItem.value)) return false

    // Strip conduits whose peer boundary no longer exists (e.g. a freshly-added peer deleted before Save).
    // A zero-match nested `connect` would otherwise error the WHOLE mutation — rolling back the user's
    // zone/domains/planes edits too. Mutate the buffer (not the node) so Revert restores.
    const liveIds = new Set(
      [...flowStore.allBoundaries().map(b => b.id), flowStore.defaultBoundaryId].filter(Boolean) as string[],
    )
    const liveConduits = pendingZoning.value.conduits.filter(c => liveIds.has(c.peerId))
    if (liveConduits.length !== pendingZoning.value.conduits.length) {
      const dropped = pendingZoning.value.conduits.length - liveConduits.length
      pendingZoning.value = { ...pendingZoning.value, conduits: liveConduits }
      showSnackbar(
        `${dropped} channel${dropped === 1 ? '' : 's'} to a removed boundary ${dropped === 1 ? 'was' : 'were'} dropped`,
        'warning',
      )
    }

    // Captured before the await: if the node is still mid-creation the edit is
    // safely deferred (applied once the create resolves), not persisted now — so
    // don't claim outright success for it.
    const deferred = flowStore.isPendingNode(selectedItem.value.id)
    const res = await flowStore.updateNode({
      nodeId: selectedItem.value.id,
      updates: {
        data: {
          zone: pendingZoning.value.zone,
          domains: pendingZoning.value.domains,
          planes: pendingZoning.value.planes,
          conduits: pendingZoning.value.conduits,
        },
      },
    })
    if (res) {
      clearDirty('zoning')
      if (isFreshlyCreated.value) emit('clear-freshly-created')
      showSnackbar(
        deferred ? 'Zoning will be applied once the item finishes saving' : 'Zoning saved successfully',
        deferred ? 'info' : 'success',
      )
      seedZoningFromSelected()
    } else {
      // Buffer stays dirty so the user can retry without losing their edit.
      showSnackbar('Failed to save zoning', 'error')
    }
    return res
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
    lastLoadedAttributes.value = {}
    pendingAttributes.value = {}
    clearDirty('attributes')
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

      const loaded = unflattenProperties(rawProperties)
      lastLoadedAttributes.value = loaded
      pendingAttributes.value = loaded
      clearDirty('attributes')
    } catch (e) {
      console.error('Failed to fetch attributes data', e)
      attributesTemplateWarning.value = true
    } finally {
      attributesLoading.value = false
    }
  }

  const saveAttributes = async () => {
    if (!selectedItem.value?.id || !itemClass.value || attributesLoading.value) return

    try {
      const flatAttributes = flattenProperties(pendingAttributes.value)

      // setInstantiationAttributesWithStaleCount returns the
      // number of dispositioned exposures whose `dispositionStale` flipped to
      // true inside the same write transaction. Surface the count to the user
      // when non-zero.
      const result = await flowStore.setInstantiationAttributesWithStaleCount({
        componentId: selectedItem.value.id,
        classId: itemClass.value.id,
        attributes: flatAttributes,
      })

      lastLoadedAttributes.value = pendingAttributes.value
      // Refetch exposures so row-level stale flags propagate; the count is
      // the headline, the refetch tells the table which rows to highlight.
      await loadExposures()
      clearDirty('attributes')
      if (isFreshlyCreated.value) emit('clear-freshly-created')

      const staleCount = result?.staleFlippedCount ?? 0
      if (staleCount > 0) {
        showSnackbar(
          `Attributes saved. ${staleCount} disposition${staleCount === 1 ? '' : 's'} now need${staleCount === 1 ? 's' : ''} review.`,
          'warning',
        )
      } else {
        showSnackbar('Attributes saved successfully', 'success')
      }
    } catch (e) {
      console.error('Failed to save attributes', e)
      // Buffer stays at the user's edit so they can retry; auto-save is gone, no fresh-reference dance needed.
      showSnackbar('Failed to save attributes', 'error')
    }
  }

  const onAttributesChanged = (data: object) => {
    pendingAttributes.value = data
    markDirty('attributes')
  }

  const updateForm = async () => {
    pendingFormData.value = { name: '', class: '', model: '', modelName: '', description: '', category: '' }

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

      pendingFormData.value.class = itemClass.value?.id || ''
      pendingFormData.value.model = representedModel.value?.id || ''
      pendingFormData.value.modelName = representedModel.value?.name || ''
      pendingFormData.value.category = itemClass.value?.category || ''
      loadExposures()
      // Initialize attributes after loading the class
      initializeAttributes()
    } catch (e) {
      console.warn('Failed to fetch item data or class', e)
    }

    if (isNode(selectedItem.value)) {
      pendingFormData.value.name = selectedItem.value.data.label || ''
      pendingFormData.value.description = selectedItem.value.data.description || ''
      crownJewel.value = selectedItem.value.data?.crownJewel === true
    } else if (isEdge(selectedItem.value)) {
      pendingFormData.value.name = typeof selectedItem.value.label === 'string' ? selectedItem.value.label : ''
      pendingFormData.value.description = selectedItem.value.data?.description || ''
    }

    // Initialize controls for the selected item
    initializeControls()

    // Seed the zoning buffer from the boundary's node data; for non-boundaries leave the tab inert and
    // never let the active tab rest on the (now-hidden) zoning tab.
    seedZoningFromSelected()
    if (!showZoningTab.value && tab.value === 'zoning') tab.value = 'general'
    clearDirty('zoning')

    clearDirty('general')
    // Don't auto-mark fresh drafts dirty — that artificial dirt makes the navigation guard fire
    // on every click-away even when the user hasn't typed anything. The Save button stays
    // enabled via isFreshlyCreated on its disabled binding; onSubmit also keys off it.
  }

  // Confirm-on-remove state for Controls/Data unlinking. Adds bypass the dialog.
  const showRemoveControlDialog = ref(false)
  const showRemoveDataItemDialog = ref(false)
  const pendingRemoveControlName = ref<string>('')
  const pendingRemoveDataItemName = ref<string>('')
  const pendingRemovalProposedValue = ref<string[]>([])

  const updateSelectedDataItemIds = (value: string[]) => {
    if (!selectedItem.value?.data) return
    const currentIds: string[] = selectedItem.value.data.dataItems || []
    const removed = currentIds.filter(id => !value.includes(id))
    if (removed.length === 0) {
      // Pure add — auto-save. saveItem() (not onSubmit()) because onSubmit gates on
      // dirtyTabs.has('general'), and toggling a checkbox doesn't mark general dirty.
      // saveItem hits updateNode → deepMerge → updateComponentNode, which reads the
      // just-mutated node.data.dataItems and sends the connect/disconnect to the backend.
      selectedItem.value.data.dataItems = value
      saveItem()
      return
    }
    const removedId = removed[0]
    const dataItem = flowStore.dataItems.find(d => d.id === removedId)
    pendingRemoveDataItemName.value = dataItem?.name ?? removedId
    pendingRemovalProposedValue.value = value
    showRemoveDataItemDialog.value = true
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
      if (!selectedItem.value?.data) return
      const currentIds: string[] = selectedItem.value.data.controls || []
      const removed = currentIds.filter(id => !value.includes(id))
      if (removed.length === 0) {
        // Pure add — auto-save via saveItem (not onSubmit, which gates on general-tab dirty).
        selectedItem.value.data.controls = value
        saveItem()
        return
      }
      const removedId = removed[0]
      const control = flowStore.controls.find(c => c.id === removedId)
      pendingRemoveControlName.value = control?.name ?? removedId
      pendingRemovalProposedValue.value = value
      showRemoveControlDialog.value = true
    } catch (error) {
      console.warn('Error updating selected control IDs:', error)
    }
  }

  const onRemoveControlConfirmed = () => {
    if (selectedItem.value?.data) {
      selectedItem.value.data.controls = pendingRemovalProposedValue.value
      saveItem()
    }
    showRemoveControlDialog.value = false
    pendingRemoveControlName.value = ''
    pendingRemovalProposedValue.value = []
  }

  const onRemoveControlCanceled = () => {
    showRemoveControlDialog.value = false
    pendingRemoveControlName.value = ''
    pendingRemovalProposedValue.value = []
    // Force the data-table to re-bind from props so the unchecked row's checkbox restores.
    if (selectedItem.value?.data) {
      selectedItem.value.data.controls = [...(selectedItem.value.data.controls || [])]
    }
  }

  const onRemoveDataItemConfirmed = () => {
    if (selectedItem.value?.data) {
      selectedItem.value.data.dataItems = pendingRemovalProposedValue.value
      saveItem()
    }
    showRemoveDataItemDialog.value = false
    pendingRemoveDataItemName.value = ''
    pendingRemovalProposedValue.value = []
  }

  const onRemoveDataItemCanceled = () => {
    showRemoveDataItemDialog.value = false
    pendingRemoveDataItemName.value = ''
    pendingRemovalProposedValue.value = []
    if (selectedItem.value?.data) {
      selectedItem.value.data.dataItems = [...(selectedItem.value.data.dataItems || [])]
    }
  }

  const updateSelectedControls = (value: Control[]) => {
    try {
      const newControls = value.filter(control => !controls.value.some(c => c.id === control.id))
      controls.value.push(...newControls)
      const newSelectedControlIds = controls.value.map(control => control.id)
      if (selectedItem.value?.data) {
        selectedItem.value.data.controls = newSelectedControlIds
        saveItem()
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

    // Captured before the await: a node still mid-creation has its edit safely
    // deferred (applied once the create resolves), not persisted now — so the
    // success toast below must not claim outright success for it.
    const deferred = isNode(selectedItem.value) && flowStore.isPendingNode(selectedItem.value.id)

    if (isNode(selectedItem.value)) {
      res = await flowStore.updateNode({
        nodeId: selectedItem.value.id,
        updates: {
          data: {
            label: pendingFormData.value.name,
            description: pendingFormData.value.description,
            crownJewel: crownJewel.value,
          },
        },
      })
    } else if (isEdge(selectedItem.value)) {
      res = await flowStore.updateDataFlow({
        edgeId: selectedItem.value.id,
        updates: {
          label: pendingFormData.value.name,
          data: {
            description: pendingFormData.value.description,
          },
        },
      })
    }

    if (res) {
      clearDirty('general')
      if (isFreshlyCreated.value) emit('clear-freshly-created')
      showSnackbar(
        deferred ? 'Changes will be applied once the item finishes saving' : 'Item updated successfully',
        deferred ? 'info' : 'success',
      )
      updateForm()
    } else {
      // Buffer stays dirty so the user can retry without losing their edit.
      showSnackbar('Failed to update item', 'error')
    }
  }

  // Crown jewel is a direct action: flip the flag and persist immediately (it
  // rides saveItem's data payload through to Component.crownJewel).
  const onCrownJewelToggle = async (value: boolean) => {
    crownJewel.value = value
    await saveItem()
  }

  // Event handlers
  const onSubmit = async () => {
    if (!form.value) return
    const { valid: isValid } = await form.value.validate()
    if (!isValid) return

    // Commit cheaper General first, then Attributes — independent calls; partial success leaves the cheaper edit in place.
    // Fresh drafts always commit General even with no user edits — that's the path that emits
    // clear-freshly-created and transitions the node out of draft state.
    if (dirtyTabs.value.has('general') || isFreshlyCreated.value) {
      await saveItem()
    }
    if (dirtyTabs.value.has('attributes')) {
      await saveAttributes()
    }
    if (dirtyTabs.value.has('zoning')) {
      await saveZoning()
    }
  }

  const resetPendingFormDataFromSelectedItem = () => {
    if (!selectedItem.value) return
    if (isNode(selectedItem.value)) {
      pendingFormData.value.name = selectedItem.value.data.label || ''
      pendingFormData.value.description = selectedItem.value.data.description || ''
      crownJewel.value = selectedItem.value.data?.crownJewel === true
    } else if (isEdge(selectedItem.value)) {
      pendingFormData.value.name = typeof selectedItem.value.label === 'string' ? selectedItem.value.label : ''
      pendingFormData.value.description = selectedItem.value.data?.description || ''
    }
  }

  const resetPendingAttributesFromLoaded = () => {
    // Authoritative reload from the backend — bypasses the in-memory snapshot so we don't have
    // to reason about JsonForms reference sharing with lastLoadedAttributes.
    initializeAttributes()
  }

  const revertPending = () => {
    resetPendingFormDataFromSelectedItem()
    resetPendingAttributesFromLoaded()
    seedZoningFromSelected()
    clearAllDirty()
  }

  const proceedWithClassChange = async () => {
    let res: ChangeElementBindingResult | null = null

    if (pendingFormData.value.class &&
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
          classId: pendingFormData.value.class,
        })
      } else if (isEdge(selectedItem.value)) {
        res = await flowStore.updateDataFlowClass({
          dataFlowId: selectedItem.value.id,
          classId: pendingFormData.value.class,
        })
      }
      if (res?.success) {
        if (isFreshlyCreated.value) emit('clear-freshly-created')
        const toast = emitBindingChangeFeedback(res, { kind: 'exposures' })
        if (toast) showSnackbar(toast.message, toast.color)
      } else {
        const toast = emitBindingChangeFeedback(res, { kind: 'exposures' })
        showSnackbar(toast?.message ?? 'Failed to update class', 'error')
      }
      updateForm()
    } else if (
      !pendingFormData.value.class &&
      itemClass.value &&
      isFromClass.value &&
      selectedItem.value &&
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Complex type inference issue
      (isNode(selectedItem.value) || isEdge(selectedItem.value))
    ) {
      // Class removal (unassign). Only the Remove-class flow clears formData.class
      // while a class is still bound — the picker flow always sets it. The store
      // sends a NONE rebind; the backend sweeps auto-generated exposures.
      if (isNode(selectedItem.value)) {
        res = await flowStore.updateNodeClass({
          nodeId: selectedItem.value.id,
          classId: null,
        })
      } else if (isEdge(selectedItem.value)) {
        res = await flowStore.updateDataFlowClass({
          dataFlowId: selectedItem.value.id,
          classId: null,
        })
      }
      if (res?.success) {
        if (isFreshlyCreated.value) emit('clear-freshly-created')
        const toast = emitBindingChangeFeedback(res, { kind: 'exposures', transition: 'class-removed' })
        if (toast) showSnackbar(toast.message, toast.color)
      } else {
        const toast = emitBindingChangeFeedback(res, { kind: 'exposures' })
        showSnackbar(toast?.message ?? 'Failed to remove class', 'error')
      }
      updateForm()
    } else if (
      pendingFormData.value.model &&
      selectedItem.value &&
      isNode(selectedItem.value)
    ) {
      // Model change
      if (isNode(selectedItem.value)) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - Complex type inference issue
        res = await flowStore.updateRepresentedModel({
          nodeId: selectedItem.value.id,
          modelId: pendingFormData.value.model,
        })
      }
      if (res?.success) {
        if (isFreshlyCreated.value) emit('clear-freshly-created')
        const toast = emitBindingChangeFeedback(res, {
          kind: 'exposures',
          transition: 'class-to-model',
          modelName: pendingFormData.value.modelName,
        })
        if (toast) showSnackbar(toast.message, toast.color)
      } else {
        const toast = emitBindingChangeFeedback(res, { kind: 'exposures' })
        showSnackbar(toast?.message ?? 'Failed to update represented model', 'error')
      }
      updateForm()
    } else {
      console.warn('Invalid class or model')
    }
  }

  const onClassChangeCommit = async () => {
    // If anything else is dirty, commit it first; on commit failure, bail out and surface the failure.
    if (isDirty.value) {
      await onSubmit()
      if (isDirty.value) {
        showSnackbar('Could not commit pending edits; class change cancelled.', 'error')
        return
      }
    }
    await proceedWithClassChange()
  }

  const onClassChangeDiscard = async () => {
    resetPendingFormDataFromSelectedItem()
    resetPendingAttributesFromLoaded()
    clearAllDirty()
    await proceedWithClassChange()
  }

  const onClassChangeCancel = () => {
    // User backed out — revert any class/model picker change in the buffer.
    updateForm()
  }

  const onNodeDelete = () => {
    // Close before emitting: the parent owns the actual delete, so nothing else
    // resets this flag and a stuck 'true' would stop the dialog reopening.
    showNodeDeleteDialog.value = false
    if (!selectedItem.value) return
    emit('delete:node')
  }

  const onEdgeDelete = () => {
    showEdgeDeleteDialog.value = false
    if (!selectedItem.value) return
    emit('delete:edge')
  }

  const onOpenModel = (modelId: string) => {
    emit('openModel', modelId)
  }

  const onAddIssue = (cls: Class) => {
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
        name: pendingFormData.value.name,
        description: pendingFormData.value.description,
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

  // Navigation guard: when dirty, intercept selection changes; snap back, prompt, defer to user.
  const showDiscardChangesDialog = ref(false)
  const pendingSelectionTarget = ref<Node | Edge | null>(null)
  // True while we're forcing selection back to the prior element so the watcher's re-fire is a no-op.
  let snappingBack = false

  watch(selectedItem, async (newValue, oldValue) => {
    if (newValue === oldValue) return
    if (snappingBack) {
      snappingBack = false
      return
    }
    // The store re-refs selectedItem to a fresh object after our own save (same id, new ref).
    // That's not a navigation, so don't gate it — and don't re-run updateForm either, since
    // saveItem already does so once clearDirty has run.
    if (newValue && oldValue && newValue.id === oldValue.id) return
    if (isDirty.value && oldValue !== null) {
      pendingSelectionTarget.value = newValue
      showDiscardChangesDialog.value = true
      snappingBack = true
      flowStore.setSelectedItem({ item: oldValue })
      return
    }
    updateForm()
  })

  const onDiscardConfirmed = () => {
    showDiscardChangesDialog.value = false
    const target = pendingSelectionTarget.value
    pendingSelectionTarget.value = null
    clearAllDirty()
    flowStore.setSelectedItem({ item: target })
    // The watcher fires on the new selection; isDirty is now false so it falls through to updateForm().
  }

  const onDiscardCanceled = () => {
    showDiscardChangesDialog.value = false
    pendingSelectionTarget.value = null
    // Selection is already snapped back to the prior element; nothing else to do.
  }

  const discardFreshlyCreated = async () => {
    if (!selectedItem.value || !isFreshlyCreated.value) return
    const item = selectedItem.value
    // Clear dirty BEFORE the delete so the store's selectedItem change mid-await doesn't trip
    // the navigation guard — the user has already given their intent by clicking "Discard new".
    clearAllDirty()
    if (isNode(item)) {
      if (item.type === 'BOUNDARY') {
        await flowStore.deleteBoundaryNode({ boundaryId: item.id })
      } else {
        await flowStore.deleteComponentNode({ componentId: item.id })
      }
    } else if (isEdge(item)) {
      await flowStore.deleteDataFlow({ dataFlowId: item.id })
    }
    flowStore.setSelectedItem({ item: null })
    emit('clear-freshly-created')
  }

  const onWindowKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isFreshlyCreated.value) return
    // While any Vuetify dialog / overlay is open, Escape belongs to the topmost overlay
    // (it closes the dialog). Don't also discard the fresh draft underneath.
    if (document.querySelector('.v-overlay--active')) return
    discardFreshlyCreated()
  }
  onMounted(() => window.addEventListener('keydown', onWindowKeydown))
  
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
  
  // Cleanup timer on unmount
  onUnmounted(() => {
    if (attributesInitTimer) {
      clearTimeout(attributesInitTimer)
    }
    window.removeEventListener('keydown', onWindowKeydown)
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
            <v-tab prepend-icon="mdi-cog-outline" value="general">
              General<span v-if="dirtyTabs.has('general')" class="dirty-dot" aria-label="Unsaved changes">●</span>
            </v-tab>
            <v-tab v-if="showZoningTab" prepend-icon="mdi-shield-lock-outline" value="zoning">
              Zoning<span v-if="dirtyTabs.has('zoning')" class="dirty-dot" aria-label="Unsaved changes">●</span>
            </v-tab>
            <v-tab prepend-icon="mdi-tune-vertical" value="attributes">
              Attributes<span v-if="dirtyTabs.has('attributes')" class="dirty-dot" aria-label="Unsaved changes">●</span>
            </v-tab>
            <v-tab prepend-icon="mdi-database-outline" value="data">
              Data<span v-if="dirtyTabs.has('data')" class="dirty-dot" aria-label="Unsaved changes">●</span>
            </v-tab>
            <v-tab prepend-icon="mdi-shield-sword-outline" value="controls">
              Controls<span v-if="dirtyTabs.has('controls')" class="dirty-dot" aria-label="Unsaved changes">●</span>
            </v-tab>
            <v-tab prepend-icon="mdi-bug-outline" value="exposures">
              Exposures<StaleBadge :count="exposureStaleCount" /><PendingBadge :count="exposurePendingCount" /><span v-if="dirtyTabs.has('exposures')" class="dirty-dot" aria-label="Unsaved changes">●</span>
            </v-tab>
          </v-tabs>
        </v-col>

        <!-- Tabs Content -->
        <v-col cols="9">
          <v-tabs-window v-model="tab" class="settings-window elevation-8 mb-4">
            <v-tabs-window-item value="general">
              <SettingsGeneralTab
                :formData="pendingFormData"
                :hasDirtyEdits="isDirty"
                :isFromClass="isFromClass"
                :crownJewel="crownJewel"
                :itemClass="itemClass"
                :representedModel="representedModel"
                @class-change-cancel="onClassChangeCancel"
                @class-change-commit="onClassChangeCommit"
                @class-change-discard="onClassChangeDiscard"
                @openModel="onOpenModel"
                @saveItem="onSubmit"
                @update:formData="onPendingFormDataUpdate"
                @update:isFromClass="isFromClass = $event"
                @update:crownJewel="onCrownJewelToggle"
              />
            </v-tabs-window-item>

            <v-tabs-window-item v-if="showZoningTab" value="zoning">
              <SettingsZoningTab
                :zoning="pendingZoning"
                :boundaryId="selectedItem?.id ?? ''"
                @update:zoning="onPendingZoningUpdate"
              />
            </v-tabs-window-item>

            <v-tabs-window-item value="attributes">
              <v-sheet class="flex-grow-1 pa-4 attributes-form">
                <AttributesForm
                  :item-class="itemClass"
                  :item-id="selectedItem?.id ?? null"
                  :attributes-data="pendingAttributes"
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
                @update:snackBar="emit('update:snackBar', $event)"
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
                @update:staleCount="exposureStaleCount = $event"
                @update:pendingCount="exposurePendingCount = $event"
                @updateForm="updateForm"
              />
            </v-tabs-window-item>
          </v-tabs-window>

        </v-col>
        <v-col class="d-flex flex-column justify-start mt-2" cols="1" no-gutters>
          <v-btn
            class="mx-8 ma-3"
            color="secondary"
            :disabled="(!isDirty && !isFreshlyCreated) || isBoundarySaving"
            icon="mdi-content-save-outline"
            size="x-large"
            type="submit"
            variant="outlined"
          />
          <div>
            <v-btn
              v-if="isDirty"
              class="mx-5 ma-2"
              color="warning"
              size="small"
              variant="text"
              @click="revertPending"
            >
              Revert
            </v-btn>
            <v-btn
              v-if="isFreshlyCreated"
              class="mx-8 ma-3"
              color="warning"
              icon="mdi-close-circle-outline"
              size="x-large"
              variant="outlined"
              @click="discardFreshlyCreated"
            />
            <v-btn
              v-else
              class="mx-8 ma-3"
              :color="flowStore.selectedItem === flowStore.defaultBoundary ? 'grey' : 'error'"
              icon="mdi-trash-can-outline"
              :readonly="flowStore.selectedItem === flowStore.defaultBoundary"
              size="x-large"
              variant="outlined"
              @click="deleteNode"
            />
          </div>
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
    v-if="showDiscardChangesDialog"
    confirm-color="warning"
    confirm-icon="mdi-close-circle-outline"
    icon="mdi-pencil-off-outline"
    message="Discard unsaved changes on the current element?"
    :show="showDiscardChangesDialog"
    title="Discard unsaved changes?"
    @delete:canceled="onDiscardCanceled"
    @delete:confirmed="onDiscardConfirmed"
  />
  <ConfirmDeleteDialog
    v-if="showRemoveControlDialog"
    confirm-color="warning"
    confirm-icon="mdi-link-variant-off"
    icon="mdi-shield-remove-outline"
    :message="`Remove control '${pendingRemoveControlName}' from this element?`"
    :show="showRemoveControlDialog"
    title="Remove control"
    @delete:canceled="onRemoveControlCanceled"
    @delete:confirmed="onRemoveControlConfirmed"
  />
  <ConfirmDeleteDialog
    v-if="showRemoveDataItemDialog"
    confirm-color="warning"
    confirm-icon="mdi-link-variant-off"
    icon="mdi-database-remove-outline"
    :message="`Remove data item '${pendingRemoveDataItemName}' from this element?`"
    :show="showRemoveDataItemDialog"
    title="Remove data item"
    @delete:canceled="onRemoveDataItemCanceled"
    @delete:confirmed="onRemoveDataItemConfirmed"
  />
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
    :attributes-data="pendingAttributes"
    :attributes-schema="attributesSchema"
    :attributes-ui-schema="attributesUiSchema"
    :attributes-loading="attributesLoading"
    :attributes-template-warning="attributesTemplateWarning"
    @update:exposures="loadExposures"
    @close="showAttributesDialog = false"
    @redirect:issue="emit('redirect:issue')"
    @attributes:changed="onAttributesChanged"
  />
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

  .dirty-dot {
    color: rgb(var(--v-theme-warning));
    font-size: 1.1em;
    margin-left: 0.25rem;
    line-height: 1;
  }

</style>
