<script setup lang="ts">
  import { useFolderStore } from '@/stores/folderStore'
  import { useModelsStore } from '@/stores/modelsStore'
  import { useControlsStore } from '@/stores/controlsStore'
  import type { Control, Folder, Model } from '@dethernety/dt-core'
  import { getNewName } from '@/utils/dataFlowUtils'
  import ControlDialog from '@/components/Dialogs/Control/ControlDialog.vue'

  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  interface Props {
    show: boolean
    contentType: 'Model' | 'Control' | 'Both'
    selectType: 'multiple' | 'single'
    enableCreate?: boolean
  }

  interface TreeItem {
    id: string
    title: string
    children?: TreeItem[]
    folder: Folder
  }

  interface ContentItem {
    id: string
    name: string
    description: string
    type: 'Model' | 'Control'
  }

  const props = defineProps<Props>()
  const showDialog = ref(props.show)
  const folderStore = useFolderStore()
  const modelsStore = useModelsStore()
  const controlsStore = useControlsStore()
  const enableCreate = ref(props.enableCreate ?? false)
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  const actualFolderId = ref<string | null>(folderStore.selectedFolder?.id ?? null)

  // eslint-disable-next-line func-call-spacing
  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'error', error: any): void
    (e: 'select', selectedModels: Model[], selectedControls: Control[]): void
  }>()

  const selectedFolder = ref<string | null>(null)
  const selectedItems = ref<string[]>([])
  const modelItems = ref<Model[]>([])
  const controlItems = ref<Control[]>([])
  const loading = ref(false)
  const openedNodes = ref<string[]>(['root'])
  const activatedNode = ref<string | null>(folderStore.selectedFolder?.id ?? 'root')
  const showControlDialog = ref(false)
  const newControlId = ref<string | null>(null)

  const cancelDialog = () => {
    selectedItems.value = []
    selectedFolder.value = null
    modelItems.value = []
    controlItems.value = []
    emit('close')
  }

  const confirmSelection = () => {
    if (!selectedItems.value.length) return
    const selectedModels = modelItems.value.filter(item => selectedItems.value.includes(item.id))
    const selectedControls = controlItems.value.filter(item => selectedItems.value.includes(item.id as string))
    emit('select', selectedModels, selectedControls)
    cancelDialog()
  }

  const buildFolderTree = (folders: Folder[]): TreeItem[] => {
    const folderMap = new Map<string, TreeItem>()
    const rootItems: TreeItem[] = []

    folders.forEach(folder => {
      if (folder.id) {
        folderMap.set(folder.id, {
          id: folder.id,
          title: folder.name as string,
          children: [],
          folder,
        })
      }
    })

    folders.forEach(folder => {
      if (folder.id) {
        const treeItem = folderMap.get(folder.id)
        if (treeItem) {
          if (folder.parentFolder?.id) {
            const parent = folderMap.get(folder.parentFolder.id)
            if (parent) {
              parent.children = parent.children || []
              parent.children.push(treeItem)
            }
          } else {
            rootItems.push(treeItem)
          }
        }
      }
    })

    const rootFolder: TreeItem = {
      id: 'root',
      title: 'Root',
      children: rootItems,
      folder: {
        id: 'root',
        name: 'Root',
        description: 'Root folder containing all top-level folders',
      } as Folder,
    }

    return [rootFolder]
  }

  const treeData = computed(() => buildFolderTree(folderStore.folders))

  const calculateOpenedNodes = () => {
    if (folderStore.selectedFolder?.id && folderStore.folders.length > 0) {
      const selectedFolderId = folderStore.selectedFolder.id

      const getPathToRoot = (folderId: string): string[] => {
        const path: string[] = []
        let currentFolder = folderStore.folders.find(f => f.id === folderId)

        while (currentFolder) {
          path.push(currentFolder.id!)
          if (currentFolder.parentFolder?.id) {
            const parentId = currentFolder.parentFolder.id
            currentFolder = folderStore.folders.find(f => f.id === parentId)
          } else {
            break
          }
        }

        return path
      }

      const pathToRoot = getPathToRoot(selectedFolderId)
      const nodesToOpen = ['root', ...pathToRoot]

      openedNodes.value = [...new Set(nodesToOpen)]

      selectedFolder.value = selectedFolderId
      fetchContentForFolder(selectedFolderId)
    } else {
      openedNodes.value = ['root']
      selectedFolder.value = null
      fetchContentForFolder(null)
    }
  }

  const fetchContentForFolder = async (folderId: string | null) => {
    loading.value = true
    modelItems.value = []
    controlItems.value = []

    try {
      const items: ContentItem[] = []

      if (props.contentType === 'Model' || props.contentType === 'Both') {
        const models = await modelsStore.fetchModels({
          folderId: folderId || undefined,
          ephemeral: true,
        })

        modelItems.value = models
        models.forEach(model => {
          items.push({
            id: model.id,
            name: model.name || 'Unnamed Model',
            description: model.description || '',
            type: 'Model',
          })
        })
      }

      if (props.contentType === 'Control' || props.contentType === 'Both') {
        const controls = await controlsStore.fetchControls({
          folderId: folderId || undefined,
          ephemeral: true,
        })

        controlItems.value = controls
        controls.forEach(control => {
          items.push({
            id: control.id as string,
            name: control.name || 'Unnamed Control',
            description: control.description || '',
            type: 'Control',
          })
        })
      }
    } catch (error) {
      emit('error', error)
    } finally {
      loading.value = false
    }
  }

  const selectFolder = async (folderId: string) => {
    actualFolderId.value = folderId
    if (folderId === 'root') {
      selectedFolder.value = null
      await fetchContentForFolder(null)
    } else {
      selectedFolder.value = folderId
      await fetchContentForFolder(folderId)
    }
    selectedItems.value = []
  }

  const toggleItemSelection = (itemId: string) => {
    if (props.selectType === 'single') {
      selectedItems.value = [itemId]
    } else {
      const index = selectedItems.value.indexOf(itemId)
      if (index > -1) {
        selectedItems.value.splice(index, 1)
      } else {
        selectedItems.value.push(itemId)
      }
    }
  }

  const isItemSelected = (itemId: string) => {
    return selectedItems.value.includes(itemId)
  }

  const getTypeIcon = (type: string) => {
    return type === 'Model' ? 'mdi-vector-polyline' : 'mdi-shield-sword-outline'
  }

  const getTypeColor = (type: string) => {
    return type === 'Model' ? 'tertiary' : 'secondary'
  }

  const createControl = () => {
    controlsStore.createControl({
      newControl: {
        id: Math.random().toString(36).substring(2, 15),
        name: getNewName({
          baseName: 'New Control',
          existingNames: controlItems.value.map(control => control.name || ''),
        }),
        description: 'A new control',
      },
      classIds: [],
      folderId: actualFolderId.value || undefined,
    }).then((result: Control | null) => {
      if (result) {
        newControlId.value = result.id as string
        showControlDialog.value = true
      } else {
        console.error('Failed to create control')
        snackBar.value = {
          show: true,
          message: 'Failed to create control',
          color: 'error',
        }
      }
    })
  }

  const onSaveControl = () => {
    fetchContentForFolder(actualFolderId.value)
    showControlDialog.value = false
    newControlId.value = null
    snackBar.value = {
      show: true,
      message: 'Control created',
      color: 'success',
    }
  }

  watch(() => props.show, async newVal => {
    showDialog.value = newVal
    if (newVal) {
      if (folderStore.folders.length === 0) {
        await folderStore.fetchFolders()
      }

      await nextTick()
      calculateOpenedNodes()
    }
  })

  onMounted(async () => {
    if (folderStore.folders.length === 0) {
      await folderStore.fetchFolders()
    }

    if (props.show) {
      await nextTick()
      calculateOpenedNodes()
    }
  })
