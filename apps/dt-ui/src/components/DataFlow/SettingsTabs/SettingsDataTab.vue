<script setup lang="ts">
  import { computed, ref } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { useFlowStore } from '@/stores/flowStore'
  import DataDialog from '@/components/Dialogs/DataFlow/DataDialog.vue'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'
  import { Class } from '@dethernety/dt-core'
  import { useRouter } from 'vue-router'
  import { getPageDisplayName } from '@/utils/dataFlowUtils'
  import { useIssueStore } from '@/stores/issueStore'

  // Interfaces
  interface DataItem {
    id: string;
    name?: string;
    description?: string;
    dataClass?: {
      id: string;
      name: string;
    } | null;
  }

  // Props
  interface Props {
    selectedItem: Node | Edge | null;
    selectedDataItemIds: string[];
  }

  const props = defineProps<Props>()

  // Emits
  const emit = defineEmits<{
    'update:selectedDataItemIds': [value: string[]];
    'updateForm': [];
    'redirect:issue': [];
    'update:snackBar': [payload: { show: boolean; message: string; color: string }];
  }>()

  // Stores
  const flowStore = useFlowStore()
  const issueStore = useIssueStore()
  const router = useRouter()

  // Data table headers
  const dataTableHeaders = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: 'Class', key: 'class' },
    { title: '', key: 'actions' },
  ]

  const itemsPerPage = [
    { value: 5, title: '5' },
    { value: 10, title: '10' },
    { value: 25, title: '25' },
    { value: 50, title: '50' },
    { value: -1, title: '$vuetify.dataFooter.itemsPerPageAll' },
  ]

  // Data-related refs
  const dataSearch = ref('')
  // Filter mode controls which slice of dataItems shows in the table:
  //   'all'     — every data item in the model
  //   'related' — own + items on any edge incident to this element (default)
  //   'own'     — only items already linked to this element
  type DataFilterMode = 'all' | 'related' | 'own'
  const dataFilterMode = ref<DataFilterMode>('related')
  const selectedDataItem = ref<string | null>(null)
  const showDataDialog = ref(false)
  const showDataDeleteDialog = ref(false)
  const dataDialogAction = ref('')
  const showIssueDialog = ref(false)
  const issueClass = ref<Class | null>(null)
  const issueName = ref('')
  const issueDescription = ref('')
  const issueElementIds = ref<string[]>([])

  // Type guards
  const isNode = (item: Node | Edge | null): item is Node => {
    return item !== null && typeof item === 'object' && 'type' in item && 'position' in item
  }

  const isEdge = (item: Node | Edge | null): item is Edge => {
    return item !== null && typeof item === 'object' && 'source' in item && 'target' in item
  }

  // Computed properties
  const searchMatches = computed(() => (dataItem: DataItem) => {
    const searchTerm = dataSearch.value.toLowerCase()
    const nameMatches = (dataItem.name ?? '').toLowerCase().includes(searchTerm)
    const descriptionMatches = (dataItem.description ?? '').toLowerCase().includes(searchTerm)
    const classMatch = (dataItem.dataClass?.name ?? '').toLowerCase().includes(searchTerm)
    return nameMatches || descriptionMatches || classMatch
  })

  const filterModeMatches = computed(() => (dataItem: DataItem) => {
    if (dataFilterMode.value === 'all') return true

    const ownIds = Array.isArray(props.selectedItem?.data?.dataItems)
      ? props.selectedItem!.data!.dataItems as string[]
      : []
    const isOwn = ownIds.includes(dataItem.id)

    if (dataFilterMode.value === 'own') return isOwn
    if (isOwn) return true

    // 'related' — own + any data item on an edge incident to this element.
    // For a node: edges arriving at OR leaving the node. For an edge:
    // dataItems held by the edge's source or target node.
    if (isNode(props.selectedItem) && props.selectedItem?.id) {
      const nodeId = props.selectedItem.id
      return flowStore.edges.some(e =>
        (e.target === nodeId || e.source === nodeId) &&
        Array.isArray(e.data?.dataItems) &&
        e.data.dataItems.includes(dataItem.id)
      )
    }

    if (isEdge(props.selectedItem) && props.selectedItem?.id) {
      const edge = props.selectedItem as Edge
      return flowStore.nodes.some(n =>
        (edge.source === n.id || edge.target === n.id) &&
        Array.isArray(n.data?.dataItems) &&
        n.data.dataItems.includes(dataItem.id)
      )
    }

    return false
  })

  const filteredDataItems = computed((): DataItem[] => {
    return flowStore.dataItems.filter(dataItem => {
      return filterModeMatches.value(dataItem) && searchMatches.value(dataItem)
    })
  })

  // Methods
  const updateSelectedDataItemIds = (value: string[]) => {
    emit('update:selectedDataItemIds', value)
  }

  const addDataItem = () => {
    dataDialogAction.value = 'create'
    selectedDataItem.value = null
    showDataDialog.value = true
  }

  const editDataItem = (id: string) => {
    if (id) {
      dataDialogAction.value = 'edit'
      selectedDataItem.value = id
      showDataDialog.value = true
    }
  }

  const deleteDataItem = (id: string) => {
    if (id) {
      selectedDataItem.value = id
      showDataDeleteDialog.value = true
    }
  }

  const onDataAdded = () => {
    showDataDialog.value = false
    dataSearch.value = ''
    selectedDataItem.value = null
    emit('updateForm')
  }

  const onDataDialogCancelled = () => {
    showDataDeleteDialog.value = false
    showDataDialog.value = false
    dataSearch.value = ''
    selectedDataItem.value = null
  }

  const onDataDelete = async () => {
    if (selectedDataItem.value) {
      try {
        await flowStore.deleteDataItem({ dataItemId: selectedDataItem.value })
        emit('updateForm')
      } catch (error) {
        console.error('Failed to delete data item:', error)
      }
    }
    showDataDeleteDialog.value = false
    selectedDataItem.value = null
  }

  const onAddIssue = (data:{issueClass: Class, id: string, name: string, description: string}) => {
    issueClass.value = data.issueClass
    issueName.value = data.issueClass.name + ' Issue on ' + data.name
    issueElementIds.value = [data.id, flowStore.selectedItem?.id || '', flowStore.modelId || '']
    issueDescription.value = data.description
    showIssueDialog.value = true
  }

  const onCopyToIssue = (data:{id: string, name: string, description: string}) => {
    issueElementIds.value = [data.id, flowStore.selectedItem?.id || '', flowStore.modelId || '']
    issueName.value = ' Issue on ' + data.name
    issueDescription.value = data.description

    const currentRoute = router.currentRoute.value
    const returnTo = {
      name: getPageDisplayName(currentRoute.path),
      path: currentRoute.path,
      query: { ...currentRoute.query },
    }

    issueStore.setIssueDataClipboard({
      name: data.name,
      description: data.name + ' Issue on ' + data.name + data.description,
      elementIds: [data.id, flowStore.selectedItem?.id || '', flowStore.modelId || ''],
      returnTo,
    })
    emit('redirect:issue')
  }

  const onIssueAdded = () => {
    showIssueDialog.value = false
    issueClass.value = null
  }
</script>

<template>
  <div>
    <v-data-table
      v-if="selectedItem"
      class="controls-table"
      :headers="dataTableHeaders"
      item-key="id"
      :items="filteredDataItems"
      items-per-page="5"
      :items-per-page-options="itemsPerPage"
      :model-value="selectedDataItemIds"
      show-select
      @update:model-value="updateSelectedDataItemIds"
    >
      <!-- Search Bar -->
      <template #top>
        <div class="d-flex justify-space-around mb-6">
          <v-text-field
            v-model="dataSearch"
            append-icon="mdi-magnify"
            class="mx-4"
            label="Search"
          />
          <v-btn-toggle
            v-model="dataFilterMode"
            class="mx-1 my-1 pa-0"
            color="secondary"
            density="compact"
            mandatory
            variant="plain"
          >
            <v-btn size="large" value="all">
              <span>All</span>
              <v-icon end>mdi-file-multiple-outline</v-icon>
            </v-btn>
            <v-btn size="large" value="related">
              <span>Related</span>
              <v-icon end>mdi-file-arrow-left-right-outline</v-icon>
            </v-btn>
            <v-btn size="large" value="own">
              <span>Own</span>
              <v-icon end>mdi-file-marker-outline</v-icon>
            </v-btn>
          </v-btn-toggle>
          <v-btn
            class="mx-3 my-0"
            color="secondary"
            icon="mdi-plus"
            size="x-large"
            variant="outlined"
            @click="addDataItem"
          />
        </div>
      </template>
      <template #item.class="{ item }">
        <div>
          <v-chip
            v-if="item.dataClass"
            class="ma-1"
            small
          >
            {{ item.dataClass?.name }}
          </v-chip>
        </div>
      </template>
      <template #item.actions="{ item }">
        <IssueSelector
          :id="item.id || ''"
          :name="item.name || ''"
          :description="item.description || ''"
          @add:issue="onAddIssue"
          @copy:issue="onCopyToIssue"
        />
        <v-btn
          class="mx-2"
          color="secondary"
          icon="mdi-pencil"
          variant="plain"
          @click="editDataItem(item.id)"
        />
        <v-btn
          color="error"
          icon="mdi-trash-can"
          variant="plain"
          @click="deleteDataItem(item.id)"
        />
      </template>
    </v-data-table>

    <ConfirmDeleteDialog
      v-if="showDataDeleteDialog"
      :message="`Are you sure you want to delete this Data Item: ${flowStore.dataItems.find((item: { id: any }) => item.id === selectedDataItem)?.name ?? ''}?`"
      :show="showDataDeleteDialog"
      @delete:canceled="onDataDialogCancelled"
      @delete:confirmed="onDataDelete"
    />
    <DataDialog
      v-if="showDataDialog"
      :id="selectedDataItem"
      :action="dataDialogAction"
      class="data-dialog"
      :show="showDataDialog"
      @cancel-data="onDataDialogCancelled"
      @data-added="onDataAdded"
      @redirect:issue="emit('redirect:issue')"
      @update:snackBar="emit('update:snackBar', $event)"
    />
    <IssueDialog
      v-if="showIssueDialog"
      :element-ids="issueElementIds"
      :issue-class="issueClass || undefined"
      :issue-description="issueDescription"
      :issue-name="issueName"
      :show="showIssueDialog"
      @cancel:issue="showIssueDialog = false"
      @issue:added="onIssueAdded"
    />
  </div>
</template>

<style scoped>
  .controls-table {
    max-height: 300px;
    overflow-y: auto;
  }
</style>