</script>

<template>
  <v-dialog
    v-model="showDialog"
    max-width="1000"
    @keydown.esc="cancelDialog"
    @update:model-value="$emit('close')"
  >
    <v-card class="pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="foreground" size="small">mdi-file-multiple</v-icon>
            <span class="ml-2 text-body-1">Select {{ contentType === 'Both' ? 'Item' : contentType }}{{ selectType === 'multiple' ? 's' : '' }}</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="cancelDialog"
          />
        </v-sheet>
      </v-card-title>

      <v-card-text class="pa-0 ma-0">
        <v-row class="fill-height" no-gutters>
          <v-col class="pa-4 border-e" cols="5">
            <div v-if="treeData.length > 0" class="folder-tree">
              <v-treeview
                v-model:opened="openedNodes"
                :activatable="true"
                :activated="activatedNode"
                color="secondary"
                density="compact"
                item-children="children"
                item-key="id"
                item-title="title"
                item-value="id"
                :items="treeData"
              >
                <template #prepend>
                  <v-icon color="secondary">mdi-folder-outline</v-icon>
                </template>

                <template #title="{ item }">
                  <v-btn
                    color="secondary"
                    size="small"
                    variant="text"
                    @click="selectFolder(item.id)"
                  >
                    {{ item.title }}
                  </v-btn>
                </template>
              </v-treeview>
            </div>

            <div v-else class="text-center py-4">
              <v-icon color="grey" size="48">mdi-folder-outline</v-icon>
              <p class="text-grey mt-2">No folders available</p>
            </div>
          </v-col>

          <v-col class="pa-4" cols="7">
            <div class="d-flex justify-space-between align-center mb-4">
              <h3 class="text-h6">
                Content
                <span v-if="selectedFolder">
                  in {{
                    folderStore.folders.find((f) => f.id === selectedFolder)?.name || 'Selected Folder'
                  }}
                </span>
                <span v-else>
                  in Root
                </span>
              </h3>
            </div>

            <v-divider class="mb-4" />

            <div v-if="loading" class="text-center py-8">
              <v-progress-circular color="primary" indeterminate />
              <p class="mt-2">Loading content...</p>
            </div>

            <div v-else-if="modelItems.length > 0 || controlItems.length > 0" class="content-list">
              <v-list density="compact">
                <v-list-item
                  v-for="item in modelItems"
                  :key="item.id"
                  :class="{ 'bg-primary-lighten-4': isItemSelected(item.id) }"
                  @click="toggleItemSelection(item.id)"
                >
                  <template #prepend>
                    <v-icon :color="getTypeColor('Model')">
                      {{ getTypeIcon('Model') }}
                    </v-icon>
                  </template>

                  <v-list-item-title>{{ item.name }}</v-list-item-title>
                  <v-list-item-subtitle>{{ item.description }}</v-list-item-subtitle>

                  <template #append>
                    <v-checkbox
                      color="primary"
                      :disabled="selectType === 'single' && selectedItems.length > 0 && !isItemSelected(item.id)"
                      hide-details
                      :model-value="isItemSelected(item.id)"
                      @click.stop="toggleItemSelection(item.id)"
                    />
                  </template>
                </v-list-item>

                <v-list-item
                  v-for="item in controlItems"
                  :key="item.id"
                  :class="{ 'bg-primary-lighten-4': isItemSelected(item.id as string) }"
                  @click="toggleItemSelection(item.id as string)"
                >
                  <template #prepend>
                    <v-icon :color="getTypeColor('Control')">
                      {{ getTypeIcon('Control') }}
                    </v-icon>
                  </template>

                  <v-list-item-title>{{ item.name }}</v-list-item-title>
                  <v-list-item-subtitle>{{ item.description }}</v-list-item-subtitle>

                  <template #append>
                    <v-checkbox
                      color="primary"
                      :disabled="selectType === 'single' && selectedItems.length > 0 && !isItemSelected(item.id as string)"
                      hide-details
                      :model-value="isItemSelected(item.id as string)"
                      @click.stop="toggleItemSelection(item.id as string)"
                    />
                  </template>
                </v-list-item>
              </v-list>
            </div>

            <div v-else class="text-center py-8">
              <v-icon color="grey" size="48">mdi-file-outline</v-icon>
              <p class="text-grey mt-2">
                No {{ contentType.toLowerCase() === 'both' ? 'content' : contentType.toLowerCase() }}s available
                {{ selectedFolder ? 'in this folder' : 'in root folder' }}
              </p>
            </div>
          </v-col>
        </v-row>
      </v-card-text>

      <v-card-actions class="pa-4 pt-0">
        <v-btn
          v-if="enableCreate && contentType === 'Control'"
          color="secondary"
          icon="mdi-plus"
          size="x-large"
          variant="outlined"
          @click="createControl"
        />
        <v-btn
          color="secondary"
          :disabled="selectedItems.length === 0"
          icon="mdi-check"
          size="x-large"
          variant="outlined"
          @click="confirmSelection"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
  <ControlDialog
    v-if="showControlDialog && newControlId !== null"
    :id="newControlId ?? ''"
    :show="showControlDialog && newControlId !== null"
    :show-file-actions="false"
    @control:closed="showControlDialog = false; newControlId = null"
    @control:saved="onSaveControl"
  />
  <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
    {{ snackBar.message }}
  </v-snackbar>
</template>

<style scoped>
.folder-tree {
  height: 400px;
  overflow-y: auto;
}

.content-list {
  height: 400px;
  overflow-y: auto;
}

.headline {
  font-family: 'JetBrains Mono', monospace !important;
}
</style>
